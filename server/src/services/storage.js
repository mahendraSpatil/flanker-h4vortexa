// Owner: Mahendra | Stores uploaded files at server/storage/<fileHash>

/**
 * Write file bytes to server/storage/<fileHash> (config.storageDir). Idempotent for the same hash.
 * @param {string} fileHash "0x" + 64 lowercase hex (from @proofchain/core fileHash)
 * @param {Buffer} buffer the raw uploaded bytes (not the normalised .txt bytes)
 * @returns {Promise<string>} absolute path of the stored file
 */
export async function saveFile(fileHash, buffer) {
  throw new Error('NOT_IMPLEMENTED: saveFile');
}

/**
 * Read a stored file back.
 * @param {string} fileHash
 * @returns {Promise<Buffer>}
 * @throws {AppError} NOT_FOUND when no file is stored under that hash
 */
export async function readFile(fileHash) {
  throw new Error('NOT_IMPLEMENTED: readFile');
}
