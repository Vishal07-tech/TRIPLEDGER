import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';

import { tripService } from '../services/api/tripService';
import type { Trip } from '../types/trips';
import { tripsQueryKey } from './useTrips';

export function useJoinTrip(): UseMutationResult<Trip, Error, string> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (code: string) => tripService.joinTrip(code),
    onSuccess: (trip) => {
      queryClient.setQueryData(tripsQueryKey, (existing: Trip[] | undefined) => {
        const rest = (existing ?? []).filter((candidate) => candidate.id !== trip.id);
        return [trip, ...rest];
      });
      queryClient.setQueryData(['trips', trip.id], trip);
      void queryClient.invalidateQueries({ queryKey: tripsQueryKey });
    },
  });
}
