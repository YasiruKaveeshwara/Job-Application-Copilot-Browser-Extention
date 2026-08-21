import { describe, it, expect } from 'vitest';
import { base64FromDataUrl, checkPdfFile, readPdfAsBase64 } from '../../lib/extractor/upload';
import { MAX_PDF_BYTES } from '../../lib/extractor/types';

// Picking a file, before any of it reaches the API. Everything here runs in the
// test environment's DOM (FileReader, Blob), and none of it touches the network.

describe('base64FromDataUrl', () => {
  it('returns the payload of a data: URL', () => {
    expect(base64FromDataUrl('data:application/pdf;base64,JVBERi0=')).toBe('JVBERi0=');
  });

  it('drops the line breaks a wrapped payload carries', () => {
    expect(base64FromDataUrl('data:application/pdf;base64,JVBE\nRi0=\n')).toBe('JVBERi0=');
  });

  it('refuses anything that is not a base64 data: URL', () => {
    for (const bad of [
      '',
      'JVBERi0=',
      'https://example.com/cv.pdf',
      'data:application/pdf,plain-text',
      `data:application/pdf;base64${'x'.repeat(200)},JVBERi0=`,
    ]) {
      expect(() => base64FromDataUrl(bad), bad).toThrow(/Could not read/);
    }
  });
});

describe('readPdfAsBase64', () => {
  it('reads a file into base64 the API could decode', async () => {
    const contents = '%PDF-1.7 pretend document';
    const base64 = await readPdfAsBase64(new Blob([contents], { type: 'application/pdf' }));
    expect(atob(base64)).toBe(contents);
  });
});

describe('checkPdfFile', () => {
  const pdf = (over: Partial<Pick<File, 'name' | 'type' | 'size'>> = {}) => ({
    name: 'cv.pdf',
    type: 'application/pdf',
    size: 120_000,
    ...over,
  });

  it('accepts a PDF within the limit', () => {
    expect(checkPdfFile(pdf())).toBeUndefined();
    // Some browsers hand over an empty type; the extension is the file name.
    expect(checkPdfFile(pdf({ type: '' }))).toBeUndefined();
    expect(checkPdfFile(pdf({ name: 'Résumé 2026.PDF', type: '' }))).toBeUndefined();
  });

  it('refuses a file that is not a PDF, and says what to do instead', () => {
    const problem = checkPdfFile(
      pdf({ name: 'cv.docx', type: 'application/vnd.openxmlformats-officedocument' }),
    );
    expect(problem).toContain('not a PDF');
    expect(problem).toContain('Export your CV as a PDF');
  });

  it('refuses an empty file and an oversized one before any request is made', () => {
    expect(checkPdfFile(pdf({ size: 0 }))).toContain('empty');
    expect(checkPdfFile(pdf({ size: MAX_PDF_BYTES + 1 }))).toContain('8 MB');
  });

  it('checks the type before the size, so a wrong pick is named as one', () => {
    expect(checkPdfFile(pdf({ name: 'scan.png', type: 'image/png', size: 0 }))).toContain(
      'not a PDF',
    );
  });
});
