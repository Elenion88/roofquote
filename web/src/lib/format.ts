export const usd = (n: number, opts: { fractionDigits?: number } = {}) =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: opts.fractionDigits ?? 0,
    maximumFractionDigits: opts.fractionDigits ?? 0,
  }).format(n);

export const num = (n: number, digits = 0) =>
  new Intl.NumberFormat('en-US', { maximumFractionDigits: digits, minimumFractionDigits: digits }).format(n);

export const slug = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
