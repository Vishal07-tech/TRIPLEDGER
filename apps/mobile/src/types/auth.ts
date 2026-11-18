export type AppStackParamList = {
  Home: undefined;
  MyTrips: undefined;
  TripDetail: { tripId: string; tripName: string };
  CreateTrip: undefined;
  JoinTrip: undefined;
  ReportExpense: { tripId: string; tripName: string };
  LiveLocation: { tripId: string; tripName: string };
};

export type AuthUser = {
  id: string;
  email: string;
  fullName: string;
  role: string;
  createdAt?: string;
};

export type AuthResponse = {
  message: string;
  user: AuthUser;
  token: string;
};

export type CurrentUserResponse = { user: AuthUser };

export type AuthStackParamList = {
  Login: undefined;
  Register: undefined;
};
