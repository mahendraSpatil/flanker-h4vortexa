// Owner: Mahendra | Text extraction: PDF text layer first, OCR for images and scanned PDFs
//
// Verified imports under ESM (Node 24, pdf-parse 2.4.5, tesseract.js 7.0.0):
//   import { PDFParse } from 'pdf-parse';
//     const parser = new PDFParse({ data: buffer });
//     const { text } = await parser.getText();  // text ends with "-- 1 of N --" page markers
//     await parser.destroy();
//   import { createWorker } from 'tesseract.js';  // downloads eng traineddata on first use (needs internet once)
// Do NOT use `import pdf from 'pdf-parse'` (the v1 API): v2 has no default export and it fails with a SyntaxError.

/**
 * Extract text for metadata suggestions only (never hashed).
 * PDF: text layer via pdf-parse; if empty, OCR. PNG/JPG: OCR via tesseract.js. TXT: UTF-8 decode.
 * @param {Buffer} buffer raw file bytes
 * @param {string} mime "application/pdf" | "image/png" | "image/jpeg" | "text/plain"
 * @returns {Promise<{ text: string, method: 'pdf-text' | 'ocr' | 'plain' }>}
 */
export async function extractText(buffer, mime) {
  throw new Error('NOT_IMPLEMENTED: extractText');
}
