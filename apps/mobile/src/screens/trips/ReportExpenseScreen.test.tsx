import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { AuthProvider, type AuthOperations } from '../../auth/AuthContext';
import { ApiError } from '../../services/api/apiClient';
import { tripService } from '../../services/api/tripService';
import type { SecureTokenStorage } from '../../services/storage/secureStorage';
import type { AppStackParamList, AuthUser } from '../../types/auth';
import type { Trip, TripMember, TripSettings } from '../../types/trips';
import ReportExpenseScreen from './ReportExpenseScreen';

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
  tripService: { getTrip: jest.fn(), createExpense: jest.fn() },
}));

const mockedGetTrip = jest.mocked(tripService.getTrip);
const mockedCreateExpense = jest.mocked(tripService.createExpense);

const CURRENT_USER: AuthUser = { id: 'user-1', email: 'alex@example.test', fullName: 'Alex Morgan', role: 'MEMBER' };

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

function makeTrip(overrides: Partial<Trip> = {}): Trip {
  return {
    id: 'trip-1',
    name: 'Coastal weekend',
    description: null,
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
      makeMember({
        id: 'member-2',
        userId: 'user-2',
        role: 'MEMBER',
        user: { id: 'user-2', fullName: 'Blake Chen', email: 'blake@example.test' },
      }),
      makeMember({
        id: 'member-3',
        userId: 'user-3',
        isActive: false,
        user: { id: 'user-3', fullName: 'Casey Lane', email: 'casey@example.test' },
      }),
    ],
    settings: null,
    ...overrides,
  };
}

function renderScreen(trip: Trip = makeTrip()) {
  mockedGetTrip.mockResolvedValue(trip);

  const goBack = jest.fn();
  const props = {
    navigation: { goBack },
    route: { name: 'ReportExpense', key: 'ReportExpense', params: { tripId: trip.id, tripName: trip.name } },
  } as unknown as NativeStackScreenProps<AppStackParamList, 'ReportExpense'>;

  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const result = render(
    <QueryClientProvider client={queryClient}>
      <SafeAreaProvider>
        <AuthProvider {...makeAuth()}>
          <ReportExpenseScreen {...props} />
        </AuthProvider>
      </SafeAreaProvider>
    </QueryClientProvider>,
  );

  return { ...result, goBack, queryClient };
}

