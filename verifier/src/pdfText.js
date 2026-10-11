// Owner: Neel | Text layer of a dropped PDF, read in the browser with pdf.js (bundled, no network), for the field diff only
//
// The text only explains a DOCUMENT_MODIFIED verdict ("Net pay changed"); verify() never lets it
// change a result. pdf.js and its worker are bundled by Vite and served from this app: nothing is
// fetched from any server.
import { GlobalWorkerOptions, getDocument } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

GlobalWorkerOptions.workerSrc = workerUrl;

const PDF_SIGNATURE = [0x25, 0x50, 0x44, 0x46, 0x2d]; // "%PDF-"
const SIGNATURE_WINDOW = 1024; // the PDF spec tolerates junk before the header
const MAX_PAGES = 5; // fields sit on the first page; this bounds work on a large upload

/** True when the bytes contain a PDF header near the start. */
export function isPdf(bytes) {
  const end = Math.min(bytes.length, SIGNATURE_WINDOW) - PDF_SIGNATURE.length;
  for (let i = 0; i <= end; i++) {
    if (PDF_SIGNATURE.every((byte, j) => bytes[i + j] === byte)) return true;
  }
  return false;
}

/**
 * The PDF's text, page by page, with pdf.js items joined at their line ends.
 * @param {Uint8Array} bytes the dropped file (not modified: pdf.js gets a copy)
 * @returns {Promise<string | null>} null when it is not a PDF, has no text layer (a scan) or
 *   cannot be read; never rejects
 */
export async function readPdfText(bytes) {
  if (!isPdf(bytes)) return null;
  let doc = null;
  try {
    // A copy: pdf.js transfers its buffer to the worker, which would empty the caller's bytes.
    // isEvalSupported false: never compile code from an untrusted PDF's fonts.
    doc = await getDocument({ data: bytes.slice(), isEvalSupported: false, verbosity: 0 }).promise;
    const pages = [];
    for (let n = 1; n <= Math.min(doc.numPages, MAX_PAGES); n++) {
      const { items } = await (await doc.getPage(n)).getTextContent();
      pages.push(items.map((item) => (item.str ?? '') + (item.hasEOL ? '\n' : '')).join(''));
    }
    const text = pages.join('\n');
    return text.trim() === '' ? null : text;
  } catch (err) {
    console.warn('Could not read the PDF text layer (field diff unavailable):', err);
    return null;
  } finally {
    await doc?.destroy();
  }
}
