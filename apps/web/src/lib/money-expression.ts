const TERM_PATTERN = /[+-]?\d+(?:\.\d{1,2})?/g;

export function parseRupeeExpression(value: string, allowNegative = false): number | null {
  const normalized = value.replace(/[₹,\s]/g, "");
  if (!normalized || !/^[+-]?\d+(?:\.\d{1,2})?(?:[+-]\d+(?:\.\d{1,2})?)*$/.test(normalized)) {
    return null;
  }
  const terms = normalized.match(TERM_PATTERN);
  if (!terms) return null;
  const paise = Math.round(terms.reduce((sum, term) => sum + Number(term), 0) * 100);
  if (!Number.isSafeInteger(paise) || (!allowNegative && paise < 0)) {
    return null;
  }
  return paise;
}

export function rupeeInput(paise: number): string {
  return (paise / 100).toFixed(2).replace(/\.?0+$/, "");
}
