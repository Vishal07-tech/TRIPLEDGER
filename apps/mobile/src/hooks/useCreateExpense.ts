import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';

import { tripService } from '../services/api/tripService';
import type { CreateExpenseInput, TripExpense } from '../types/trips';
import { tripsQueryKey } from './useTrips';

type Variables = { tripId: string; input: CreateExpenseInput };

export function useCreateExpense(): UseMutationResult<TripExpense, Error, Variables> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ tripId, input }: Variables) => tripService.createExpense(tripId, input),
    onSuccess: () => {
      // Group totals appear on the trip list, the detail screen, the expense
      // list and the balances panel, so refresh the whole trip prefix.
      void queryClient.invalidateQueries({ queryKey: ['trips'] });
    },
  });
}
