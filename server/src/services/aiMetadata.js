// Owner: Mahendra | Metadata suggestions from Gemini (JSON only, validated, 8 s timeout) with rule-based fallback
//
// Verified import under ESM (Node 24, @google/genai 2.28):
//   import { GoogleGenAI } from '@google/genai';
//   const ai = new GoogleGenAI({ apiKey: config.geminiApiKey });
//   const res = await ai.models.generateContent({ model, contents, config: { responseMimeType: 'application/json' } });
//   res.text  // the JSON string to parse and validate

/**
 * @typedef {object} MetadataSuggestions
 * @property {string|null} docType one of DOC_TYPES (anything else becomes "OTHER" with low confidence)
 * @property {string|null} issuer
 * @property {string|null} date "YYYY-MM-DD"
 * @property {{ docType: number, issuer: number, date: number }} confidence 0-1 per field
 * @property {{ docType: string, issuer: string, date: string }} evidence source line quoted per field;
 *   a value without evidence is dropped
 */

/**
 * Suggest docType, issuer and date for extracted text. Uses Gemini when config.aiMode is "gemini";
 * on AI_MODE=off, timeout, error or invalid output, runs the rule-based fallback instead.
 * @param {string} text extracted document text (only the first ~4,000 chars are sent)
 * @returns {Promise<{ suggestions: MetadataSuggestions, extractionPath: 'ai' | 'fallback' }>}
 */
export async function suggestMetadata(text) {
  throw new Error('NOT_IMPLEMENTED: suggestMetadata');
}
