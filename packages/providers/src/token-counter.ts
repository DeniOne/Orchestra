/**
 * Token counting via js-tiktoken (WASM port of tiktoken).
 * Lazy-loads WASM on first call. Uses o200k_base encoding (GPT-4o default).
 *
 * For Gemini: tiktoken approximation (Google uses SentencePiece).
 * Precise Gemini counting — Wave 5.
 */

let encoder: { encode: (text: string) => number[] } | null = null;

async function getEncoder() {
  if (!encoder) {
    const tiktoken = await import('js-tiktoken');
    encoder = tiktoken.getEncoding('o200k_base');
  }
  return encoder;
}

export async function countTokens(text: string): Promise<number> {
  const enc = await getEncoder();
  return enc.encode(text).length;
}
