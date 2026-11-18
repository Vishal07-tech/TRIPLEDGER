import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import { tripService } from '../services/api/tripService';
import type { TripLocations } from '../types/trips';

export const tripLocationsQueryKey = (tripId: string) => ['trips', tripId, 'locations'] as const;

/**
 * Refreshes on a short interval so the list behaves like a live view while the
 * location screen is open, and stops as soon as that screen unmounts.
 */
export function useTripLocations(
  tripId: string,
  options: { enabled?: boolean; refreshMs?: number } = {},
): UseQueryResult<TripLocations, Error> {
  const { enabled = true, refreshMs = 15_000 } = options;

  return useQuery({
    queryKey: tripLocationsQueryKey(tripId),
    queryFn: () => tripService.listTripLocations(tripId),
    enabled: Boolean(tripId) && enabled,
    refetchInterval: enabled ? refreshMs : false,
    refetchIntervalInBackground: false,
    staleTime: 0,
  });
}
