import type { Trip, TripStatus } from '../types/trips';

export type TripGroupKey = 'active' | 'upcoming' | 'completed';

export type TripGroup = {
  key: TripGroupKey;
  title: string;
  data: Trip[];
};

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;
const COMPLETED_STATUSES: TripStatus[] = ['TRIP_CLOSED', 'FULLY_SETTLED'];

type CalendarDate = {
  key: string;
  year: number;
  month: number;
  day: number;
};

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

/**
 * Reads the calendar portion of an API date without letting the device timezone
 * shift the day. Returns null for missing or impossible calendar dates.
 */
export function parseCalendarDate(value: string | null | undefined): CalendarDate | null {
  if (typeof value !== 'string') return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value.trim());
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day);
  date.setHours(0, 0, 0, 0);

  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    return null;
  }

  return { key: `${match[1]}-${match[2]}-${match[3]}`, year, month, day };
}

export function localDateKey(value: Date): string {
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
}

export function formatTripDate(value: string | null | undefined): string | null {
  const parsed = parseCalendarDate(value);
  if (!parsed) return null;
  return `${parsed.day} ${MONTHS[parsed.month - 1]} ${parsed.year}`;
}

/**
 * Formats an instant (for example a member's join time) on the device's local
 * calendar day. Unlike trip start/end dates, a timestamp must follow the
 * viewer's clock: 19:30 UTC is already the next day in IST.
 */
export function formatTimestampDate(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const time = Date.parse(value.trim());
  if (Number.isNaN(time)) return null;

  const date = new Date(time);
  return `${date.getDate()} ${MONTHS[date.getMonth()]} ${date.getFullYear()}`;
}

export function formatTripDateRange(
  startDate: string | null | undefined,
  endDate: string | null | undefined,
): string {
  const startLabel = formatTripDate(startDate);
  const endLabel = formatTripDate(endDate);

  if (startLabel && endLabel) return `${startLabel} – ${endLabel}`;
  if (startLabel) return `From ${startLabel}`;
  if (endLabel) return `Until ${endLabel}`;
  return 'Dates not set';
}

export function countActiveMembers(trip: Pick<Trip, 'members'>): number {
  return trip.members.filter((member) => member.isActive === true).length;
}

export function formatTripStatus(status: TripStatus): string {
  return status.split('_').join(' ');
}

/**
 * Mirrors apps/web/src/pages/TripsPage.tsx:
 * completed = TRIP_CLOSED/FULLY_SETTLED or end date before today;
 * upcoming = not completed and start date after today;
 * active = everything else, including trips without dates.
 * Empty groups are omitted for the mobile layout.
 */
export function groupTrips(trips: Trip[], now: Date = new Date()): TripGroup[] {
  const todayKey = localDateKey(now);

  const completed = trips.filter((trip) => {
    if (COMPLETED_STATUSES.includes(trip.status)) return true;
    const endKey = parseCalendarDate(trip.endDate)?.key;
    return Boolean(endKey && endKey < todayKey);
  });
  const completedIds = new Set(completed.map((trip) => trip.id));

  const upcoming = trips.filter((trip) => {
    if (completedIds.has(trip.id)) return false;
    const startKey = parseCalendarDate(trip.startDate)?.key;
    return Boolean(startKey && startKey > todayKey);
  });
  const upcomingIds = new Set(upcoming.map((trip) => trip.id));

  const active = trips.filter((trip) => !completedIds.has(trip.id) && !upcomingIds.has(trip.id));

  return [
    { key: 'active' as const, title: 'Active trips', data: active },
    { key: 'upcoming' as const, title: 'Upcoming trips', data: upcoming },
    { key: 'completed' as const, title: 'Completed trips', data: completed },
  ].filter((group) => group.data.length > 0);
}
