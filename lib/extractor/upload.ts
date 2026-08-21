import { checkPdfSize, MAX_PDF_LABEL } from './types';

// Turning a file the user picked into the base64 the extractor takes.
//
// Deliberately no PDF parsing: the model reads the document, so the extension
// never has to ship a parser, and a CV whose text layer is unusual is the
// model's problem rather than a silent empty import. All this file does is check
// that the pick was plausible and hand the bytes on.
//
// In lib/ rather than in the React section for the usual reason (build guide,
// section 0, rule 6) — and because the checks below are the ones worth a test.

/** Longest a data: URL prefix can legitimately be, before the base64 starts. */
const MAX_PREFIX = 128;

/**
 * The base64 payload of a `data:` URL, without the `data:…;base64,` prefix.
 *
 * `FileReader.readAsDataURL` is the way to get base64 out of a File in a
 * browser; it hands back the whole URL, and the API wants only the payload.
 */
export function base64FromDataUrl(dataUrl: string): string {
  const comma = dataUrl.indexOf(',');
  const prefix = comma === -1 ? '' : dataUrl.slice(0, comma);
  if (!dataUrl.startsWith('data:') || comma === -1 || !prefix.includes(';base64')) {
    throw new Error('Could not read that file.');
  }
  if (comma > MAX_PREFIX) throw new Error('Could not read that file.');
  // Some encoders wrap long payloads; the API takes it either way, and the size
  // check should not count line breaks as document bytes.
  return dataUrl.slice(comma + 1).replace(/\s+/g, '');
}

/** What a chosen file needs to be, or a sentence saying why it is not. */
export function checkPdfFile(file: Pick<File, 'name' | 'type' | 'size'>): string | undefined {
  const looksLikePdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
  if (!looksLikePdf) {
    return `That file is not a PDF. Export your CV as a PDF (under ${MAX_PDF_LABEL}) and try again.`;
  }
  // Same limit, and the same wording, as the extractor's own guard: this one
  // saves a round trip, that one is the guarantee.
  return checkPdfSize(file.size);
}

/**
 * Read a picked file as base64.
 *
 * Rejects rather than resolving empty when the read fails, so the caller can
 * show the failure instead of sending an empty document to the API.
 */
export function readPdfAsBase64(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read that file from disk.'));
    reader.onload = () => {
      try {
        resolve(base64FromDataUrl(String(reader.result ?? '')));
      } catch (cause) {
        reject(cause instanceof Error ? cause : new Error('Could not read that file.'));
      }
    };
    reader.readAsDataURL(file);
  });
}
