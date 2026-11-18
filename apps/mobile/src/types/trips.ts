export type TripStatus =
  | 'ACTIVE'
  | 'CLOSING'
  | 'EXPENSE_REVIEW'
  | 'SETTLEMENT_PLANNED'
  | 'PAYMENTS_PENDING'
  | 'PARTIALLY_SETTLED'
  | 'FULLY_SETTLED'
  | 'TRIP_CLOSED';

export type TripRole = 'OWNER' | 'ADMIN' | 'MEMBER' | 'VIEWER';

export type ExpensePurpose = 'PERSONAL' | 'GROUP';
export type ExpenseSplitMethod = 'EQUAL' | 'EXACT' | 'PERCENTAGE' | 'WEIGHTED';
export type ExpensePaymentMethod = 'UPI' | 'CASH';

export type TripMember = {
  id: string;
  tripId: string;
  userId: string;
  role: TripRole;
  joinedAt: string;
  isActive: boolean;
  budgetLimit: string | null;
  user: {
    id: string;
    fullName: string;
    email: string;
  };
};

export type TripSettings = {
  id: string;
  tripId: string;
  allowMemberExpenseEdit: boolean;
  requireLocationConfirmation: boolean;
  allowPublicJoin: boolean;
  createdAt: string;
  updatedAt: string;
};

export type Trip = {
  id: string;
  name: string;
  description: string | null;
  startDate: string | null;
  endDate: string | null;
  baseCurrency: string;
  status: TripStatus;
  joinCode: string | null;
  cashManagerUserId: string | null;
  createdByUserId: string;
  createdAt: string;
  updatedAt: string;
  members: TripMember[];
  settings: TripSettings | null;
};

export type CreateTripSettingsInput = {
  allowMemberExpenseEdit?: boolean;
  requireLocationConfirmation?: boolean;
  allowPublicJoin?: boolean;
};

export type CreateTripInput = {
  name: string;
  description?: string;
  baseCurrency: string;
  startDate?: string;
  endDate?: string;
  settings?: CreateTripSettingsInput;
};

export type ExpensePayer = {
  id: string;
  expenseId: string;
  userId: string;
  amount: string;
  currency: string;
  paymentStatus: string;
  isCashManagerDisbursement: boolean;
  paidAt: string | null;
};

export type ExpenseAllocation = {
  id: string;
  expenseId: string;
  userId: string;
  allocatedAmount: string;
  percentage: string | null;
  weight: string | null;
  isManual: boolean;
};

export type TripExpense = {
  id: string;
  tripId: string;
  title: string;
  description: string | null;
  amount: string;
  currency: string;
  convertedAmount: string | null;
  exchangeRate: string | null;
  category: string;
  expenseType: ExpensePurpose;
  splitMethod: ExpenseSplitMethod;
  paymentMethod: ExpensePaymentMethod;
  date: string;
  createdByUserId: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  payers: ExpensePayer[];
  allocations: ExpenseAllocation[];
};

export type TripBalanceMember = {
  userId: string;
  fullName: string;
  isActive: boolean;
  recordedAdvances: string;
  responsibility: string;
  netBalance: string;
};

export type TripBalances = {
  currency: string;
  totalExpenses: string;
  members: TripBalanceMember[];
};

export type TripLocationMember = {
  userId: string;
  fullName: string;
  isActive: boolean;
  isSharing: boolean;
  latitude: number | null;
  longitude: number | null;
  accuracyMeters: number | null;
  updatedAt: string | null;
};

export type TripLocations = {
  members: TripLocationMember[];
  refreshAfterSeconds: number;
};

export type ShareLocationInput = {
  latitude: number;
  longitude: number;
  accuracyMeters?: number;
  capturedAt?: string;
};

export type CreateExpenseInput = {
  title: string;
  amount: string;
  currency: string;
  category: string;
  expenseType: ExpensePurpose;
  splitMethod: ExpenseSplitMethod;
  paymentMethod: ExpensePaymentMethod;
  date: string;
  responsibleUserId?: string;
  splits?: Array<{ userId: string }>;
  payers: Array<{ userId: string; amount: string }>;
};
