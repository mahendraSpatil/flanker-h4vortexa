// Owner: Archit (frozen; ask before changing) | fetch wrapper: adds X-Actor, parses JSON, throws ApiError

export const ACTOR_STORAGE_KEY = 'proofchain.actor';

/** Error thrown for any failed request; `code` is the server's error code (e.g. "DUPLICATE"). */
export class ApiError extends Error {
  constructor({ code, status, message, details }) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

/** The name sent as X-Actor ('' when not set or storage is blocked). */
export function getActor() {
  try {
    return localStorage.getItem(ACTOR_STORAGE_KEY) ?? '';
  } catch {
    return '';
  }
}

export function setActor(name) {
  try {
    localStorage.setItem(ACTOR_STORAGE_KEY, name);
  } catch {
    // Storage blocked (private mode): the name just won't persist.
  }
}

async function readBody(res) {
  const type = res.headers.get('content-type') ?? '';
  if (res.status === 204) return null;
  return type.includes('application/json') ? res.json() : res.text();
}

/**
 * Call the registry API (proxied to the server by Vite).
 * @param {string} path full API path, e.g. "/api/documents"
 * @param {{ method?: string, json?: unknown, formData?: FormData }} [options]
 * @returns {Promise<any>} parsed JSON (or text for non-JSON responses)
 * @throws {ApiError}
 */
export async function request(path, { method = 'GET', json, formData } = {}) {
  const headers = {};
  const actor = getActor().trim();
  // Header values must be Latin-1; the server decodes this.
  if (actor) headers['X-Actor'] = encodeURIComponent(actor);

  let body;
  if (json !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(json);
  } else if (formData) {
    body = formData; // the browser sets the multipart boundary
  }

  let res;
  try {
    res = await fetch(path, { method, headers, body });
  } catch {
    throw new ApiError({
      code: 'NETWORK_ERROR',
      status: 0,
      message: 'Cannot reach the registry server. Is `npm run server` running?',
    });
  }

  const data = await readBody(res).catch(() => null);
  if (res.ok) return data;

  const isApiError = data && typeof data === 'object' && typeof data.error === 'string';
  throw new ApiError({
    code: isApiError ? data.error : `HTTP_${res.status}`,
    status: res.status,
    message: isApiError ? data.message : `Request failed with status ${res.status}`,
    details: isApiError ? data.details : undefined,
  });
}
