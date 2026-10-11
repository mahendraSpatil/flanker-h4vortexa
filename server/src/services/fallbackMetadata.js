// Owner: Mahendra | Rule-based metadata suggestions: date regexes, docType keyword map, issuer line match

/**
 * Suggest metadata without AI. Dates: DD/MM/YYYY, "14 June 2026", ISO. docType: keyword map.
 * Issuer: first line matching University, Institute, College, Pvt Ltd or Limited.
 * @param {string} text extracted document text
 * @returns {import('./aiMetadata.js').MetadataSuggestions} same shape as the AI path
 */
export function suggestMetadataByRules(text) {
  throw new Error('NOT_IMPLEMENTED: suggestMetadataByRules');
}
