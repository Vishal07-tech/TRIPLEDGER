import * as SecureStore from 'expo-secure-store';

import { secureStorage, SecureStorageError } from './secureStorage';

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(),
  setItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
}));

describe('secure token storage', () => {
  beforeEach(() => jest.clearAllMocks());

  it('saves, retrieves, and deletes the session token through SecureStore', async () => {
    jest.mocked(SecureStore.getItemAsync).mockResolvedValue('stored-token');
    await secureStorage.setToken('new-token');
    await expect(secureStorage.getToken()).resolves.toBe('stored-token');
    await secureStorage.deleteToken();
    expect(SecureStore.setItemAsync).toHaveBeenCalledWith('tripledger.auth-token', 'new-token');
    expect(SecureStore.getItemAsync).toHaveBeenCalledWith('tripledger.auth-token');
    expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith('tripledger.auth-token');
  });

  it('normalizes platform storage failures and refuses an empty token', async () => {
    jest.mocked(SecureStore.getItemAsync).mockRejectedValue(new Error('native storage details'));
    await expect(secureStorage.getToken()).rejects.toBeInstanceOf(SecureStorageError);
    await expect(secureStorage.setToken(' ')).rejects.toBeInstanceOf(SecureStorageError);
    expect(SecureStore.setItemAsync).not.toHaveBeenCalled();
  });

  it('reports failure when secure deletion fails', async () => {
    jest.mocked(SecureStore.deleteItemAsync).mockRejectedValue(new Error('native storage details'));
    await expect(secureStorage.deleteToken()).rejects.toBeInstanceOf(SecureStorageError);
  });
});
