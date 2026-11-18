import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';

import { tripService } from '../services/api/tripService';
import type { CreateTripInput, Trip } from '../types/trips';
import { tripsQueryKey } from './useTrips';

export function useCreateTrip(): UseMutationResult<Trip, Error, CreateTripInput> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: CreateTripInput) => tripService.createTrip(input),
    onSuccess: (trip) => {
      queryClient.setQueryData(tripsQueryKey, (existing: Trip[] | undefined) => {
        const rest = (existing ?? []).filter((candidate) => candidate.id !== trip.id);
        return [trip, ...rest];
      });
      void queryClient.invalidateQueries({ queryKey: tripsQueryKey });
    },
  });
}
