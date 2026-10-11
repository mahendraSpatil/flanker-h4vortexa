// Owner: Mahendra | Stretch: plain-language explanation of a verification result for the registry app only
// (the verifier uses its own deterministic templates and never calls the server)

/**
 * Explain a verdict in 2-3 plain sentences. Uses Gemini via @google/genai when config.aiMode is
 * "gemini", otherwise (or on failure) a fixed template per result code. Never changes the verdict.
 * @param {{ verdict: string, checks: object[] }} result output of verify() from @proofchain/core
 * @returns {Promise<{ explanation: string, path: 'ai' | 'template' }>}
 */
export async function explainResult({ verdict, checks }) {
  throw new Error('NOT_IMPLEMENTED: explainResult');
}
