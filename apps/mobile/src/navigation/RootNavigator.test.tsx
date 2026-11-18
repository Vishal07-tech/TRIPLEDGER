import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { AuthProvider, type AuthOperations } from '../auth/AuthContext';
import RootNavigator from './RootNavigator';
import { tripService } from '../services/api/tripService';
import type { AuthUser } from '../types/auth';
import type { Trip } from '../types/trips';
import type { SecureTokenStorage } from '../services/storage/secureStorage';

jest.mock('../services/api/tripService', () => ({
  tripService: {
    listTrips: jest.fn(),
    getTrip: jest.fn(),
    listExpenses: jest.fn(),
    getTripBalances: jest.fn(),
  },
}));

const mockedListTrips = jest.mocked(tripService.listTrips);
const mockedGetTrip = jest.mocked(tripService.getTrip);
const mockedListExpenses = jest.mocked(tripService.listExpenses);
const mockedGetTripBalances = jest.mocked(tripService.getTripBalances);

function makeTrip(): Trip {
  return {
    id: 'trip-1',
    name: 'Coastal weekend',
    description: 'A short trip with friends.',
    startDate: '2026-12-01T00:00:00.000Z',
    endDate: '2026-12-05T00:00:00.000Z',
    baseCurrency: 'INR',
    status: 'ACTIVE',
    joinCode: 'ABCD2345',
    cashManagerUserId: 'user-2',
    createdByUserId: 'user-2',
    createdAt: '2026-11-01T10:00:00.000Z',
    updatedAt: '2026-11-01T10:00:00.000Z',
    members: [
      {
        id: 'member-1',
        tripId: 'trip-1',
        userId: 'user-2',
        role: 'OWNER',
        joinedAt: '2026-11-01T10:00:00.000Z',
        isActive: true,
        budgetLimit: null,
        user: { id: 'user-2', fullName: 'Sam Taylor', email: 'sam@example.test' },
      },
    ],
    settings: null,
  };
}

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

const user: AuthUser = { id: 'user-2', email: 'sam@example.test', fullName: 'Sam Taylor', role: 'MEMBER' };

function renderApp(token: string | null = null) {
  const service: AuthOperations = {
    setUnauthorizedHandler: jest.fn(),
    login: jest.fn().mockResolvedValue({ user, token: 'new-jwt', message: 'Login successful.' }),
    register: jest.fn().mockResolvedValue({ user, token: 'new-jwt', message: 'Account created successfully.' }),
    getCurrentUser: jest.fn().mockResolvedValue({ user }),
  };
  const storage: SecureTokenStorage = {
    getToken: jest.fn().mockResolvedValue(token),
    setToken: jest.fn().mockResolvedValue(undefined),
    deleteToken: jest.fn().mockResolvedValue(undefined),
  };
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const result = render(
    <QueryClientProvider client={queryClient}>
      <SafeAreaProvider>
        <AuthProvider service={service} storage={storage}><RootNavigator /></AuthProvider>
      </SafeAreaProvider>
    </QueryClientProvider>,
  );
  return { ...result, service, storage, queryClient };
}

describe('root navigation guards', () => {
  beforeEach(() => {
    mockedListTrips.mockResolvedValue([]);
    mockedListExpenses.mockResolvedValue([]);
    mockedGetTripBalances.mockResolvedValue({ currency: 'INR', totalExpenses: '0.00', members: [] });
  });

  it('shows authentication routes when there is no saved session', async () => {
    renderApp();
    expect(await screen.findByText('Welcome back')).toBeTruthy();
    fireEvent.press(screen.getByText('Create an account'));
    expect(await screen.findByText('Create your account')).toBeTruthy();
  });

  it('restores an authenticated route and returns to login after logout', async () => {
    const app = renderApp('existing-jwt');
    await waitFor(() => expect(screen.getByText('Welcome, Sam Taylor.')).toBeTruthy());
    fireEvent.press(screen.getByTestId('home-menu'));
    fireEvent.press(await screen.findByTestId('menu-sign-out'));
    await screen.findByText('Welcome back');
    expect(app.storage.deleteToken).toHaveBeenCalledTimes(1);
  });

  it('registers the trip detail route reached from the My Trips card', async () => {
    mockedListTrips.mockResolvedValue([makeTrip()]);
    mockedGetTrip.mockResolvedValue(makeTrip());

    renderApp('existing-jwt');
    await screen.findByText('Welcome, Sam Taylor.');

    fireEvent.press(screen.getByTestId('home-my-trips'));
    expect(await screen.findByTestId('my-trips-list')).toBeTruthy();

    fireEvent.press(await screen.findByTestId('trip-card-trip-1'));

    // Only a registered `TripDetail` screen renders this subtitle and content.
    expect(await screen.findByText('Trip overview')).toBeTruthy();
    expect(screen.getByText('Dates')).toBeTruthy();
    expect(mockedGetTrip).toHaveBeenCalledWith('trip-1');
  });

  it('validates login and submits only the actual backend fields', async () => {
    const app = renderApp();
    await screen.findByText('Welcome back');
    fireEvent.press(screen.getByTestId('login-submit'));
    expect(await screen.findByText('Enter a valid email address.')).toBeTruthy();
    expect(app.service.login).not.toHaveBeenCalled();

    fireEvent.changeText(screen.getByTestId('login-email'), 'sam@example.test');
    fireEvent.changeText(screen.getByTestId('login-password'), 'valid-pass');
    fireEvent.press(screen.getByTestId('login-submit'));
    await screen.findByText('Welcome, Sam Taylor.');
    expect(app.service.login).toHaveBeenCalledWith({ email: 'sam@example.test', password: 'valid-pass' });
  });

  it('registers with the existing fullName/email/password contract', async () => {
    const app = renderApp();
    await screen.findByText('Welcome back');
    fireEvent.press(screen.getByText('Create an account'));
    await screen.findByText('Create your account');
    fireEvent.changeText(screen.getByTestId('register-full-name'), 'Sam Taylor');
    fireEvent.changeText(screen.getByTestId('register-email'), 'sam@example.test');
    fireEvent.changeText(screen.getByTestId('register-password'), 'valid-pass');
    fireEvent.press(screen.getByTestId('register-submit'));
    await screen.findByText('Welcome, Sam Taylor.');
    expect(app.service.register).toHaveBeenCalledWith({ fullName: 'Sam Taylor', email: 'sam@example.test', password: 'valid-pass' });
  });
});
