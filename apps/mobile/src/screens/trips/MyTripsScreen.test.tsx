import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { RefreshControl, SectionList } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { AuthProvider, type AuthOperations } from '../../auth/AuthContext';
import RootNavigator from '../../navigation/RootNavigator';
import { ApiError } from '../../services/api/apiClient';
import { tripService } from '../../services/api/tripService';
import type { SecureTokenStorage } from '../../services/storage/secureStorage';
import type { AppStackParamList, AuthUser } from '../../types/auth';
import type { Trip, TripMember } from '../../types/trips';
import MyTripsScreen from './MyTripsScreen';

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
  tripService: { listTrips: jest.fn() },
}));

const mockedListTrips = jest.mocked(tripService.listTrips);

function makeMember(overrides: Partial<TripMember> = {}): TripMember {
  return {
    id: 'member-1',
    tripId: 'trip-1',
    userId: 'user-1',
    role: 'OWNER',
    joinedAt: '2026-11-01T10:00:00.000Z',
    isActive: true,
    budgetLimit: null,
    user: { id: 'user-1', fullName: 'Alex Morgan', email: 'alex@example.test' },
    ...overrides,
  };
}

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
      makeMember(),
      makeMember({ id: 'member-2', userId: 'user-2' }),
      makeMember({ id: 'member-3', userId: 'user-3', isActive: false }),
    ],
    settings: null,
    ...overrides,
  };
}

function renderScreen() {
  const goBack = jest.fn();
  const navigate = jest.fn();
  const props = {
    navigation: { goBack, navigate },
    route: { key: 'MyTrips', name: 'MyTrips' },
  } as unknown as NativeStackScreenProps<AppStackParamList, 'MyTrips'>;
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const result = render(
    <QueryClientProvider client={queryClient}>
      <SafeAreaProvider>
        <MyTripsScreen {...props} />
      </SafeAreaProvider>
    </QueryClientProvider>,
  );
  return { ...result, goBack, navigate };
}

