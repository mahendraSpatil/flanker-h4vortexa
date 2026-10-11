// Owner: Mahendra | Stores uploaded files at server/storage/<fileHash>
import fs from 'node:fs/promises';
import path from 'node:path';
import { HEX32 } from '@proofchain/core';
import { AppError } from '../lib/errors.js';

/**
 * File store keyed by fileHash. Files are written once and never overwritten, so a stored file
 * only changes if someone edits the disk directly (which is exactly what the tamper demo does).
 * @param {string} storageDir absolute directory (config.storageDir in production)
 */
export function createStorage(storageDir) {
  function pathFor(fileHash) {
    if (typeof fileHash !== 'string' || !HEX32.test(fileHash)) {
      // Never build a path from anything but a validated hash: it is the only guard against traversal.
      throw new TypeError(`Invalid fileHash for storage: ${String(fileHash).slice(0, 24)}`);
    }
    return path.join(storageDir, fileHash);
  }

  async function exists(filePath) {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Write bytes to <storageDir>/<fileHash>. Idempotent: if the file is already there it is left untouched.
   * Writes to a temp file first and renames, so a crash never leaves a half-written file under the hash.
   * @returns {Promise<string>} absolute path of the stored file
   */
  async function saveFile(fileHash, buffer) {
    const target = pathFor(fileHash);
    await fs.mkdir(storageDir, { recursive: true });
    if (await exists(target)) return target;

    const temp = `${target}.${process.pid}.${Date.now()}.tmp`;
    await fs.writeFile(temp, buffer, { flag: 'wx' });
    try {
      await fs.rename(temp, target);
    } catch (err) {
      await fs.rm(temp, { force: true });
      throw err;
    }
    return target;
  }

  /**
   * Read a stored file back.
   * @throws {AppError} NOT_FOUND (404) when nothing is stored under that hash
   */
  async function readFile(fileHash) {
    try {
      return await fs.readFile(pathFor(fileHash));
    } catch (err) {
      if (err.code === 'ENOENT') {
        throw new AppError('NOT_FOUND', 404, `No stored file for ${fileHash}`);
      }
      throw err;
    }
  }

  return { saveFile, readFile, pathFor };
}

// Default store under config.storageDir. config is imported lazily so createStorage stays usable in
// tests without a server/.env (importing config.js exits the process when the env is invalid).
let defaultStorage;
async function getDefaultStorage() {
  if (!defaultStorage) {
    const { config } = await import('../config.js');
    defaultStorage = createStorage(config.storageDir);
  }
  return defaultStorage;
}

/**
 * Write file bytes to server/storage/<fileHash> (config.storageDir). Idempotent for the same hash.
 * @param {string} fileHash "0x" + 64 lowercase hex (from @proofchain/core fileHash)
 * @param {Buffer} buffer the raw uploaded bytes (not the normalised .txt bytes)
 * @returns {Promise<string>} absolute path of the stored file
 */
export async function saveFile(fileHash, buffer) {
  return (await getDefaultStorage()).saveFile(fileHash, buffer);
}

/**
 * Read a stored file back.
 * @param {string} fileHash
 * @returns {Promise<Buffer>}
 * @throws {AppError} NOT_FOUND when no file is stored under that hash
 */
export async function readFile(fileHash) {
  return (await getDefaultStorage()).readFile(fileHash);
}
