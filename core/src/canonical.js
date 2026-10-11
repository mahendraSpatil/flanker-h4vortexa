// Owner: Archit (frozen; ask before changing) | Canonical serialisation (json-sorted-v1) of records and field leaves, as in CLAUDE.md

// Normalise one string field: NFC, trim, collapse inner whitespace
export const normText = (s) => s.normalize('NFC').trim().replace(/\s+/g, ' ');

// json-sorted-v1: a flat object as JSON with keys sorted A -> Z and no whitespace
export function sortedJSON(flat) {
  const keys = Object.keys(flat).sort(); // A -> Z
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + JSON.stringify(flat[k])).join(',') + '}';
}

// Build the canonical JSON string for a record (flat object, keys sorted).
// A record with a fieldsRoot is v2; without one it is v1, byte-identical to before field trees.
export function canonicalJSON(record) {
  const r = {
    v: 1,
    recordId: record.recordId,
    fileHash: record.fileHash.toLowerCase(),
    docType: record.docType,
    issuer: normText(record.issuer),
    date: record.date,
  };
  if (record.fieldsRoot !== undefined) {
    r.v = 2;
    r.fieldsRoot = record.fieldsRoot.toLowerCase();
  }
  return sortedJSON(r);
}