describe('My Trips screen', () => {
  beforeEach(() => {
    mockedListTrips.mockReset();
  });

  it('shows a loading indicator while the request is pending', async () => {
    mockedListTrips.mockReturnValue(new Promise<Trip[]>(() => undefined));

    renderScreen();

    expect(await screen.findByText('Loading your trips…')).toBeTruthy();
  });

  it('renders trip cards with dates, currency, status and active-member count', async () => {
    mockedListTrips.mockResolvedValue([makeTrip()]);

    renderScreen();

    expect(await screen.findByText('Coastal weekend')).toBeTruthy();
    expect(screen.getByText('1 Dec 2026 – 5 Dec 2026')).toBeTruthy();
    expect(screen.getByText('INR')).toBeTruthy();
    expect(screen.getByText('ACTIVE')).toBeTruthy();
    expect(screen.getByText('2 active members')).toBeTruthy();
  });

  it('excludes inactive members from the count', async () => {
    mockedListTrips.mockResolvedValue([
      makeTrip({ members: [makeMember(), makeMember({ id: 'inactive', userId: 'user-9', isActive: false })] }),
    ]);

    renderScreen();

    expect(await screen.findByText('1 active member')).toBeTruthy();
    expect(screen.queryByText('2 active members')).toBeNull();
  });

  it('renders active, upcoming and completed sections in order', async () => {
    mockedListTrips.mockResolvedValue([
      makeTrip({
        id: 'completed',
        name: 'Past trip',
        status: 'TRIP_CLOSED',
        startDate: '2020-01-01T00:00:00.000Z',
        endDate: '2020-01-05T00:00:00.000Z',
      }),
      makeTrip({ id: 'active', name: 'Ongoing trip', startDate: '2020-01-01T00:00:00.000Z', endDate: '2030-01-05T00:00:00.000Z' }),
      makeTrip({ id: 'upcoming', name: 'Future trip', startDate: '2030-01-01T00:00:00.000Z', endDate: '2030-01-05T00:00:00.000Z' }),
    ]);

    renderScreen();

    await screen.findByText('Ongoing trip');
    expect(screen.getByText('Active trips')).toBeTruthy();
    expect(screen.getByText('Upcoming trips')).toBeTruthy();
    expect(screen.getByText('Completed trips')).toBeTruthy();
    expect(screen.getByText('Future trip')).toBeTruthy();
    expect(screen.getByText('Past trip')).toBeTruthy();
  });

  it('omits empty sections', async () => {
    mockedListTrips.mockResolvedValue([
      makeTrip({ id: 'active', name: 'Ongoing trip', startDate: '2020-01-01T00:00:00.000Z', endDate: '2030-01-05T00:00:00.000Z' }),
    ]);

    renderScreen();

    await screen.findByText('Ongoing trip');
    expect(screen.queryByText('Upcoming trips')).toBeNull();
    expect(screen.queryByText('Completed trips')).toBeNull();
  });

  it('shows the empty state for a successful empty response', async () => {
    mockedListTrips.mockResolvedValue([]);

    renderScreen();

    expect(await screen.findByText('No trips yet')).toBeTruthy();
    expect(screen.UNSAFE_getByType(SectionList)).toBeTruthy();
    const refreshControl = screen.UNSAFE_getByType(RefreshControl);
    expect(refreshControl).toBeTruthy();

    fireEvent(refreshControl, 'refresh');

    await waitFor(() => expect(mockedListTrips).toHaveBeenCalledTimes(2));
    expect(screen.getByText('No trips yet')).toBeTruthy();
  });

  it('shows an API error without exposing internals', async () => {
    mockedListTrips.mockRejectedValue(new ApiError('You are not a member of this trip.', 403, 'http'));

    renderScreen();

    expect(await screen.findByText('You are not a member of this trip.')).toBeTruthy();
    expect(screen.getByText('Couldn’t load your trips')).toBeTruthy();
    expect(screen.queryByText('No trips yet')).toBeNull();
  });

  it('retries the request when the retry action is pressed', async () => {
    mockedListTrips.mockRejectedValueOnce(new ApiError('The request timed out. Check your connection and try again.', 0, 'timeout'));
    mockedListTrips.mockResolvedValueOnce([makeTrip()]);

    renderScreen();

    fireEvent.press(await screen.findByTestId('my-trips-retry'));

    expect(await screen.findByText('Coastal weekend')).toBeTruthy();
    expect(mockedListTrips).toHaveBeenCalledTimes(2);
  });

  it('refetches when pull-to-refresh is triggered', async () => {
    mockedListTrips
      .mockResolvedValueOnce([makeTrip()])
      .mockResolvedValueOnce([makeTrip(), makeTrip({ id: 'trip-2', name: 'Mountain week' })]);

    renderScreen();

    await screen.findByText('Coastal weekend');
    fireEvent(screen.UNSAFE_getByType(RefreshControl), 'refresh');

    expect(await screen.findByText('Mountain week')).toBeTruthy();
    expect(mockedListTrips).toHaveBeenCalledTimes(2);
  });

  it('does not show create-trip or trip-details actions', async () => {
    mockedListTrips.mockResolvedValue([makeTrip()]);

    renderScreen();

    await screen.findByText('Coastal weekend');
    expect(screen.queryByText(/create trip/i)).toBeNull();
    expect(screen.queryByText(/trip members and settings/i)).toBeNull();
    expect(screen.queryByText(/open expense dashboard/i)).toBeNull();
  });

  it('opens the trip detail screen when a card is pressed', async () => {
    mockedListTrips.mockResolvedValue([makeTrip()]);

    const { navigate } = renderScreen();

    fireEvent.press(await screen.findByTestId('trip-card-trip-1'));

    expect(navigate).toHaveBeenCalledWith('TripDetail', {
      tripId: 'trip-1',
      tripName: 'Coastal weekend',
    });
  });

  it('exposes each trip card as a button with a readable label', async () => {
    mockedListTrips.mockResolvedValue([makeTrip()]);

    renderScreen();

    const card = await screen.findByTestId('trip-card-trip-1');
    expect(card.props.accessibilityRole).toBe('button');
    expect(card.props.accessibilityLabel).toBe(
      'Coastal weekend. 1 Dec 2026 – 5 Dec 2026. INR. ACTIVE. 2 active members.',
    );
  });

  it('navigates from the authenticated Home screen to My Trips', async () => {
    const user: AuthUser = { id: 'user-1', email: 'alex@example.test', fullName: 'Alex Morgan', role: 'MEMBER' };
    const service: AuthOperations = {
      setUnauthorizedHandler: jest.fn(),
      login: jest.fn().mockResolvedValue({ user, token: 'jwt-for-tests', message: 'Login successful.' }),
      register: jest.fn().mockResolvedValue({ user, token: 'jwt-for-tests', message: 'Account created successfully.' }),
      getCurrentUser: jest.fn().mockResolvedValue({ user }),
    };
    const storage: SecureTokenStorage = {
      getToken: jest.fn().mockResolvedValue('existing-jwt'),
      setToken: jest.fn().mockResolvedValue(undefined),
      deleteToken: jest.fn().mockResolvedValue(undefined),
    };
    mockedListTrips.mockResolvedValue([]);

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <SafeAreaProvider>
          <AuthProvider service={service} storage={storage}>
            <RootNavigator />
          </AuthProvider>
        </SafeAreaProvider>
      </QueryClientProvider>,
    );

    expect(await screen.findByText('Welcome, Alex Morgan.')).toBeTruthy();
    fireEvent.press(screen.getByTestId('home-my-trips'));

    expect(await screen.findByText('No trips yet')).toBeTruthy();
    expect(mockedListTrips).toHaveBeenCalledTimes(2);
  });
});
