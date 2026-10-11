// Owner: Mahendra | Test helpers: in-memory DB with the real schema, fake storage and audit log
import fs from 'node:fs';
import { createHash } from 'node:crypto';

const SCHEMA_SQL = fs.readFileSync(new URL('../src/db/schema.sql', import.meta.url), 'utf8');

/**
 * In-memory SQLite with server/src/db/schema.sql applied. Uses better-sqlite3 when installed,
 * otherwise Node's built-in node:sqlite (same prepare/get/all/run/exec subset).
 */
export async function openTestDb() {
  let db;
  try {
    const { default: Database } = await import('better-sqlite3');
    db = new Database(':memory:');
  } catch {
    const { DatabaseSync } = await import('node:sqlite');
    db = new DatabaseSync(':memory:');
  }
  db.exec('PRAGMA foreign_keys = ON');
  db.exec(SCHEMA_SQL);
  return db;
}

export function memoryStorage() {
  const files = new Map();
  return {
    files,
    async saveFile(fileHash, buffer) {
      if (!files.has(fileHash)) files.set(fileHash, Buffer.from(buffer));
      return `/memory/${fileHash}`;
    },
    async readFile(fileHash) {
      if (!files.has(fileHash)) {
        const err = new Error(`No stored file for ${fileHash}`);
        err.code = 'NOT_FOUND';
        err.status = 404;
        throw err;
      }
      return files.get(fileHash);
    },
  };
}

export function auditRecorder() {
  const entries = [];
  const logAction = (entry) => entries.push(entry);
  return { entries, logAction };
}

/** Independent SHA-256 per the locked spec, to check results without trusting the code under test. */
export function sha256Hex(bytes) {
  return '0x' + createHash('sha256').update(bytes).digest('hex');
}

/** A minimal but well-formed one-page PDF (enough for magic-byte sniffing). */
export function tinyPdf(label = 'ProofChain') {
  return Buffer.from(`%PDF-1.4\n% ${label}\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n`, 'latin1');
}

export const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
export const JPEG_BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46]);
