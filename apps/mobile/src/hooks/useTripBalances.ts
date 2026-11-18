import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import { tripService } from '../services/api/tripService';
import type { TripBalances } from '../types/trips';

export const tripBalancesQueryKey = (tripId: string) => ['trips', tripId, 'balances'] as const;

export function useTripBalances(tripId: string): UseQueryResult<TripBalances, Error> {
  return useQuery({
    queryKey: tripBalancesQueryKey(tripId),
    queryFn: () => tripService.getTripBalances(tripId),
    enabled: Boolean(tripId),
  });
}
