export type Coordinates = {
  latitude: number;
  longitude: number;
};

const EARTH_RADIUS_METERS = 6_371_000;

function toRadians(degrees: number) {
  return (degrees * Math.PI) / 180;
}

/**
 * Great-circle distance between two points, in metres. Good enough for the
 * "how far away is everyone" line; it deliberately ignores elevation.
 */
export function distanceMeters(from: Coordinates, to: Coordinates): number {
  const deltaLat = toRadians(to.latitude - from.latitude);
  const deltaLon = toRadians(to.longitude - from.longitude);
  const fromLat = toRadians(from.latitude);
  const toLat = toRadians(to.latitude);

  const a =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(fromLat) * Math.cos(toLat) * Math.sin(deltaLon / 2) ** 2;

  return Math.round(2 * EARTH_RADIUS_METERS * Math.asin(Math.min(1, Math.sqrt(a))));
}

export function formatDistance(meters: number): string {
  if (!Number.isFinite(meters) || meters < 0) return 'Distance unknown';
  if (meters < 1000) return `${Math.max(1, Math.round(meters))} m away`;
  if (meters < 10_000) return `${(meters / 1000).toFixed(1)} km away`;
  return `${Math.round(meters / 1000)} km away`;
}

/** Human wording for how old a shared position is. */
export function formatLocationAge(updatedAt: string | null, now: number = Date.now()): string {
  if (!updatedAt) return 'Not sharing';

  const captured = Date.parse(updatedAt);
  if (!Number.isFinite(captured)) return 'Not sharing';

  const seconds = Math.max(0, Math.round((now - captured) / 1000));
  if (seconds < 45) return 'Live now';
  if (seconds < 90) return 'Updated 1 min ago';

  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `Updated ${minutes} min ago`;

  const hours = Math.round(minutes / 60);
  if (hours < 24) return `Updated ${hours} h ago`;

  return 'Out of date';
}

/** Google Maps deep link that opens the installed app when available. */
export function mapsUrlFor({ latitude, longitude }: Coordinates): string {
  return `https://www.google.com/maps/search/?api=1&query=${latitude},${longitude}`;
}
