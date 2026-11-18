import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import { RefreshControl, Share, StyleSheet } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { AuthProvider, type AuthOperations } from '../../auth/AuthContext';
import { ApiError } from '../../services/api/apiClient';
import { tripService } from '../../services/api/tripService';
import type { SecureTokenStorage } from '../../services/storage/secureStorage';
import type { AppStackParamList, AuthUser } from '../../types/auth';
import type { Trip, TripBalances, TripExpense, TripMember, TripSettings } from '../../types/trips';
import TripDetailScreen from './TripDetailScreen';

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
  tripService: {
    getTrip: jest.fn(),
    listExpenses: jest.fn(),
    getTripBalances: jest.fn(),
  },
}));

const mockedGetTrip = jest.mocked(tripService.getTrip);
const mockedListExpenses = jest.mocked(tripService.listExpenses);
const mockedGetTripBalances = jest.mocked(tripService.getTripBalances);

const CURRENT_USER: AuthUser = {
  id: 'user-1',
  email: 'alex@example.test',
  fullName: 'Alex Morgan',
  role: 'MEMBER',
};

function makeAuth() {
  const service: AuthOperations = {
    setUnauthorizedHandler: jest.fn(),
    login: jest.fn().mockResolvedValue({ user: CURRENT_USER, token: 'jwt-for-tests', message: 'Login successful.' }),
    register: jest.fn().mockResolvedValue({ user: CURRENT_USER, token: 'jwt-for-tests', message: 'Account created successfully.' }),
    getCurrentUser: jest.fn().mockResolvedValue({ user: CURRENT_USER }),
  };
  const storage: SecureTokenStorage = {
    getToken: jest.fn().mockResolvedValue('existing-jwt'),
    setToken: jest.fn().mockResolvedValue(undefined),
    deleteToken: jest.fn().mockResolvedValue(undefined),
  };
  return { service, storage };
}

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

function makeSettings(overrides: Partial<TripSettings> = {}): TripSettings {
  return {
    id: 'settings-1',
    tripId: 'trip-1',
    allowMemberExpenseEdit: true,
    requireLocationConfirmation: false,
    allowPublicJoin: false,
    createdAt: '2026-11-01T10:00:00.000Z',
    updatedAt: '2026-11-01T10:00:00.000Z',
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
    members: [makeMember()],
    settings: makeSettings(),
    ...overrides,
  };
}

type RenderOptions = {
  seed?: Trip[];
  seedUpdatedAt?: number;
  tripId?: string;
  tripName?: string;
};

function makeExpense(overrides: Partial<TripExpense> = {}): TripExpense {
  return {
    id: 'expense-1',
    tripId: 'trip-1',
    title: 'Dinner',
    description: null,
    amount: '1000.00',
    currency: 'INR',
    convertedAmount: '1000.00',
    exchangeRate: null,
    category: 'Food',
    expenseType: 'GROUP',
    splitMethod: 'EQUAL',
    paymentMethod: 'UPI',
    date: '2026-12-02T10:00:00.000Z',
    createdByUserId: 'user-1',
    status: 'ACTIVE',
    createdAt: '2026-12-02T10:00:00.000Z',
    updatedAt: '2026-12-02T10:00:00.000Z',
    payers: [
      {
        id: 'payer-1',
        expenseId: 'expense-1',
        userId: 'user-1',
        amount: '1000.00',
        currency: 'INR',
        paymentStatus: 'SETTLED',
        isCashManagerDisbursement: false,
        paidAt: null,
      },
    ],
    allocations: [
      {
        id: 'allocation-1',
        expenseId: 'expense-1',
        userId: 'user-1',
        allocatedAmount: '500.00',
        percentage: null,
        weight: null,
        isManual: false,
      },
      {
        id: 'allocation-2',
        expenseId: 'expense-1',
        userId: 'user-2',
        allocatedAmount: '500.00',
        percentage: null,
        weight: null,
        isManual: false,
      },
    ],
    ...overrides,
  };
}

