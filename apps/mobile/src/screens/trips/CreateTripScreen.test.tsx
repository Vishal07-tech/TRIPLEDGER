import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Share } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { ApiError } from '../../services/api/apiClient';
import { tripService } from '../../services/api/tripService';
import type { AppStackParamList } from '../../types/auth';
import type { Trip, TripMember } from '../../types/trips';
import CreateTripScreen from './CreateTripScreen';

jest.mock('react-native-safe-area-context', () => {
  const React = jest.requireActual('react');
  const safeAreaInsets = React.createContext({ top: 0, right: 0, bottom: 0, left: 0 });
  return {
    SafeAreaProvider: ({ children }: React.PropsWithChildren) => React.createElement(React.Fragment, null, children),
    SafeAreaView: ({ children }: React.PropsWithChildren) => React.createElement(React.Fragment, null, children),
    SafeAreaInsetsContext: safeAreaInsets,
    initialWindowMetrics: null,
    useSafeAreaInsets: () => React.useContext(safeAreaInsets),
  };
});

jest.mock('../../services/api/tripService', () => ({
  tripService: { createTrip: jest.fn() },
}));

const mockedCreateTrip = jest.mocked(tripService.createTrip);

function makeMember(): TripMember {
  return {
    id: 'member-1',
    tripId: 'trip-1',
    userId: 'user-1',
    role: 'OWNER',
    joinedAt: '2026-11-01T10:00:00.000Z',
    isActive: true,
    budgetLimit: null,
    user: { id: 'user-1', fullName: 'Alex Morgan', email: 'alex@example.test' },
  };
}

function makeTrip(overrides: Partial<Trip> = {}): Trip {
  return {
    id: 'trip-1',
    name: 'Goa long weekend',
    description: null,
    startDate: null,
    endDate: null,
    baseCurrency: 'INR',
    status: 'ACTIVE',
    joinCode: 'ABCD2345',
    cashManagerUserId: 'user-1',
    createdByUserId: 'user-1',
    createdAt: '2026-11-01T10:00:00.000Z',
    updatedAt: '2026-11-01T10:00:00.000Z',
    members: [makeMember()],
    settings: null,
    ...overrides,
  };
}

function renderScreen() {
  const goBack = jest.fn();
  const navigate = jest.fn();
  const replace = jest.fn();
  const popToTop = jest.fn();
  const props = {
    navigation: { goBack, navigate, replace, popToTop },
    route: { key: 'CreateTrip', name: 'CreateTrip' },
  } as unknown as NativeStackScreenProps<AppStackParamList, 'CreateTrip'>;

  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const result = render(
    <QueryClientProvider client={queryClient}>
      <SafeAreaProvider>
        <CreateTripScreen {...props} />
      </SafeAreaProvider>
    </QueryClientProvider>,
  );

  return { ...result, goBack, navigate, replace, popToTop };
}

