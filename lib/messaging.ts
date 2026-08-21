import { defineExtensionMessaging } from '@webext-core/messaging';
import type { DetectedField, JobContext, GeneratedAnswer, ExtractedProfileData } from './types';

// The single place message contracts are defined. Every cross-boundary call
// (content script ↔ background ↔ UI) goes through the helpers exported here;
// raw browser.runtime.sendMessage is lint-banned elsewhere (see eslint.config.mjs).

/** Result of scanning the active page. */
export interface ScanResult {
  fields: DetectedField[];
  context: JobContext;
}

/** Everything the background needs to produce drafts for one page. */
export interface GenerationRequest {
  fields: DetectedField[];
  context: JobContext;
}

export interface InsertFieldRequest {
  domRef: string;
  finalText: string;
}

export interface InsertFieldResult {
  success: boolean;
  /** Present only when success is false, for display in the UI. */
  error?: string;
}

export interface SaveFieldMappingRequest {
  domain: string;
  resolvedLabel: string;
  correctedType: string;
}

/**
 * One uploaded CV, base64-encoded, on its way to the model.
 *
 * The options page cannot make this call itself: the API key and the provider
 * endpoint live in the background worker and stay there (see
 * test/e2e/packaging.spec.ts, which asserts the endpoint appears in exactly one
 * bundle). So the PDF crosses the message boundary and the extracted data comes
 * back — which is also why lib/extractor caps the file size.
 */
export interface ExtractCvRequest {
  pdfBase64: string;
}

/**
 * Request/response shape of every message in the extension.
 *
 * Handlers may return a promise; a handler that throws surfaces as a rejected
 * promise on the sending side, so callers can try/catch instead of inspecting
 * a sentinel value.
 */
export interface ProtocolMap {
  /** Side panel → content script. Detect fields and read the job text. */
  TRIGGER_SCAN(): ScanResult;
  /** Side panel → background. Retrieve, prompt, generate, validate. */
  REQUEST_GENERATION(data: GenerationRequest): GeneratedAnswer[];
  /** Side panel → content script. Write a final answer into the live field. */
  INSERT_FIELD(data: InsertFieldRequest): InsertFieldResult;
  /** Side panel → background. Persist a manual label/type correction. */
  SAVE_FIELD_MAPPING(data: SaveFieldMappingRequest): void;
  /**
   * Options page → background. Read structured data off an uploaded CV.
   *
   * Returns what the model could honestly extract. Nothing is saved by this
   * call — the options page shows it for review first (lib/extractor/merge.ts).
   */
  EXTRACT_CV(data: ExtractCvRequest): ExtractedProfileData;
}

export const { sendMessage, onMessage } = defineExtensionMessaging<ProtocolMap>();
