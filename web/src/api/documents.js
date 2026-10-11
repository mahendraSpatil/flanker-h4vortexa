// Owner: Archit (frozen; ask before changing) | Document endpoints, one thin wrapper each
// Usage: import * as documents from '../api/documents.js'; await documents.upload(file);
import { request } from './client.js';

const recordPath = (recordId) => `/api/documents/${encodeURIComponent(recordId)}`;

/** POST /api/documents -> { recordId, fileHash, status, suggestions, extractionPath } (409 DUPLICATE). */
export function upload(file) {
  const formData = new FormData();
  formData.append('file', file);
  return request('/api/documents', { method: 'POST', formData });
}

/**
 * POST /api/documents/:recordId/confirm -> { record, leaf, status: "pending", canonical } (400 VALIDATION).
 * fields: the docType's document fields as typed, e.g. { netPay: "50,000" } (amounts in rupees).
 */
export function confirm(recordId, { docType, issuer, date, fields = {} }) {
  return request(`${recordPath(recordId)}/confirm`, {
    method: 'POST',
    json: { docType, issuer, date, fields },
  });
}

/** GET /api/documents?status&docType&issuer&batchId -> [ record ]. Empty filters are omitted. */
export function list(filters = {}) {
  const params = new URLSearchParams(
    Object.entries(filters).filter(
      ([, value]) => value !== undefined && value !== null && value !== '',
    ),
  );
  const query = params.toString();
  return request(query ? `/api/documents?${query}` : '/api/documents');
}

/** URL of the stored file, for <a href> / <iframe src>. */
export function fileUrl(recordId) {
  return `${recordPath(recordId)}/file`;
}

/** URL of proof.json, for a download link (404 NOT_ANCHORED until sealed). */
export function proofUrl(recordId) {
  return `${recordPath(recordId)}/proof`;
}
