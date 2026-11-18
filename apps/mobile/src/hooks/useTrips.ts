import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import { tripService } from '../services/api/tripService';
import type { Trip } from '../types/trips';

export const tripsQueryKey = ['trips'] as const;

export function useTrips(): UseQueryResult<Trip[], Error> {
  return useQuery({
    queryKey: tripsQueryKey,
    queryFn: () => tripService.listTrips(),
  });
}
