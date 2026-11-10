/**
 * Display only: splits generated strategy.py so the helpers above strategy() can be folded away.
 * The two parts are plain slices, so helpers + strategy is always the original code, byte for byte.
 * What gets submitted never goes through here (see submissionOf).
 */
export function splitHelpers(code: string): { helpers: string; strategy: string } | null {
  const at = code.search(/^def strategy\(/m)
  if (at <= 0) return null
  const helpers = code.slice(0, at)
  // Only a real helper is worth folding: Round 1's lone "import random" stays in view
  if (!/^def /m.test(helpers)) return null
  return { helpers, strategy: code.slice(at) }
}