function twoMembers(): TripMember[] {
  return [
    makeMember(),
    makeMember({
      id: 'member-2',
      userId: 'user-2',
      role: 'MEMBER',
      user: { id: 'user-2', fullName: 'Blake Chen', email: 'blake@example.test' },
    }),
  ];
}

function renderScreen({ seed, seedUpdatedAt, tripId = 'trip-1', tripName = 'Coastal weekend' }: RenderOptions = {}) {
  const goBack = jest.fn();
  const navigate = jest.fn();
  const props = {
    navigation: { goBack, navigate },
    route: { key: 'TripDetail', name: 'TripDetail', params: { tripId, tripName } },
  } as unknown as NativeStackScreenProps<AppStackParamList, 'TripDetail'>;
  // Mirrors App.tsx so cache-freshness behaviour is exercised, not bypassed.
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 30_000 } },
  });
  if (seed) {
    if (seedUpdatedAt === undefined) {
      queryClient.setQueryData(['trips'], seed);
    } else {
      queryClient.setQueryData(['trips'], seed, { updatedAt: seedUpdatedAt });
    }
  }

  const result = render(
    <QueryClientProvider client={queryClient}>
      <SafeAreaProvider>
        <AuthProvider {...makeAuth()}>
          <TripDetailScreen {...props} />
        </AuthProvider>
      </SafeAreaProvider>
    </QueryClientProvider>,
  );

  return { ...result, goBack, navigate, queryClient };
}

// Join times are formatted on the viewer's calendar, which only differs from
// the UTC calendar day in zones ahead of UTC (the IST device this ships to).
const itAheadOfUtc = new Date().getTimezoneOffset() < 0 ? it : it.skip;

