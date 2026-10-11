// Owner: Archit (frozen; ask before changing) | Canonical record serialisation (json-sorted-v1), verbatim from CLAUDE.md

// Normalise one string field: NFC, trim, collapse inner whitespace
export const normText = (s) => s.normalize('NFC').trim().replace(/\s+/g, ' ');

// Build the canonical JSON string for a record (flat object, keys sorted)
export function canonicalJSON(record) {
  const r = {
    v: 1,
    recordId: record.recordId,
    fileHash: record.fileHash.toLowerCase(),
    docType: record.docType,
    issuer: normText(record.issuer),
    date: record.date,
  };
  const keys = Object.keys(r).sort(); // A -> Z
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + JSON.stringify(r[k])).join(',') + '}';
}
