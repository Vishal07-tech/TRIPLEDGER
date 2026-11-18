import { distanceMeters, formatDistance, formatLocationAge, mapsUrlFor } from './geo';

describe('distanceMeters', () => {
  it('returns zero for the same point', () => {
    expect(distanceMeters({ latitude: 10, longitude: 78 }, { latitude: 10, longitude: 78 })).toBe(0);
  });

  it('measures a known short hop', () => {
    // About 1.1 km per 0.01 degrees of latitude.
    const meters = distanceMeters({ latitude: 10.79, longitude: 78.7 }, { latitude: 10.8, longitude: 78.7 });
    expect(meters).toBeGreaterThan(1000);
    expect(meters).toBeLessThan(1200);
  });
});

describe('formatDistance', () => {
  it('shows metres below one kilometre', () => {
    expect(formatDistance(240)).toBe('240 m away');
  });

  it('shows one decimal place for a few kilometres', () => {
    expect(formatDistance(1500)).toBe('1.5 km away');
  });

  it('rounds longer distances', () => {
    expect(formatDistance(12400)).toBe('12 km away');
  });

  it('handles missing data', () => {
    expect(formatDistance(Number.NaN)).toBe('Distance unknown');
  });
});

describe('formatLocationAge', () => {
  const now = Date.parse('2026-11-18T10:00:00.000Z');

  it('treats a fresh position as live', () => {
    expect(formatLocationAge('2026-11-18T09:59:50.000Z', now)).toBe('Live now');
  });

  it('describes minutes', () => {
    expect(formatLocationAge('2026-11-18T09:57:00.000Z', now)).toBe('Updated 3 min ago');
  });

  it('describes hours', () => {
    expect(formatLocationAge('2026-11-18T07:00:00.000Z', now)).toBe('Updated 3 h ago');
  });

  it('marks very old positions', () => {
    expect(formatLocationAge('2026-11-16T09:00:00.000Z', now)).toBe('Out of date');
  });

  it('treats a missing position as not sharing', () => {
    expect(formatLocationAge(null, now)).toBe('Not sharing');
  });
});

describe('mapsUrlFor', () => {
  it('builds a Google Maps search link', () => {
    expect(mapsUrlFor({ latitude: 10.7905, longitude: 78.7047 })).toBe(
      'https://www.google.com/maps/search/?api=1&query=10.7905,78.7047',
    );
  });
});
