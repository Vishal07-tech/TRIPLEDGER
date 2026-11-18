const CURRENCY_SYMBOLS: Record<string, string> = {
  INR: '₹',
  USD: '$',
  EUR: '€',
  GBP: '£',
  AED: 'AED ',
  AUD: 'A$',
  CAD: 'C$',
  SGD: 'S$',
  JPY: '¥',
};

export function currencySymbol(currency: string): string {
  return CURRENCY_SYMBOLS[currency.toUpperCase()] ?? `${currency.toUpperCase()} `;
}

/**
 * Money is aggregated in minor units so repeated additions never drift the way
 * binary floating point does. Inputs come from the API as decimal strings.
 */
export function parseMoneyToMinor(value: string | number | null | undefined): number {
  if (value === null || value === undefined) return 0;
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.round(numeric * 100);
}

export function formatMinor(minor: number, currency: string): string {
  const sign = minor < 0 ? '-' : '';
  const absolute = Math.abs(minor);
  const whole = Math.floor(absolute / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const fraction = (absolute % 100).toString().padStart(2, '0');
  return `${sign}${currencySymbol(currency)}${whole}.${fraction}`;
}

export function formatMoney(value: string | number | null | undefined, currency: string): string {
  return formatMinor(parseMoneyToMinor(value), currency);
}
