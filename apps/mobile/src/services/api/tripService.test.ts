import { ApiError, type ApiClient } from './apiClient';
import { TripService } from './tripService';
import type { CreateTripInput, Trip } from '../../types/trips';

function makeTrip(overrides: Partial<Trip> = {}): Trip {
  return {
    id: 'trip-1',
    name: 'Coastal weekend',
    description: 'A short trip with friends.',
    startDate: '2026-12-01T00:00:00.000Z',
    endDate: '2026-12-05T00:00:00.000Z',
    baseCurrency: 'INR',
    status: 'ACTIVE',
    joinCode: 'ABCD2345',
    cashManagerUserId: 'user-1',
    createdByUserId: 'user-1',
    createdAt: '2026-11-01T10:00:00.000Z',
    updatedAt: '2026-11-01T10:00:00.000Z',
    members: [
      {
        id: 'member-1',
        tripId: 'trip-1',
        userId: 'user-1',
        role: 'OWNER',
        joinedAt: '2026-11-01T10:00:00.000Z',
        isActive: true,
        budgetLimit: null,
        user: { id: 'user-1', fullName: 'Test Owner', email: 'owner@example.com' },
      },
    ],
    settings: {
      id: 'settings-1',
      tripId: 'trip-1',
      allowMemberExpenseEdit: true,
      requireLocationConfirmation: true,
      allowPublicJoin: false,
      createdAt: '2026-11-01T10:00:00.000Z',
      updatedAt: '2026-11-01T10:00:00.000Z',
    },
    ...overrides,
  };
}

function createClient() {
  const request = jest.fn();
  const client = { request } as unknown as ApiClient;
  return { client, request };
}

describe('mobile trip service', () => {
  it('lists trips with the authenticated trip endpoint', async () => {
    const { client, request } = createClient();
    request.mockResolvedValue({ trips: [] });
    const service = new TripService(client);

    await service.listTrips();

    expect(request).toHaveBeenCalledWith('/api/trips', { method: 'GET', auth: 'required' });
  });

  it('extracts and returns the trips array', async () => {
    const { client, request } = createClient();
    const trips = [makeTrip(), makeTrip({ id: 'trip-2', name: 'Mountain week' })];
    request.mockResolvedValue({ trips });
    const service = new TripService(client);

    await expect(service.listTrips()).resolves.toEqual(trips);
  });

  it('requests a single trip by id', async () => {
    const { client, request } = createClient();
    request.mockResolvedValue({ trip: makeTrip() });
    const service = new TripService(client);

    await service.getTrip('trip-1');

    expect(request).toHaveBeenCalledWith('/api/trips/trip-1', { method: 'GET', auth: 'required' });
  });

  it('extracts and returns the trip object', async () => {
    const { client, request } = createClient();
    const trip = makeTrip();
    request.mockResolvedValue({ trip });
    const service = new TripService(client);

    await expect(service.getTrip('trip-1')).resolves.toEqual(trip);
  });

  it('creates a trip with a POST request', async () => {
    const { client, request } = createClient();
    request.mockResolvedValue({ trip: makeTrip() });
    const service = new TripService(client);
    const input: CreateTripInput = { name: 'Coastal weekend', baseCurrency: 'INR' };

    await expect(service.createTrip(input)).resolves.toEqual(makeTrip());

    expect(request).toHaveBeenCalledWith('/api/trips', {
      method: 'POST',
      auth: 'required',
      body: JSON.stringify(input),
    });
  });

  it('sends the supplied create request body unchanged', async () => {
    const { client, request } = createClient();
    request.mockResolvedValue({ trip: makeTrip() });
    const service = new TripService(client);
    const input: CreateTripInput = {
      name: 'Coastal weekend',
      description: 'A short trip with friends.',
      baseCurrency: 'INR',
      startDate: '2026-12-01',
      endDate: '2026-12-05',
      settings: {
        allowMemberExpenseEdit: true,
        requireLocationConfirmation: false,
        allowPublicJoin: true,
      },
    };

    await service.createTrip(input);

    const body = JSON.parse(request.mock.calls[0][1].body as string) as CreateTripInput;
    expect(body).toEqual(input);
  });

  it('extracts and returns the created trip object', async () => {
    const { client, request } = createClient();
    const trip = makeTrip({ id: 'trip-created', name: 'New trip' });
    request.mockResolvedValue({ trip });
    const service = new TripService(client);

    await expect(service.createTrip({ name: 'New trip', baseCurrency: 'INR' })).resolves.toEqual(trip);
  });

  it('propagates API errors from the existing client', async () => {
    const { client, request } = createClient();
    const error = new ApiError('You are not a member of this trip.', 403, 'http');
    request.mockRejectedValue(error);
    const service = new TripService(client);

    await expect(service.getTrip('trip-1')).rejects.toBe(error);
  });
});
