import type { ExtractedProfileData } from '../types';
import { callGemini } from '../gemini-client';
import { GeneratorError } from '../generator/types';
import { ExtractionSchemaError, validateExtractedProfile } from './schema';
import type { ProfileExtractor } from './types';
import { base64ByteLength, checkPdfSize } from './types';

// Reading a CV with Gemini, from the background service worker.
//
// The PDF goes up inline with the request — no upload step, no Files API, and no
// PDF-parsing library in the extension: the model reads the document itself, so
// there is nothing here that has to keep up with how PDFs encode text.
//
// Verified against ai.google.dev on 2026-08-21: `contents[].parts[].inlineData`
// carries `{ mimeType, data }` for document input, `application/pdf` is accepted
// natively, and inline data may be up to 50 MB / 1000 pages (a page costs 258
// tokens). The docs' REST samples spell the keys `inline_data`/`mime_type`; the
// camelCase spelling used here is the one their JSON-representation blocks and
// SDKs use, protobuf JSON accepts either, and this extension already sends
// `systemInstruction` and `responseMimeType` that way.
//
// The transport — URL, key header, HTTP and response-shape failures — is
// lib/gemini-client.ts, shared with the answer generator. This file is only the
// request body and what to do with the reply.

/**
 * The extraction instruction, verbatim from the feature specification.
 *
 * Fixed text on purpose. Every clause is doing work: "only JSON" and "no text
 * outside the JSON object" keep the reply parseable, and the two sentences about
 * not inventing anything are the whole contract of the feature — an import the
 * user has to fact-check is worse than no import. Reword only if a real response
 * proves unreliable, and never to widen what is asked for.
 */
export const EXTRACTION_INSTRUCTION = [
  'Extract structured data from this CV/resume.',
  'Return only JSON matching the provided schema.',
  'Do not invent or infer anything not explicitly present in the document.',
  'If a field cannot be determined, omit it entirely rather than guessing.',
  'Do not include any text outside the JSON object.',
].join(' ');

/**
 * `ExtractedProfileData` in Gemini's responseSchema dialect (an OpenAPI subset
 * with upper-case type names), so the provider constrains its own output and
 * lib/extractor/schema.ts is a safety net rather than the only defence.
 *
 * No section is required — "omit it entirely rather than guessing" has to be
 * possible for the whole request to be honest — and the excluded fields are
 * absent rather than described, so the model is never shown a slot for them.
 * Within a row only the anchor is required: a row that cannot even name the
 * employer, school, or project is not a row.
 */
export const EXTRACTION_RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    personal: {
      type: 'OBJECT',
      properties: {
        name: { type: 'STRING' },
        email: { type: 'STRING' },
        phone: { type: 'STRING' },
        links: {
          type: 'OBJECT',
          properties: {
            github: { type: 'STRING' },
            linkedin: { type: 'STRING' },
            portfolio: { type: 'STRING' },
          },
          propertyOrdering: ['github', 'linkedin', 'portfolio'],
        },
      },
      propertyOrdering: ['name', 'email', 'phone', 'links'],
    },
    education: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          institution: { type: 'STRING' },
          program: { type: 'STRING' },
          dates: { type: 'STRING' },
        },
        required: ['institution'],
        propertyOrdering: ['institution', 'program', 'dates'],
      },
    },
    workHistory: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          company: { type: 'STRING' },
          role: { type: 'STRING' },
          dates: { type: 'STRING' },
          bullets: { type: 'ARRAY', items: { type: 'STRING' } },
        },
        required: ['company'],
        propertyOrdering: ['company', 'role', 'dates', 'bullets'],
      },
    },
    projectsRaw: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          name: { type: 'STRING' },
          description: { type: 'STRING' },
          techStack: { type: 'ARRAY', items: { type: 'STRING' } },
        },
        required: ['name'],
        propertyOrdering: ['name', 'description', 'techStack'],
      },
    },
    skills: { type: 'ARRAY', items: { type: 'STRING' } },
  },
  propertyOrdering: ['personal', 'education', 'workHistory', 'projectsRaw', 'skills'],
};

/**
 * Room for a long CV's worth of JSON. Higher than the generator's budget because
 * a dense three-page CV expands into far more structured text than a page of
 * drafted answers, and a truncated reply is a failed import rather than a shorter
 * one — `callGemini` reports the MAX_TOKENS stop rather than handing on broken
 * JSON, but the point is not to reach it.
 */
const DEFAULT_MAX_OUTPUT_TOKENS = 16384;

export interface GeminiExtractorOptions {
  maxOutputTokens?: number;
}

export class GeminiExtractor implements ProfileExtractor {
  private readonly maxOutputTokens: number;

  constructor(options: GeminiExtractorOptions = {}) {
    this.maxOutputTokens = options.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS;
  }

  async extract(pdfBase64: string): Promise<ExtractedProfileData> {
    // Checked again here, not only in the page that picked the file: this is the
    // last point before the payload becomes a billable request. Raised as a
    // `config` failure because that is the kind the UI shows verbatim, and the
    // message is the instruction the user needs ("compress it").
    const tooBig = checkPdfSize(base64ByteLength(pdfBase64));
    if (tooBig !== undefined) throw new GeneratorError('config', tooBig);

    const text = await callGemini(this.buildRequestBody(pdfBase64));
    try {
      return validateExtractedProfile(text);
    } catch (cause) {
      // Re-wrapped so a caller only ever catches GeneratorError from a provider,
      // whichever layer the failure came from.
      const detail = cause instanceof ExtractionSchemaError ? cause.message : String(cause);
      throw new GeneratorError(
        'response',
        `Could not read the CV data Gemini returned. ${detail}`,
        {
          cause,
        },
      );
    }
  }

  private buildRequestBody(pdfBase64: string): unknown {
    return {
      contents: [
        {
          role: 'user',
          parts: [
            // Document first, instruction second, as Google's document-input
            // samples do: the prompt reads as a question about the file above it.
            { inlineData: { mimeType: 'application/pdf', data: pdfBase64 } },
            { text: EXTRACTION_INSTRUCTION },
          ],
        },
      ],
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: EXTRACTION_RESPONSE_SCHEMA,
        maxOutputTokens: this.maxOutputTokens,
        // No temperature/topP/topK, matching the generator: Gemini 3 models are
        // tuned around their default sampling settings.
      },
    };
  }
}
