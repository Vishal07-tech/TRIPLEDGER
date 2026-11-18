import { useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';

import { tripService } from '../services/api/tripService';
import type { Trip } from '../types/trips';
import { tripsQueryKey } from './useTrips';

export const tripQueryKey = (tripId: string) => ['trips', tripId] as const;

/**
 * Loads one trip. When the list already holds the trip, that copy is used as
 * initial data so the detail screen paints immediately, and it is revalidated
 * once the list copy is older than the configured stale time. Keeping the id
 * inside the `['trips']` prefix means list invalidation also refreshes open
 * detail screens.
 */
export function useTrip(tripId: string): UseQueryResult<Trip, Error> {
  const queryClient = useQueryClient();

  return useQuery({
    queryKey: tripQueryKey(tripId),
    queryFn: () => tripService.getTrip(tripId),
    initialData: () => queryClient.getQueryData<Trip[]>(tripsQueryKey)?.find((trip) => trip.id === tripId),
    // Inherit the list query's timestamp so the seed is not treated as fresher
    // than the list itself: no wasted fetch while fresh, revalidate once stale.
    initialDataUpdatedAt: () => queryClient.getQueryState(tripsQueryKey)?.dataUpdatedAt,
  });
}
