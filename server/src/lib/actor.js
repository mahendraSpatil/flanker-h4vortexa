// Owner: Archit (frozen; ask before changing) | Reads X-Actor into req.actor; required on mutating requests
import { AppError } from './errors.js';

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const MAX_ACTOR_LENGTH = 64;

// The web client URI-encodes the name so non-Latin names survive HTTP headers; plain ASCII passes through.
function readActor(req) {
  const raw = req.get('X-Actor');
  if (!raw) return null;
  let name;
  try {
    name = decodeURIComponent(raw);
  } catch {
    name = raw;
  }
  name = name.normalize('NFC').trim().replace(/\s+/g, ' ').slice(0, MAX_ACTOR_LENGTH);
  return name || null;
}

/** Sets req.actor (string or null). Rejects POST/PUT/PATCH/DELETE without it: 400 MISSING_ACTOR. */
export function actorMiddleware(req, res, next) {
  req.actor = readActor(req);
  if (!req.actor && MUTATING_METHODS.has(req.method)) {
    next(
      new AppError('MISSING_ACTOR', 400, 'Set the X-Actor header to your name for this request'),
    );
    return;
  }
  next();
}
