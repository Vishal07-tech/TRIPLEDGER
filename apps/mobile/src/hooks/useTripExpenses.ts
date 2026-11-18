import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import { tripService } from '../services/api/tripService';
import type { TripExpense } from '../types/trips';

export const tripExpensesQueryKey = (tripId: string) => ['trips', tripId, 'expenses'] as const;

export function useTripExpenses(tripId: string): UseQueryResult<TripExpense[], Error> {
  return useQuery({
    queryKey: tripExpensesQueryKey(tripId),
    queryFn: () => tripService.listExpenses(tripId),
    enabled: Boolean(tripId),
  });
}
