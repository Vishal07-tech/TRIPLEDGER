import {
  formatJoinCode,
  parseAmountInput,
  parseTripDateInput,
  validateTripDateRange,
} from './tripForm';

describe('trip form validation', () => {
  it('accepts real calendar dates only', () => {
    expect(parseTripDateInput('2026-12-01')).toBe('2026-12-01');
    expect(parseTripDateInput('2026-02-28')).toBe('2026-02-28');
    expect(parseTripDateInput('2028-02-29')).toBe('2028-02-29');
    expect(parseTripDateInput(' 2026-12-01 ')).toBe('2026-12-01');
  });

  it('rejects empty, malformed and impossible dates', () => {
    expect(parseTripDateInput('')).toBeNull();
    expect(parseTripDateInput('   ')).toBeNull();
    expect(parseTripDateInput('01-12-2026')).toBeNull();
    expect(parseTripDateInput('2026-13-01')).toBeNull();
    expect(parseTripDateInput('2026-02-31')).toBeNull();
  });

  it('treats both empty dates as a valid open-ended trip', () => {
    expect(validateTripDateRange('', '')).toEqual({});
  });

  it('requires the pair of dates together', () => {
    expect(validateTripDateRange('2026-12-01', '')).toEqual({
      endDate: 'Add an end date or leave both dates empty.',
    });
    expect(validateTripDateRange('', '2026-12-05')).toEqual({
      startDate: 'Add a start date or leave both dates empty.',
    });
  });

  it('rejects an inverted range', () => {
    expect(validateTripDateRange('2026-12-05', '2026-12-01')).toEqual({
      endDate: 'The end date cannot be before the start date.',
    });
    expect(validateTripDateRange('2026-12-01', '2026-12-01')).toEqual({});
  });

  it('reports invalid dates before range errors', () => {
    expect(validateTripDateRange('bad', '2026-12-01')).toEqual({
      startDate: 'Use YYYY-MM-DD, for example 2026-12-01.',
    });
  });

  it('normalises amounts people actually type', () => {
    expect(parseAmountInput('450')).toBe('450.00');
    expect(parseAmountInput(' 450.5 ')).toBe('450.50');
    expect(parseAmountInput('1,200.75')).toBe('1200.75');
    expect(parseAmountInput('1 200')).toBe('1200.00');
  });

  it('rejects zero, negative and malformed amounts', () => {
    expect(parseAmountInput('0')).toBeNull();
    expect(parseAmountInput('0.00')).toBeNull();
    expect(parseAmountInput('-10')).toBeNull();
    expect(parseAmountInput('12.345')).toBeNull();
    expect(parseAmountInput('abc')).toBeNull();
    expect(parseAmountInput('')).toBeNull();
  });

  it('groups join codes 4-4 for display without changing the value', () => {
    expect(formatJoinCode('ABCD2345')).toBe('ABCD 2345');
    expect(formatJoinCode('abcd2345')).toBe('ABCD 2345');
    expect(formatJoinCode('ABCD-2345')).toBe('ABCD 2345');
    expect(formatJoinCode(null)).toBe('');
    expect(formatJoinCode('ABC')).toBe('ABC');
  });
});
