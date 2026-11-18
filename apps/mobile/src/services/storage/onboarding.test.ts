import * as SecureStore from 'expo-secure-store';

import { hasSeenOnboarding, markOnboardingSeen } from './onboarding';

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(),
  setItemAsync: jest.fn(),
}));

describe('onboarding state', () => {
  beforeEach(() => jest.clearAllMocks());

  it('reports a new device as not having seen the tour', async () => {
    jest.mocked(SecureStore.getItemAsync).mockResolvedValue(null);
    await expect(hasSeenOnboarding()).resolves.toBe(false);
  });

  it('remembers a completed tour', async () => {
    jest.mocked(SecureStore.getItemAsync).mockResolvedValue('seen');
    await expect(hasSeenOnboarding()).resolves.toBe(true);
  });

  it('stores the flag under the current app name', async () => {
    await markOnboardingSeen();
    expect(SecureStore.setItemAsync).toHaveBeenCalledWith('sutrula.onboarding.v1', 'seen');
  });

  it('does not block the app when secure storage fails', async () => {
    jest.mocked(SecureStore.getItemAsync).mockRejectedValue(new Error('keystore unavailable'));
    await expect(hasSeenOnboarding()).resolves.toBe(true);
    await expect(markOnboardingSeen()).resolves.toBeUndefined();
  });
});
