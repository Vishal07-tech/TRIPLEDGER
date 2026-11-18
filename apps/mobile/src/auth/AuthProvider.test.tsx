import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Pressable, Text } from 'react-native';

import { AuthProvider, useAuth, type AuthOperations } from './AuthContext';
import type { AuthUser } from '../types/auth';
import type { SecureTokenStorage } from '../services/storage/secureStorage';

const user: AuthUser = { id: 'user-1', email: 'alex@example.test', fullName: 'Alex Morgan', role: 'MEMBER' };

function createHarness(token: string | null = null, getCurrentUser: () => Promise<{ user: AuthUser }> = () => Promise.resolve({ user })) {
  const service: AuthOperations = {
    setUnauthorizedHandler: jest.fn(),
    login: jest.fn().mockResolvedValue({ user, token: 'jwt-for-tests', message: 'Login successful.' }),
    register: jest.fn().mockResolvedValue({ user, token: 'jwt-for-tests', message: 'Account created successfully.' }),
    getCurrentUser: jest.fn(getCurrentUser),
  };
  const storage: SecureTokenStorage = {
    getToken: jest.fn().mockResolvedValue(token),
    setToken: jest.fn().mockResolvedValue(undefined),
    deleteToken: jest.fn().mockResolvedValue(undefined),
  };
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  function Probe() {
    const auth = useAuth();
    return (
      <>
        <Text>{auth.status}</Text>
        <Text>{auth.user?.fullName ?? 'no-user'}</Text>
        <Text>{auth.error}</Text>
        <Pressable testID="login" onPress={() => void auth.login({ email: user.email, password: 'valid-pass' })}><Text>login</Text></Pressable>
        <Pressable testID="register" onPress={() => void auth.register({ fullName: user.fullName, email: user.email, password: 'valid-pass' })}><Text>register</Text></Pressable>
        <Pressable testID="logout" onPress={() => void auth.logout()}><Text>logout</Text></Pressable>
      </>
    );
  }
  const result = render(
    <QueryClientProvider client={queryClient}>
      <AuthProvider service={service} storage={storage}><Probe /></AuthProvider>
    </QueryClientProvider>,
  );
  return { ...result, service, storage, queryClient };
}

describe('authenticated session lifecycle', () => {
  it('restores a saved session from the current-user API', async () => {
    const { storage, service } = createHarness('saved-jwt');
    expect(await screen.findByText('authenticated')).toBeTruthy();
    expect(storage.getToken).toHaveBeenCalledTimes(1);
    expect(service.getCurrentUser).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Alex Morgan')).toBeTruthy();
  });

  it('signs in and registers using the API result, securely saving the returned token', async () => {
    const login = createHarness();
    await screen.findByText('unauthenticated');
    fireEvent.press(screen.getByTestId('login'));
    await screen.findByText('authenticated');
    expect(login.service.login).toHaveBeenCalledWith({ email: user.email, password: 'valid-pass' });
    expect(login.storage.setToken).toHaveBeenCalledWith('jwt-for-tests');
    login.unmount();
    login.queryClient.clear();

    const registration = createHarness();
    await screen.findByText('unauthenticated');
    fireEvent.press(screen.getByTestId('register'));
    await waitFor(() => expect(registration.service.register).toHaveBeenCalledWith({ fullName: user.fullName, email: user.email, password: 'valid-pass' }));
    expect(registration.storage.setToken).toHaveBeenCalledWith('jwt-for-tests');
    registration.unmount();
    registration.queryClient.clear();
  });

  it('securely deletes the token and clears server state on logout', async () => {
    const { storage, queryClient } = createHarness('saved-jwt');
    await screen.findByText('authenticated');
    fireEvent.press(screen.getByTestId('logout'));
    await screen.findByText('unauthenticated');
    expect(storage.deleteToken).toHaveBeenCalledTimes(1);
    expect(queryClient.getQueryData(['auth', 'current-user'])).toBeUndefined();
  });

  it('keeps the token when session restoration fails because the network is unavailable', async () => {
    const harness = createHarness('saved-jwt', () => Promise.reject(new Error('Network unavailable.')));
    await screen.findByText('error');
    expect(harness.storage.deleteToken).not.toHaveBeenCalled();
    expect(screen.getByText('Network unavailable.')).toBeTruthy();
  });
});
