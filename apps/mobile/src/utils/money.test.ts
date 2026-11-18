import { currencySymbol, formatMinor, formatMoney, parseMoneyToMinor } from './money';

describe('money helpers', () => {
  it('maps known currencies to symbols and falls back to an ISO prefix', () => {
    expect(currencySymbol('INR')).toBe('₹');
    expect(currencySymbol('usd')).toBe('$');
    expect(currencySymbol('AED')).toBe('AED ');
    expect(currencySymbol('CHF')).toBe('CHF ');
  });

  it('parses decimal strings into minor units without float drift', () => {
    expect(parseMoneyToMinor('10.10')).toBe(1010);
    expect(parseMoneyToMinor('0.01')).toBe(1);
    expect(parseMoneyToMinor(19.99)).toBe(1999);
    expect(parseMoneyToMinor('-4.50')).toBe(-450);
  });

  it('treats missing or unparseable values as zero', () => {
    expect(parseMoneyToMinor(null)).toBe(0);
    expect(parseMoneyToMinor(undefined)).toBe(0);
    expect(parseMoneyToMinor('not money')).toBe(0);
    expect(parseMoneyToMinor(Number.POSITIVE_INFINITY)).toBe(0);
  });

  it('formats minor units with thousands separators and two decimals', () => {
    expect(formatMinor(0, 'INR')).toBe('₹0.00');
    expect(formatMinor(5, 'USD')).toBe('$0.05');
    expect(formatMinor(123456789, 'INR')).toBe('₹1,234,567.89');
    expect(formatMinor(-123456, 'INR')).toBe('-₹1,234.56');
  });

  it('formats API decimal strings through the same path', () => {
    expect(formatMoney('1500.5', 'INR')).toBe('₹1,500.50');
    expect(formatMoney(null, 'EUR')).toBe('€0.00');
  });
});