describe('Trip detail screen', () => {
  beforeEach(() => {
    mockedGetTrip.mockReset();
    mockedListExpenses.mockResolvedValue([]);
    mockedGetTripBalances.mockResolvedValue({ currency: 'INR', totalExpenses: '0.00', members: [] });
  });

  it('shows a loading indicator while the trip request is pending', async () => {
    mockedGetTrip.mockReturnValue(new Promise<Trip>(() => undefined));

    renderScreen();

    expect(await screen.findByText('Loading trip…')).toBeTruthy();
  });

  it('renders the trip overview returned by the API', async () => {
    mockedGetTrip.mockResolvedValue(makeTrip());

    renderScreen({ tripName: 'Coastal weekend' });

    expect(await screen.findByText('ACTIVE')).toBeTruthy();
    expect(screen.getByText('Coastal weekend').props.accessibilityRole).toBe('header');
    expect(screen.getByText('A short trip with friends.')).toBeTruthy();
    expect(screen.getByText('Members')).toBeTruthy();
    expect(screen.getByText('1 active member')).toBeTruthy();
    expect(within(screen.getByTestId('trip-detail-dates')).getByText('1 Dec 2026 – 5 Dec 2026')).toBeTruthy();
    expect(within(screen.getByTestId('trip-detail-currency')).getByText('INR')).toBeTruthy();
  });

  it('lets short content fill the viewport so the pull gesture stays reachable', async () => {
    mockedGetTrip.mockResolvedValue(makeTrip({ description: null, members: [] }));

    renderScreen();

    await screen.findByText('ACTIVE');
    const scroll = screen.getByTestId('trip-detail-scroll');

    expect(StyleSheet.flatten(scroll.props.contentContainerStyle)).toMatchObject({ flexGrow: 1 });
  });

  it('shows the cash manager and member roles', async () => {
    mockedGetTrip.mockResolvedValue(
      makeTrip({
        cashManagerUserId: 'user-2',
        members: [
          makeMember(),
          makeMember({
            id: 'member-2',
            role: 'ADMIN',
            userId: 'user-2',
            user: { id: 'user-2', fullName: 'Blake Chen', email: 'blake@example.test' },
          }),
        ],
      }),
    );

    renderScreen();

    expect(await screen.findByText('Admin')).toBeTruthy();
    expect(within(screen.getByTestId('trip-member-member-2')).getByText('Cash manager')).toBeTruthy();
    expect(within(screen.getByTestId('trip-detail-cash-manager')).getByText('Blake Chen')).toBeTruthy();
    expect(screen.getByText('Owner')).toBeTruthy();
    expect(screen.getAllByText(/^Joined \d{1,2} \w{3} \d{4}$/)).toHaveLength(2);
  });

  itAheadOfUtc('shows a late-evening join on the local calendar day', async () => {
    mockedGetTrip.mockResolvedValue(
      makeTrip({ members: [makeMember({ joinedAt: '2026-11-01T19:30:00.000Z' })] }),
    );

    renderScreen();

    expect(await screen.findByText('Joined 2 Nov 2026')).toBeTruthy();
    expect(screen.queryByText('Joined 1 Nov 2026')).toBeNull();
  });

  it('counts only active members but still lists inactive ones', async () => {
    mockedGetTrip.mockResolvedValue(
      makeTrip({
        members: [
          makeMember(),
          makeMember({
            id: 'member-9',
            isActive: false,
            userId: 'user-9',
            user: { id: 'user-9', fullName: 'Casey Lane', email: 'casey@example.test' },
          }),
        ],
      }),
    );

    renderScreen();

    expect(await screen.findByText('1 active member')).toBeTruthy();
    expect(screen.getByText('Casey Lane')).toBeTruthy();
    expect(screen.getByText('Inactive')).toBeTruthy();
    expect(screen.queryByText('2 active members')).toBeNull();
  });

  it('renders the trip settings as enabled or disabled', async () => {
    mockedGetTrip.mockResolvedValue(makeTrip());

    renderScreen();

    expect(await screen.findByText('Members can edit expenses')).toBeTruthy();
    expect(screen.getByText('Location confirmation required')).toBeTruthy();
    expect(screen.getByText('Public join link')).toBeTruthy();
    expect(screen.queryByText('Public join link enabled')).toBeNull();
    expect(screen.getByText('Enabled')).toBeTruthy();
    expect(screen.getAllByText('Disabled')).toHaveLength(2);
  });

  it('explains when trip settings are not configured', async () => {
    mockedGetTrip.mockResolvedValue(makeTrip({ settings: null }));

    renderScreen();

    expect(await screen.findByText('Trip settings are not configured.')).toBeTruthy();
    expect(screen.queryByText('Enabled')).toBeNull();
  });

  it('falls back when the cash manager is missing from the member list', async () => {
    mockedGetTrip.mockResolvedValue(makeTrip({ cashManagerUserId: 'user-404' }));

    renderScreen();

    expect(await screen.findByText('Unknown member')).toBeTruthy();
  });

  it('shows "Not assigned" when the trip has no cash manager', async () => {
    mockedGetTrip.mockResolvedValue(makeTrip({ cashManagerUserId: null }));

    renderScreen();

    expect(await screen.findByText('Not assigned')).toBeTruthy();
  });

  it('shows the server message when the viewer is not a member', async () => {
    mockedGetTrip.mockRejectedValue(new ApiError('You are not a member of this trip.', 403, 'http'));

    renderScreen();

    expect(await screen.findByText('You are not a member of this trip.')).toBeTruthy();
    expect(screen.getByText('Couldn’t open this trip')).toBeTruthy();
    expect(screen.getByTestId('trip-detail-retry')).toBeTruthy();
  });

  it('shows the server message when the trip does not exist', async () => {
    mockedGetTrip.mockRejectedValue(new ApiError('Trip not found.', 404, 'http'));

    renderScreen();

    expect(await screen.findByText('Trip not found.')).toBeTruthy();
  });

  it('hides unexpected API messages behind generic copy', async () => {
    mockedGetTrip.mockRejectedValue(new ApiError('prisma: connection pool exhausted', 500, 'http'));

    renderScreen();

    expect(await screen.findByText('We could not load this trip. Check your connection and try again.')).toBeTruthy();
    expect(screen.queryByText('prisma: connection pool exhausted')).toBeNull();
  });

  it('retries the request when the retry action is pressed', async () => {
    mockedGetTrip
      .mockRejectedValueOnce(new ApiError('The request timed out. Check your connection and try again.', 0, 'timeout'))
      .mockResolvedValueOnce(makeTrip());

    renderScreen();

    fireEvent.press(await screen.findByTestId('trip-detail-retry'));

    expect(await screen.findByText('ACTIVE')).toBeTruthy();
    expect(mockedGetTrip).toHaveBeenCalledTimes(2);
  });

  it('refetches when pull-to-refresh is triggered', async () => {
    mockedGetTrip
      .mockResolvedValueOnce(makeTrip())
      .mockResolvedValueOnce(makeTrip({ name: 'Coastal weekend (updated)' }));

    renderScreen();

    await screen.findByText('ACTIVE');
    fireEvent(screen.UNSAFE_getByType(RefreshControl), 'refresh');

    expect(await screen.findByText('Coastal weekend (updated)')).toBeTruthy();
    expect(mockedGetTrip).toHaveBeenCalledTimes(2);
  });

  it('paints from the cached list without refetching while the list is fresh', () => {
    mockedGetTrip.mockResolvedValue(makeTrip());

    renderScreen({ seed: [makeTrip()] });

    expect(screen.getByText('ACTIVE')).toBeTruthy();
    expect(screen.queryByText('Loading trip…')).toBeNull();
    expect(mockedGetTrip).not.toHaveBeenCalled();
    expect(screen.UNSAFE_getByType(RefreshControl).props.refreshing).toBe(false);
  });

  it('revalidates a stale cached trip without showing the pull indicator', async () => {
    mockedGetTrip.mockResolvedValue(makeTrip({ name: 'Coastal weekend (renamed)' }));

    renderScreen({ seed: [makeTrip()], seedUpdatedAt: Date.now() - 60_000 });

    // Cached detail paints immediately, and the background revalidation that
    // follows must not be presented as a user pull…
    expect(screen.UNSAFE_getByType(RefreshControl).props.refreshing).toBe(false);
    expect(screen.getByText('ACTIVE')).toBeTruthy();
    // …then the stale copy is replaced by server data.
    expect(await screen.findByText('Coastal weekend (renamed)')).toBeTruthy();
    expect(mockedGetTrip).toHaveBeenCalledTimes(1);
    expect(screen.UNSAFE_getByType(RefreshControl).props.refreshing).toBe(false);
  });

  it('shows the refresh indicator only for a pull gesture', async () => {
    let resolveRefresh: ((trip: Trip) => void) | undefined;
    mockedGetTrip
      .mockResolvedValueOnce(makeTrip())
      .mockImplementationOnce(() => new Promise<Trip>((resolve) => {
        resolveRefresh = resolve;
      }));

    renderScreen();

    await screen.findByText('ACTIVE');
    expect(screen.UNSAFE_getByType(RefreshControl).props.refreshing).toBe(false);

    fireEvent(screen.UNSAFE_getByType(RefreshControl), 'refresh');
    await waitFor(() => expect(screen.UNSAFE_getByType(RefreshControl).props.refreshing).toBe(true));

    resolveRefresh?.(makeTrip({ name: 'Coastal weekend (updated)' }));

    expect(await screen.findByText('Coastal weekend (updated)')).toBeTruthy();
    await waitFor(() => expect(screen.UNSAFE_getByType(RefreshControl).props.refreshing).toBe(false));
  });

  it('keeps cached details visible when a refresh fails', async () => {
    mockedGetTrip.mockRejectedValue(new ApiError('Network request failed.', 0, 'network'));

    renderScreen({ seed: [makeTrip()], seedUpdatedAt: Date.now() - 60_000 });

    expect(await screen.findByText('Couldn’t refresh this trip. Showing the last loaded details.')).toBeTruthy();
    expect(screen.getByText('ACTIVE')).toBeTruthy();
    expect(screen.getByTestId('trip-detail-banner-retry')).toBeTruthy();
  });

  it('returns to the previous screen from the back button', async () => {
    mockedGetTrip.mockResolvedValue(makeTrip());

    const { goBack } = renderScreen();

    await screen.findByText('ACTIVE');
    fireEvent.press(screen.getByTestId('trip-detail-back'));

    expect(goBack).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(mockedGetTrip).toHaveBeenCalledTimes(1));
  });

  it('shows group spending from every member and totals only group expenses', async () => {
    mockedGetTrip.mockResolvedValue(makeTrip({ members: twoMembers() }));
    mockedListExpenses.mockResolvedValue([
      makeExpense(),
      makeExpense({
        id: 'expense-2',
        title: 'Cab to the beach',
        amount: '500.50',
        convertedAmount: '500.50',
        category: 'Travel',
        createdByUserId: 'user-2',
        payers: [
          {
            id: 'payer-2',
            expenseId: 'expense-2',
            userId: 'user-2',
            amount: '500.50',
            currency: 'INR',
            paymentStatus: 'SETTLED',
            isCashManagerDisbursement: false,
            paidAt: null,
          },
        ],
        allocations: [
          {
            id: 'allocation-3',
            expenseId: 'expense-2',
            userId: 'user-1',
            allocatedAmount: '250.25',
            percentage: null,
            weight: null,
            isManual: false,
          },
          {
            id: 'allocation-4',
            expenseId: 'expense-2',
            userId: 'user-2',
            allocatedAmount: '250.25',
            percentage: null,
            weight: null,
            isManual: false,
          },
        ],
      }),
      makeExpense({
        id: 'expense-3',
        title: 'Private spa',
        amount: '300.00',
        convertedAmount: '300.00',
        expenseType: 'PERSONAL',
        createdByUserId: 'user-2',
        payers: [],
        allocations: [],
      }),
    ]);

    renderScreen();

    expect(await screen.findByTestId('trip-group-total')).toHaveTextContent('₹1,500.50');
    // The other member's personal report never appears in my view.
    expect(screen.queryByText('Private spa')).toBeNull();
    // Every member's group spend is listed, with who paid.
    expect(within(screen.getByTestId('trip-expense-expense-2')).getByText(/Blake Chen/)).toBeTruthy();
    expect(screen.getByText(/2 group expenses/)).toBeTruthy();
  });

  it('lists my personal reports separately without inflating the group total', async () => {
    mockedGetTrip.mockResolvedValue(makeTrip({ members: twoMembers() }));
    mockedListExpenses.mockResolvedValue([
      makeExpense(),
      makeExpense({
        id: 'expense-mine',
        title: 'My coffee',
        amount: '500.00',
        convertedAmount: '500.00',
        expenseType: 'PERSONAL',
        createdByUserId: 'user-1',
        payers: [],
        allocations: [
          {
            id: 'allocation-5',
            expenseId: 'expense-mine',
            userId: 'user-1',
            allocatedAmount: '500.00',
            percentage: null,
            weight: null,
            isManual: false,
          },
        ],
      }),
      makeExpense({
        id: 'expense-theirs',
        title: 'Their souvenir',
        amount: '300.00',
        convertedAmount: '300.00',
        expenseType: 'PERSONAL',
        createdByUserId: 'user-2',
        payers: [],
        allocations: [],
      }),
    ]);

    renderScreen();

    expect(await screen.findByTestId('trip-group-total')).toHaveTextContent('₹1,000.00');
    expect(screen.getByText('Your personal reports')).toBeTruthy();
    expect(screen.getByText('My coffee')).toBeTruthy();
    expect(screen.queryByText('Their souvenir')).toBeNull();
  });

  it('shows your group share and member balances', async () => {
    mockedGetTrip.mockResolvedValue(makeTrip({ members: twoMembers() }));
    mockedListExpenses.mockResolvedValue([makeExpense()]);
    mockedGetTripBalances.mockResolvedValue({
      currency: 'INR',
      totalExpenses: '1000.00',
      members: [
        {
          userId: 'user-1',
          fullName: 'Alex Morgan',
          isActive: true,
          recordedAdvances: '1000.00',
          responsibility: '500.00',
          netBalance: '250.00',
        },
        {
          userId: 'user-2',
          fullName: 'Blake Chen',
          isActive: true,
          recordedAdvances: '0.00',
          responsibility: '500.00',
          netBalance: '-250.00',
        },
      ],
    });

    renderScreen();

    expect(await screen.findByText('₹500.00')).toBeTruthy(); // your group share
    expect(screen.getByText('Balances')).toBeTruthy();
    expect(screen.getByText('gets back ₹250.00')).toBeTruthy();
    expect(screen.getByText('owes ₹250.00')).toBeTruthy();
  });

  it('shares the trip code from the detail screen', async () => {
    mockedGetTrip.mockResolvedValue(makeTrip());
    const share = jest.spyOn(Share, 'share').mockResolvedValue({ action: 'sharedAction', activityType: undefined });

    renderScreen();

    expect(await screen.findByTestId('trip-join-code')).toHaveTextContent('ABCD 2345');
    fireEvent.press(screen.getByTestId('trip-share-code'));

    await waitFor(() => expect(share).toHaveBeenCalledTimes(1));
    expect(share.mock.calls[0][0]).toMatchObject({ message: expect.stringContaining('ABCD2345') });
  });

  it('recovers when the spending list fails to load', async () => {
    mockedGetTrip.mockResolvedValue(makeTrip());
    mockedListExpenses
      .mockRejectedValueOnce(new ApiError('Network request failed.', 0, 'network'))
      .mockResolvedValueOnce([makeExpense()]);

    renderScreen();

    expect(await screen.findByText('Couldn’t load the spending list.')).toBeTruthy();
    fireEvent.press(screen.getByTestId('trip-expenses-retry'));

    expect(await screen.findByTestId('trip-expense-expense-1')).toBeTruthy();
  });

  it('opens the report form from the detail screen', async () => {
    mockedGetTrip.mockResolvedValue(makeTrip());

    const { navigate } = renderScreen();

    await screen.findByText('ACTIVE');
    fireEvent.press(screen.getByTestId('trip-report-payment'));

    expect(navigate).toHaveBeenCalledWith('ReportExpense', {
      tripId: 'trip-1',
      tripName: 'Coastal weekend',
    });
  });

  it('disables reporting for viewers and explains why', async () => {
    mockedGetTrip.mockResolvedValue(makeTrip({ members: [makeMember({ role: 'VIEWER' })] }));

    renderScreen();

    expect(
      await screen.findByText('Viewers can read this trip but cannot report payments.'),
    ).toBeTruthy();
    expect(screen.getByTestId('trip-report-payment').props.accessibilityState).toMatchObject({ disabled: true });
  });

  it('disables reporting for members when the owner switched it off', async () => {
    mockedGetTrip.mockResolvedValue(
      makeTrip({
        members: [makeMember({ role: 'MEMBER' })],
        settings: makeSettings({ allowMemberExpenseEdit: false }),
      }),
    );

    renderScreen();

    expect(
      await screen.findByText('The owner has turned off member expense reporting for this trip.'),
    ).toBeTruthy();
    expect(screen.getByTestId('trip-report-payment').props.accessibilityState).toMatchObject({ disabled: true });
  });

  it('keeps reporting available to owners even when member reporting is off', async () => {
    mockedGetTrip.mockResolvedValue(makeTrip({ settings: makeSettings({ allowMemberExpenseEdit: false }) }));

    renderScreen();

    await screen.findByText('ACTIVE');
    expect(screen.getByTestId('trip-report-payment').props.accessibilityState).toMatchObject({ disabled: false });
    expect(screen.queryByTestId('trip-report-blocked')).toBeNull();
  });
});
