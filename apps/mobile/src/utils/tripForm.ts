import { parseCalendarDate } from './tripDisplay';

/**
 * Validates a `YYYY-MM-DD` field and returns the normalized value, or null when
 * the field is empty. Impossible calendar days (31 Feb) are rejected rather
 * than silently rolled forward.
 */
export function parseTripDateInput(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return null;
  return parseCalendarDate(trimmed) ? trimmed : null;
}

export type TripDateErrors = { startDate?: string; endDate?: string };

export function validateTripDateRange(startInput: string, endInput: string): TripDateErrors {
  const errors: TripDateErrors = {};
  const start = startInput.trim();
  const end = endInput.trim();

  if (start && !parseTripDateInput(start)) errors.startDate = 'Use YYYY-MM-DD, for example 2026-12-01.';
  if (end && !parseTripDateInput(end)) errors.endDate = 'Use YYYY-MM-DD, for example 2026-12-05.';
  if (errors.startDate || errors.endDate) return errors;

  if (start && !end) errors.endDate = 'Add an end date or leave both dates empty.';
  if (!start && end) errors.startDate = 'Add a start date or leave both dates empty.';

  if (start && end && parseTripDateInput(start)! > parseTripDateInput(end)!) {
    errors.endDate = 'The end date cannot be before the start date.';
  }

  return errors;
}

/**
 * Accepts the amount formats people actually type (spaces and thousands
 * separators) and returns a normalised 2-decimal string, or null when invalid.
 */
export function parseAmountInput(value: string): string | null {
  const cleaned = value.trim().replace(/[\s,]/g, '');
  if (!/^\d{1,9}(\.\d{1,2})?$/.test(cleaned)) return null;
  const numeric = Number(cleaned);
  if (!Number.isFinite(numeric) || numeric <= 0) return null;
  return numeric.toFixed(2);
}

/** Groups a join code 4-4 for readability without changing what is sent. */
export function formatJoinCode(code: string | null | undefined): string {
  if (!code) return '';
  const clean = code.replace(/[^A-Z0-9]/gi, '').toUpperCase();
  return clean.length === 8 ? `${clean.slice(0, 4)} ${clean.slice(4)}` : clean;
}