describe('Create trip screen', () => {
  beforeEach(() => {
    mockedCreateTrip.mockReset();
  });

  it('rejects an empty trip name without calling the API', () => {
    renderScreen();

    fireEvent.press(screen.getByTestId('create-trip-submit'));

    expect(screen.getByText('Use at least 2 characters.')).toBeTruthy();
    expect(mockedCreateTrip).not.toHaveBeenCalled();
  });

  it('rejects an end date that is before the start date', () => {
    renderScreen();

    fireEvent.changeText(screen.getByTestId('create-trip-name'), 'Goa weekend');
    fireEvent.changeText(screen.getByTestId('create-trip-start'), '2026-12-05');
    fireEvent.changeText(screen.getByTestId('create-trip-end'), '2026-12-01');
    fireEvent.press(screen.getByTestId('create-trip-submit'));

    expect(screen.getByText('The end date cannot be before the start date.')).toBeTruthy();
    expect(mockedCreateTrip).not.toHaveBeenCalled();
  });

  it('rejects impossible calendar dates', () => {
    renderScreen();

    fireEvent.changeText(screen.getByTestId('create-trip-name'), 'Goa weekend');
    fireEvent.changeText(screen.getByTestId('create-trip-start'), '2026-02-31');
    fireEvent.changeText(screen.getByTestId('create-trip-end'), '2026-03-02');
    fireEvent.press(screen.getByTestId('create-trip-submit'));

    expect(screen.getByText('Use YYYY-MM-DD, for example 2026-12-01.')).toBeTruthy();
    expect(mockedCreateTrip).not.toHaveBeenCalled();
  });

  it('requires both dates when only one is filled in', () => {
    renderScreen();

    fireEvent.changeText(screen.getByTestId('create-trip-name'), 'Goa weekend');
    fireEvent.changeText(screen.getByTestId('create-trip-start'), '2026-12-01');
    fireEvent.press(screen.getByTestId('create-trip-submit'));

    expect(screen.getByText('Add an end date or leave both dates empty.')).toBeTruthy();
    expect(mockedCreateTrip).not.toHaveBeenCalled();
  });

  it('submits trimmed details and shows the generated join code', async () => {
    mockedCreateTrip.mockResolvedValue(makeTrip());

    renderScreen();

    fireEvent.changeText(screen.getByTestId('create-trip-name'), '  Goa long weekend  ');
    fireEvent.changeText(screen.getByTestId('create-trip-description'), ' Beach, food, sunscreen. ');
    fireEvent.changeText(screen.getByTestId('create-trip-start'), '2026-12-01');
    fireEvent.changeText(screen.getByTestId('create-trip-end'), '2026-12-05');
    fireEvent.press(screen.getByTestId('create-trip-currency-USD'));
    fireEvent.press(screen.getByTestId('create-trip-submit'));

    await waitFor(() =>
      expect(mockedCreateTrip).toHaveBeenCalledWith({
        name: 'Goa long weekend',
        description: 'Beach, food, sunscreen.',
        baseCurrency: 'USD',
        startDate: '2026-12-01',
        endDate: '2026-12-05',
      }),
    );

    expect(await screen.findByTestId('create-trip-code')).toBeTruthy();
    expect(screen.getByText('ABCD 2345')).toBeTruthy();
    expect(screen.getByText('Goa long weekend')).toBeTruthy();
  });

  it('shares the join code with the platform share sheet', async () => {
    mockedCreateTrip.mockResolvedValue(makeTrip());
    const share = jest.spyOn(Share, 'share').mockResolvedValue({ action: 'sharedAction', activityType: undefined });

    renderScreen();

    fireEvent.changeText(screen.getByTestId('create-trip-name'), 'Goa long weekend');
    fireEvent.press(screen.getByTestId('create-trip-submit'));
    fireEvent.press(await screen.findByTestId('create-trip-share'));

    await waitFor(() => expect(share).toHaveBeenCalledTimes(1));
    expect(share.mock.calls[0][0]).toMatchObject({
      message: expect.stringContaining('ABCD2345'),
    });
  });

  it('opens the new trip or returns home from the success card', async () => {
    mockedCreateTrip.mockResolvedValue(makeTrip());

    const { replace, popToTop } = renderScreen();

    fireEvent.changeText(screen.getByTestId('create-trip-name'), 'Goa long weekend');
    fireEvent.press(screen.getByTestId('create-trip-submit'));

    fireEvent.press(await screen.findByTestId('create-trip-open'));
    expect(replace).toHaveBeenCalledWith('TripDetail', { tripId: 'trip-1', tripName: 'Goa long weekend' });

    fireEvent.press(screen.getByTestId('create-trip-home'));
    expect(popToTop).toHaveBeenCalledTimes(1);
  });

  it('shows the server message when the trip cannot be created', async () => {
    mockedCreateTrip.mockRejectedValue(new ApiError('Trip name is already in use.', 409, 'http'));

    renderScreen();

    fireEvent.changeText(screen.getByTestId('create-trip-name'), 'Goa long weekend');
    fireEvent.press(screen.getByTestId('create-trip-submit'));

    expect(await screen.findByText('Trip name is already in use.')).toBeTruthy();
    expect(screen.queryByTestId('create-trip-code')).toBeNull();
  });

  it('hides unexpected server details behind generic copy', async () => {
    mockedCreateTrip.mockRejectedValue(new ApiError('prisma: unique constraint failed', 500, 'http'));

    renderScreen();

    fireEvent.changeText(screen.getByTestId('create-trip-name'), 'Goa long weekend');
    fireEvent.press(screen.getByTestId('create-trip-submit'));

    expect(await screen.findByText('We could not create the trip. Check your connection and try again.')).toBeTruthy();
    expect(screen.queryByText('prisma: unique constraint failed')).toBeNull();
  });
});
