import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { ApiError } from '../../services/api/apiClient';
import { tripService } from '../../services/api/tripService';
import type { AppStackParamList } from '../../types/auth';
import type { Trip, TripMember } from '../../types/trips';
import JoinTripScreen from './JoinTripScreen';

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
  tripService: { joinTrip: jest.fn() },
}));

const mockedJoinTrip = jest.mocked(tripService.joinTrip);

function makeMember(): TripMember {
  return {
    id: 'member-1',
    tripId: 'trip-2',
    userId: 'user-1',
    role: 'MEMBER',
    joinedAt: '2026-11-01T10:00:00.000Z',
    isActive: true,
    budgetLimit: null,
    user: { id: 'user-1', fullName: 'Alex Morgan', email: 'alex@example.test' },
  };
}

function makeTrip(overrides: Partial<Trip> = {}): Trip {
  return {
    id: 'trip-2',
    name: 'Mountain week',
    description: null,
    startDate: null,
    endDate: null,
    baseCurrency: 'INR',
    status: 'ACTIVE',
    joinCode: 'WXYZ6789',
    cashManagerUserId: 'user-2',
    createdByUserId: 'user-2',
    createdAt: '2026-11-01T10:00:00.000Z',
    updatedAt: '2026-11-01T10:00:00.000Z',
    members: [makeMember()],
    settings: null,
    ...overrides,
  };
}

function renderScreen() {
  const goBack = jest.fn();
  const replace = jest.fn();
  const props = {
    navigation: { goBack, replace },
    route: { key: 'JoinTrip', name: 'JoinTrip' },
  } as unknown as NativeStackScreenProps<AppStackParamList, 'JoinTrip'>;

  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const result = render(
    <QueryClientProvider client={queryClient}>
      <SafeAreaProvider>
        <JoinTripScreen {...props} />
      </SafeAreaProvider>
    </QueryClientProvider>,
  );

  return { ...result, goBack, replace };
}

describe('Join trip screen', () => {
  beforeEach(() => {
    mockedJoinTrip.mockReset();
  });

  it('rejects a code that is too short without calling the API', () => {
    renderScreen();

    fireEvent.changeText(screen.getByTestId('join-trip-code'), 'ABC');
    fireEvent.press(screen.getByTestId('join-trip-submit'));

    expect(screen.getByText('Enter the full code, at least 6 characters.')).toBeTruthy();
    expect(mockedJoinTrip).not.toHaveBeenCalled();
  });

  it('normalises spaces and lower-case letters before sending', async () => {
    mockedJoinTrip.mockResolvedValue(makeTrip());

    renderScreen();

    fireEvent.changeText(screen.getByTestId('join-trip-code'), 'wxyz 6789');
    expect(screen.getByTestId('join-trip-code').props.value).toBe('WXYZ 6789');
    fireEvent.press(screen.getByTestId('join-trip-submit'));

    await waitFor(() => expect(mockedJoinTrip).toHaveBeenCalledWith('WXYZ6789'));
  });

  it('opens the joined trip on success', async () => {
    mockedJoinTrip.mockResolvedValue(makeTrip());

    const { replace } = renderScreen();

    fireEvent.changeText(screen.getByTestId('join-trip-code'), 'WXYZ6789');
    fireEvent.press(screen.getByTestId('join-trip-submit'));

    await waitFor(() =>
      expect(replace).toHaveBeenCalledWith('TripDetail', { tripId: 'trip-2', tripName: 'Mountain week' }),
    );
  });

  it('shows the generic not-found message for an invalid code', async () => {
    mockedJoinTrip.mockRejectedValue(new ApiError('Invalid or expired trip code.', 404, 'http'));

    renderScreen();

    fireEvent.changeText(screen.getByTestId('join-trip-code'), 'ZZZZ9999');
    fireEvent.press(screen.getByTestId('join-trip-submit'));

    expect(await screen.findByText('Invalid or expired trip code.')).toBeTruthy();
  });

  it('shows the conflict message when the trip is no longer open', async () => {
    mockedJoinTrip.mockRejectedValue(new ApiError('This trip is not accepting new members.', 409, 'http'));

    renderScreen();

    fireEvent.changeText(screen.getByTestId('join-trip-code'), 'WXYZ6789');
    fireEvent.press(screen.getByTestId('join-trip-submit'));

    expect(await screen.findByText('This trip is not accepting new members.')).toBeTruthy();
  });

  it('does not expose internal server messages', async () => {
    mockedJoinTrip.mockRejectedValue(new ApiError('PrismaClientKnownRequestError: P2002', 500, 'http'));

    renderScreen();

    fireEvent.changeText(screen.getByTestId('join-trip-code'), 'WXYZ6789');
    fireEvent.press(screen.getByTestId('join-trip-submit'));

    expect(await screen.findByText('We could not join that trip. Check your connection and try again.')).toBeTruthy();
    expect(screen.queryByText('PrismaClientKnownRequestError: P2002')).toBeNull();
  });

  it('explains a rate limit without a retry storm', async () => {
    mockedJoinTrip.mockRejectedValue(new ApiError('Too many attempts. Try again in a minute.', 429, 'http'));

    renderScreen();

    fireEvent.changeText(screen.getByTestId('join-trip-code'), 'WXYZ6789');
    fireEvent.press(screen.getByTestId('join-trip-submit'));

    expect(await screen.findByText('Too many attempts. Try again in a minute.')).toBeTruthy();
    expect(mockedJoinTrip).toHaveBeenCalledTimes(1);
  });
});
