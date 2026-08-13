const STOP_WORDS = new Set(["a", "an", "and", "about", "add", "does", "explain", "for", "how", "is", "it", "of", "the", "this", "to", "way", "what", "why", "work", "works"]);

export const queryTokens = (request: string): string[] =>
  [...new Set(request.toLowerCase().split(/[^a-z0-9_./-]+/).filter((token) => token.length > 1 && !STOP_WORDS.has(token)))];

export const lexicalRelevance = (text: string, request: string): number => {
  const lower = text.toLowerCase();
  const tokens = queryTokens(request);
  if (!tokens.length) return 0;
  const matched = tokens.filter((token) => lower.includes(token) || (token.length >= 4 && lower.includes(token.slice(0, 4)))).length;
  const phrase = lower.includes(request.toLowerCase()) ? 0.25 : 0;
  return Math.min(1, matched / tokens.length + phrase);
};
