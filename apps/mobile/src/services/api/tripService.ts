import { apiClient, type ApiClient } from './apiClient';
import type {
  CreateExpenseInput,
  CreateTripInput,
  ShareLocationInput,
  Trip,
  TripBalances,
  TripExpense,
  TripLocations,
} from '../../types/trips';

export class TripService {
  constructor(private readonly client: ApiClient) {}

  async listTrips(): Promise<Trip[]> {
    const response = await this.client.request<{ trips: Trip[] }>('/api/trips', {
      method: 'GET',
      auth: 'required',
    });
    return response.trips;
  }

  async getTrip(tripId: string): Promise<Trip> {
    const response = await this.client.request<{ trip: Trip }>(`/api/trips/${tripId}`, {
      method: 'GET',
      auth: 'required',
    });
    return response.trip;
  }

  async createTrip(input: CreateTripInput): Promise<Trip> {
    const response = await this.client.request<{ trip: Trip }>('/api/trips', {
      method: 'POST',
      auth: 'required',
      body: JSON.stringify(input),
    });
    return response.trip;
  }

  async joinTrip(code: string): Promise<Trip> {
    const response = await this.client.request<{ trip: Trip }>('/api/trips/join', {
      method: 'POST',
      auth: 'required',
      body: JSON.stringify({ code }),
    });
    return response.trip;
  }

  async listExpenses(tripId: string): Promise<TripExpense[]> {
    const response = await this.client.request<{ expenses: TripExpense[] }>(
      `/api/trips/${tripId}/expenses`,
      { method: 'GET', auth: 'required' },
    );
    return response.expenses;
  }

  async getTripBalances(tripId: string): Promise<TripBalances> {
    return this.client.request<TripBalances>(`/api/trips/${tripId}/expenses/balances`, {
      method: 'GET',
      auth: 'required',
    });
  }

  async createExpense(tripId: string, input: CreateExpenseInput): Promise<TripExpense> {
    const response = await this.client.request<{ expense: TripExpense }>(
      `/api/trips/${tripId}/expenses`,
      {
        method: 'POST',
        auth: 'required',
        body: JSON.stringify(input),
      },
    );
    return response.expense;
  }

  async listTripLocations(tripId: string): Promise<TripLocations> {
    return this.client.request<TripLocations>(`/api/trips/${tripId}/locations`, {
      method: 'GET',
      auth: 'required',
    });
  }

  async shareTripLocation(tripId: string, input: ShareLocationInput): Promise<void> {
    await this.client.request(`/api/trips/${tripId}/locations`, {
      method: 'PUT',
      auth: 'required',
      body: JSON.stringify(input),
    });
  }

  async stopSharingTripLocation(tripId: string): Promise<void> {
    await this.client.request(`/api/trips/${tripId}/locations`, {
      method: 'DELETE',
      auth: 'required',
    });
  }
}

export const tripService = new TripService(apiClient);
