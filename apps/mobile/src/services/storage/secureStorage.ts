import * as SecureStore from 'expo-secure-store';

const authTokenKey = 'tripledger.auth-token';

export class SecureStorageError extends Error {
  constructor() {
    super('Secure session storage is unavailable. Please try again.');
    this.name = 'SecureStorageError';
  }
}

export interface SecureTokenStorage {
  getToken(): Promise<string | null>;
  setToken(token: string): Promise<void>;
  deleteToken(): Promise<void>;
}

export const secureStorage: SecureTokenStorage = {
  async getToken() {
    try {
      return await SecureStore.getItemAsync(authTokenKey);
    } catch {
      throw new SecureStorageError();
    }
  },
  async setToken(token: string) {
    if (!token.trim()) throw new SecureStorageError();
    try {
      await SecureStore.setItemAsync(authTokenKey, token);
    } catch {
      throw new SecureStorageError();
    }
  },
  async deleteToken() {
    try {
      await SecureStore.deleteItemAsync(authTokenKey);
    } catch {
      throw new SecureStorageError();
    }
  },
};