async function waitForTripLoaded() {
  await screen.findByText(/Shared by Alex Morgan, Blake Chen\./);
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

function fill(title: string, amount: string) {
  fireEvent.changeText(screen.getByTestId('report-expense-title'), title);
  fireEvent.changeText(screen.getByTestId('report-expense-amount'), amount);
}

function submitPayload() {
  return mockedCreateExpense.mock.calls[0][1];
}

describe('Report expense screen', () => {
  beforeEach(() => {
    mockedGetTrip.mockReset();
    mockedCreateExpense.mockReset();
    mockedCreateExpense.mockResolvedValue({
      id: 'expense-1',
      tripId: 'trip-1',
      title: 'Dinner',
      description: null,
      amount: '450.00',
      currency: 'INR',
      convertedAmount: null,
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
      payers: [],
      allocations: [],
    });
  });

  it('asks for personal or group purpose before anything else', async () => {
    renderScreen();

    const personal = await screen.findByTestId('report-purpose-personal');
    const group = screen.getByTestId('report-purpose-group');

    expect(group.props.accessibilityState).toMatchObject({ checked: true });
    expect(personal.props.accessibilityState).toMatchObject({ checked: false });
    expect(await screen.findByText('Everyone will see this')).toBeTruthy();

    fireEvent.press(personal);

    expect(screen.getByText('This stays personal')).toBeTruthy();
    // The equal-split preview only belongs to group spending.
    expect(screen.queryByText('EQUAL SPLIT')).toBeNull();
  });

  it('sends a personal report with the current user as responsible and no splits', async () => {
    const { goBack } = renderScreen();
    await waitForTripLoaded();

    fireEvent.press(screen.getByTestId('report-purpose-personal'));
    fill('Coffee run', '120');
    fireEvent.press(screen.getByTestId('report-expense-submit'));

    await waitFor(() => expect(mockedCreateExpense).toHaveBeenCalledTimes(1));
    const [tripId, payload] = mockedCreateExpense.mock.calls[0];
    expect(tripId).toBe('trip-1');
    expect(payload).toMatchObject({
      title: 'Coffee run',
      amount: '120.00',
      currency: 'INR',
      category: 'Food',
      expenseType: 'PERSONAL',
      splitMethod: 'EQUAL',
      paymentMethod: 'UPI',
      responsibleUserId: 'user-1',
      payers: [{ userId: 'user-1', amount: '120.00' }],
    });
    expect(payload.splits).toBeUndefined();
    expect(payload.date).toEqual(expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/));
    await waitFor(() => expect(goBack).toHaveBeenCalledTimes(1));
  });

  it('sends a group report split equally across active members only', async () => {
    const { goBack } = renderScreen();
    await waitForTripLoaded();

    fill('Dinner at the beach shack', '450');
    fireEvent.press(screen.getByTestId('report-expense-submit'));

    await waitFor(() => expect(mockedCreateExpense).toHaveBeenCalledTimes(1));
    const payload = submitPayload();
    expect(payload).toMatchObject({
      title: 'Dinner at the beach shack',
      amount: '450.00',
      expenseType: 'GROUP',
      splits: [{ userId: 'user-1' }, { userId: 'user-2' }],
      payers: [{ userId: 'user-1', amount: '450.00' }],
    });
    expect(payload.responsibleUserId).toBeUndefined();
    await waitFor(() => expect(goBack).toHaveBeenCalledTimes(1));
  });

  it('previews the equal per-head share while typing', async () => {
    renderScreen();
    await waitForTripLoaded();

    fireEvent.changeText(screen.getByTestId('report-expense-amount'), '450');

    expect(screen.getByText('₹225.00 each')).toBeTruthy();
    expect(screen.getByText(/Shared by Alex Morgan, Blake Chen\./)).toBeTruthy();
  });

  it('normalises typed amount formats before sending', async () => {
    renderScreen();
    await waitForTripLoaded();

    fill('Group taxi', '1,200.5');
    fireEvent.press(screen.getByTestId('report-expense-submit'));

    await waitFor(() => expect(mockedCreateExpense).toHaveBeenCalledTimes(1));
    expect(submitPayload().amount).toBe('1200.50');
  });

  it('rejects a missing description or a zero amount', async () => {
    renderScreen();
    await waitForTripLoaded();

    fireEvent.press(screen.getByTestId('report-expense-submit'));

    expect(screen.getByText('Describe what you paid for.')).toBeTruthy();
    expect(screen.getByText('Enter an amount greater than zero, like 450 or 450.50.')).toBeTruthy();

    fill('Dinner', '0');
    fireEvent.press(screen.getByTestId('report-expense-submit'));
    expect(mockedCreateExpense).not.toHaveBeenCalled();
  });

  it('lets the cash manager record cash payments', async () => {
    renderScreen(makeTrip({ cashManagerUserId: 'user-1' }));
    await waitForTripLoaded();

    fireEvent.press(screen.getByTestId('report-method-cash'));
    expect(screen.getByTestId('report-method-cash').props.accessibilityState).toMatchObject({ checked: true });

    fill('Cash lunch', '300');
    fireEvent.press(screen.getByTestId('report-expense-submit'));

    await waitFor(() => expect(mockedCreateExpense).toHaveBeenCalledTimes(1));
    expect(submitPayload().paymentMethod).toBe('CASH');
  });

  it('disables cash for members who are not the cash manager', async () => {
    renderScreen(makeTrip({ cashManagerUserId: 'user-2' }));
    await waitForTripLoaded();

    const cash = screen.getByTestId('report-method-cash');
    expect(cash.props.accessibilityState).toMatchObject({ disabled: true });
    expect(screen.getByText('Cash manager only')).toBeTruthy();

    fireEvent.press(cash);
    expect(screen.getByTestId('report-method-cash').props.accessibilityState).toMatchObject({ checked: false });
  });

  it('blocks new reports once the trip is no longer active', async () => {
    renderScreen(makeTrip({ status: 'TRIP_CLOSED' }));
    await screen.findByText('This trip is no longer active, so new payments cannot be recorded.');

    const submit = screen.getByTestId('report-expense-submit');
    expect(submit.props.accessibilityState).toMatchObject({ disabled: true });
  });

  it('blocks viewers from reporting anything', async () => {
    renderScreen(
      makeTrip({
        members: [makeMember({ role: 'VIEWER' })],
      }),
    );

    expect(
      await screen.findByText('Viewers can read this trip but cannot report payments.'),
    ).toBeTruthy();
    expect(screen.getByTestId('report-expense-submit').props.accessibilityState).toMatchObject({ disabled: true });

    fill('Sneaky dinner', '100');
    fireEvent.press(screen.getByTestId('report-expense-submit'));
    expect(mockedCreateExpense).not.toHaveBeenCalled();
  });

  it('blocks members when the owner turns off member expense reporting', async () => {
    renderScreen(
      makeTrip({
        members: [makeMember({ role: 'MEMBER' })],
        settings: makeSettings({ allowMemberExpenseEdit: false }),
      }),
    );

    expect(
      await screen.findByText('The owner has turned off member expense reporting for this trip.'),
    ).toBeTruthy();
    expect(screen.getByTestId('report-expense-submit').props.accessibilityState).toMatchObject({ disabled: true });

    fill('Dinner', '450');
    fireEvent.press(screen.getByTestId('report-expense-submit'));
    expect(mockedCreateExpense).not.toHaveBeenCalled();
  });

  it('still lets the owner report when member reporting is switched off', async () => {
    renderScreen(
      makeTrip({
        members: [makeMember({ role: 'OWNER' })],
        settings: makeSettings({ allowMemberExpenseEdit: false }),
      }),
    );

    await screen.findByText(/Shared by Alex Morgan\./);
    expect(screen.getByTestId('report-expense-submit').props.accessibilityState).toMatchObject({ disabled: false });
    expect(screen.queryByTestId('report-expense-blocked')).toBeNull();
  });

  it('shows a safe validation message from the server', async () => {
    mockedCreateExpense.mockRejectedValue(new ApiError('Payer amounts must add up exactly to the expense total.', 400, 'http'));

    renderScreen();
    await waitForTripLoaded();

    fill('Dinner', '450');
    fireEvent.press(screen.getByTestId('report-expense-submit'));

    expect(await screen.findByText('Payer amounts must add up exactly to the expense total.')).toBeTruthy();
  });

  it('does not expose internal server messages', async () => {
    mockedCreateExpense.mockRejectedValue(new ApiError('Prisma: transaction rolled back', 500, 'http'));

    renderScreen();
    await waitForTripLoaded();

    fill('Dinner', '450');
    fireEvent.press(screen.getByTestId('report-expense-submit'));

    expect(await screen.findByText('We could not record this payment. Check your connection and try again.')).toBeTruthy();
    expect(screen.queryByText('Prisma: transaction rolled back')).toBeNull();
  });
});
