import type { Trip, TripMember } from '../types/trips';
import {
  countActiveMembers,
  formatTimestampDate,
  formatTripDate,
  formatTripDateRange,
  groupTrips,
} from './tripDisplay';

function makeMember(overrides: Partial<TripMember> = {}): TripMember {
  return {
    id: 'member-1',
    tripId: 'trip-1',
    userId: 'user-1',
    role: 'OWNER',
    joinedAt: '2026-11-01T10:00:00.000Z',
    isActive: true,
    budgetLimit: null,
    user: { id: 'user-1', fullName: 'Alex Morgan', email: 'alex@example.test' },
    ...overrides,
  };
}

function makeTrip(overrides: Partial<Trip> = {}): Trip {
  return {
    id: 'trip-1',
    name: 'Coastal weekend',
    description: 'A short trip with friends.',
    startDate: '2026-12-01T00:00:00.000Z',
    endDate: '2026-12-05T00:00:00.000Z',
    baseCurrency: 'INR',
    status: 'ACTIVE',
    joinCode: 'ABCD2345',
    cashManagerUserId: 'user-1',
    createdByUserId: 'user-1',
    createdAt: '2026-11-01T10:00:00.000Z',
    updatedAt: '2026-11-01T10:00:00.000Z',
    members: [
      makeMember(),
      makeMember({ id: 'member-2', userId: 'user-2' }),
      makeMember({ id: 'member-3', userId: 'user-3', isActive: false }),
    ],
    settings: null,
    ...overrides,
  };
}

const now = new Date(2026, 10, 16, 12, 0, 0);

describe('trip display helpers', () => {
  it('formats a full calendar date range from API timestamps', () => {
    expect(formatTripDateRange('2026-12-01T00:00:00.000Z', '2026-12-05T00:00:00.000Z'))
      .toBe('1 Dec 2026 – 5 Dec 2026');
  });

  it('handles missing and one-sided dates', () => {
    expect(formatTripDateRange(null, null)).toBe('Dates not set');
    expect(formatTripDateRange('2026-12-01T00:00:00.000Z', null)).toBe('From 1 Dec 2026');
    expect(formatTripDateRange(null, '2026-12-05T00:00:00.000Z')).toBe('Until 5 Dec 2026');
  });

  it('treats invalid or impossible dates as absent', () => {
    expect(formatTripDateRange('not-a-date', '2026-02-30T00:00:00.000Z')).toBe('Dates not set');
    expect(formatTripDateRange('2026-02-30', '2026-12-05')).toBe('Until 5 Dec 2026');
  });

  it('formats join timestamps on the local calendar day', () => {
    const iso = '2026-11-01T19:30:00.000Z';
    const local = new Date(iso);
    const month = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][local.getMonth()];

    expect(formatTimestampDate(iso)).toBe(`${local.getDate()} ${month} ${local.getFullYear()}`);
  });

  // Meaningful in zones ahead of UTC, like the IST device this ships to:
  // 19:30Z is already 02 Nov locally, while the UTC calendar day says 01 Nov.
  const itAheadOfUtc = new Date().getTimezoneOffset() < 0 ? it : it.skip;
  itAheadOfUtc('shows the local join day when it differs from the UTC day', () => {
    expect(formatTimestampDate('2026-11-01T19:30:00.000Z')).toBe('2 Nov 2026');
    expect(formatTripDate('2026-11-01T19:30:00.000Z')).toBe('1 Nov 2026');
  });

  it('treats missing or unparseable join timestamps as absent', () => {
    expect(formatTimestampDate(null)).toBeNull();
    expect(formatTimestampDate(undefined)).toBeNull();
    expect(formatTimestampDate('not-a-date')).toBeNull();
  });

  it('groups by the local calendar day without UTC off-by-one drift', () => {
    const trips = [
      makeTrip({ id: 'ends-today', startDate: '2026-11-01T00:00:00.000Z', endDate: '2026-11-16T00:00:00.000Z' }),
      makeTrip({ id: 'ended-yesterday', startDate: '2026-11-01T00:00:00.000Z', endDate: '2026-11-15T00:00:00.000Z' }),
    ];

    const groups = groupTrips(trips, new Date(2026, 10, 16, 23, 59));

    expect(groups.find((group) => group.key === 'active')?.data.map((trip) => trip.id))
      .toEqual(['ends-today']);
    expect(groups.find((group) => group.key === 'completed')?.data.map((trip) => trip.id))
      .toEqual(['ended-yesterday']);
  });

  it('counts only active members', () => {
    expect(countActiveMembers(makeTrip())).toBe(2);
  });

  it('groups completed trips by status and past end date', () => {
    const trips = [
      makeTrip({ id: 'closed', status: 'TRIP_CLOSED', startDate: '2030-01-01', endDate: '2030-01-05' }),
      makeTrip({ id: 'settled', status: 'FULLY_SETTLED' }),
      makeTrip({ id: 'past', startDate: '2020-01-01', endDate: '2020-01-05' }),
    ];

    const groups = groupTrips(trips, now);

    expect(groups).toHaveLength(1);
    expect(groups[0].key).toBe('completed');
    expect(groups[0].data.map((trip) => trip.id)).toEqual(['closed', 'settled', 'past']);
  });

  it('groups future trips as upcoming', () => {
    const trips = [
      makeTrip({ id: 'future', startDate: '2026-11-17', endDate: '2026-11-20' }),
      makeTrip({ id: 'starts-today', startDate: '2026-11-16', endDate: '2026-11-20' }),
    ];

    const groups = groupTrips(trips, now);

    expect(groups.find((group) => group.key === 'upcoming')?.data.map((trip) => trip.id))
      .toEqual(['future']);
    expect(groups.find((group) => group.key === 'active')?.data.map((trip) => trip.id))
      .toEqual(['starts-today']);
  });

  it('groups ongoing trips as active', () => {
    const trips = [
      makeTrip({ id: 'ongoing', startDate: '2026-11-10', endDate: '2026-11-20' }),
    ];

    const groups = groupTrips(trips, now);

    expect(groups).toHaveLength(1);
    expect(groups[0].key).toBe('active');
    expect(groups[0].data.map((trip) => trip.id)).toEqual(['ongoing']);
  });

  it('keeps trips without dates in the active group', () => {
    const trips = [makeTrip({ id: 'undated', startDate: null, endDate: null })];

    const groups = groupTrips(trips, now);

    expect(groups[0].key).toBe('active');
    expect(groups[0].data.map((trip) => trip.id)).toEqual(['undated']);
  });

  it('applies completed, upcoming, active precedence like the web app', () => {
    const trips = [
      makeTrip({ id: 'closed-but-future', status: 'TRIP_CLOSED', startDate: '2030-01-01', endDate: '2030-01-05' }),
      makeTrip({ id: 'past-end-future-start', startDate: '2030-01-01', endDate: '2020-01-05' }),
      makeTrip({ id: 'future', startDate: '2026-11-17', endDate: '2026-11-20' }),
      makeTrip({ id: 'undated', startDate: null, endDate: null }),
    ];

    const groups = groupTrips(trips, now);
    const ids = Object.fromEntries(groups.map((group) => [group.key, group.data.map((trip) => trip.id)]));

    expect(ids).toEqual({
      active: ['undated'],
      upcoming: ['future'],
      completed: ['closed-but-future', 'past-end-future-start'],
    });
  });
});
