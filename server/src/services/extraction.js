// Owner: Mahendra | Text extraction: PDF text layer first, OCR for images and scanned PDFs
//
// Verified imports under ESM (Node 24, pdf-parse 2.4.5, tesseract.js 7.0.0):
//   import { PDFParse } from 'pdf-parse';
//     const parser = new PDFParse({ data: buffer });
//     const { text } = await parser.getText();  // text ends with "-- 1 of N --" page markers
//     await parser.destroy();
//   import { createWorker } from 'tesseract.js';  // downloads eng traineddata on first use (needs internet once)
// Do NOT use `import pdf from 'pdf-parse'` (the v1 API): v2 has no default export and it fails with a SyntaxError.
//
// Extracted text only feeds metadata suggestions. It is never hashed: OCR is not deterministic.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** A PDF whose text layer has fewer visible characters than this is treated as a scan. */
const MIN_TEXT_LAYER_CHARS = 20;
/** Scanned PDFs: OCR only the first pages; issuer, type and date are almost always on page 1. */
const OCR_MAX_PDF_PAGES = 2;
/** Render scale for scanned PDF pages before OCR (about 150-200 dpi for A4). */
const OCR_RENDER_SCALE = 2;
const OCR_TIMEOUT_MS = 60_000;
/** Upper bound on returned text; suggestions only look at the start of a document. */
const MAX_TEXT_CHARS = 200_000;
/** traineddata cache outside the repo, so OCR never writes into the working tree. */
const OCR_CACHE_DIR = path.join(os.tmpdir(), 'proofchain-tesseract');

const PAGE_MARKER = /^[ \t]*--[ \t]*\d+[ \t]+of[ \t]+\d+[ \t]*--[ \t]*$/gm;

/**
 * Extract text for metadata suggestions only (never hashed).
 * PDF: text layer via pdf-parse; if empty, OCR. PNG/JPG: OCR via tesseract.js. TXT: UTF-8 decode.
 * @param {Buffer} buffer raw file bytes
 * @param {string} mime "application/pdf" | "image/png" | "image/jpeg" | "text/plain"
 * @returns {Promise<{ text: string, method: 'pdf-text' | 'ocr' | 'plain' }>}
 * @throws {Error} when the file cannot be parsed or OCR fails (callers treat this as "no suggestions")
 */
export async function extractText(buffer, mime) {
  switch (mime) {
    case 'text/plain':
      return { text: cap(decodeUtf8(buffer)), method: 'plain' };
    case 'image/png':
    case 'image/jpeg':
      return { text: cap(await ocrImage(buffer)), method: 'ocr' };
    case 'application/pdf':
      return extractPdf(buffer);
    default:
      throw new TypeError(`No text extractor for mime type "${mime}"`);
  }
}

async function extractPdf(buffer) {
  const { PDFParse } = await import('pdf-parse');
  // pdf.js may transfer (detach) the buffer it is given, so hand it a copy and keep the original intact.
  const parser = new PDFParse({ data: new Uint8Array(buffer) });
  try {
    const { text } = await parser.getText();
    const clean = (text ?? '').replace(PAGE_MARKER, '').trim();
    if (visibleChars(clean) >= MIN_TEXT_LAYER_CHARS) {
      return { text: cap(clean), method: 'pdf-text' };
    }

    // No usable text layer: a scan. Render the first pages to PNG and OCR them.
    const { pages } = await parser.getScreenshot({
      first: OCR_MAX_PDF_PAGES,
      scale: OCR_RENDER_SCALE,
      imageBuffer: true,
      imageDataUrl: false,
    });
    const texts = [];
    for (const page of pages ?? []) {
      if (page?.data) texts.push(await ocrImage(Buffer.from(page.data)));
    }
    return { text: cap(texts.join('\n').trim()), method: 'ocr' };
  } finally {
    await parser.destroy().catch(() => {});
  }
}

function decodeUtf8(buffer) {
  // Non-fatal decode: upload validation already rejected non-UTF-8 .txt files. BOM is dropped.
  return new TextDecoder('utf-8').decode(buffer);
}

function visibleChars(text) {
  return text.replace(/\s+/g, '').length;
}

function cap(text) {
  return text.length > MAX_TEXT_CHARS ? text.slice(0, MAX_TEXT_CHARS) : text;
}

// ---- OCR: one lazily created worker, one job at a time ----------------------------------------

let workerPromise = null;
let queue = Promise.resolve();

function getWorker() {
  if (!workerPromise) {
    workerPromise = (async () => {
      fs.mkdirSync(OCR_CACHE_DIR, { recursive: true });
      const { createWorker } = await import('tesseract.js');
      return createWorker('eng', 1, { cachePath: OCR_CACHE_DIR });
    })();
    // A failed start (e.g. no internet for the first traineddata download) must not stick forever.
    workerPromise.catch(() => {
      workerPromise = null;
    });
  }
  return workerPromise;
}

/** Terminate the OCR worker (tests, graceful shutdown). Safe to call when none is running. */
export async function shutdownOcr() {
  const pending = workerPromise;
  workerPromise = null;
  if (!pending) return;
  try {
    await (await pending).terminate();
  } catch {
    // The worker failed to start or is already gone.
  }
}

/** Serialise OCR jobs: a single worker processes one image at a time. */
function runExclusive(task) {
  const run = queue.then(task, task);
  queue = run.catch(() => {});
  return run;
}

function ocrImage(buffer) {
  return runExclusive(async () => {
    const worker = await getWorker();
    let timer;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(`OCR timed out after ${OCR_TIMEOUT_MS / 1000} s`)),
        OCR_TIMEOUT_MS,
      );
    });
    try {
      const { data } = await Promise.race([worker.recognize(buffer), timeout]);
      return data?.text ?? '';
    } catch (err) {
      await shutdownOcr(); // a hung or crashed worker is replaced on the next job
      throw err;
    } finally {
      clearTimeout(timer);
    }
  });
}
