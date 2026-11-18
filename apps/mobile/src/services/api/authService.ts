import { apiClient, type ApiClient } from './apiClient';
import type { AuthResponse, CurrentUserResponse } from '../../types/auth';

export type LoginInput = { email: string; password: string };
export type RegisterInput = { fullName: string; email: string; password: string };

export class AuthService {
  constructor(private readonly client: ApiClient) {}

  setUnauthorizedHandler(handler: (() => void) | undefined) {
    this.client.setUnauthorizedHandler(handler);
  }

  login(input: LoginInput) {
    return this.client.request<AuthResponse>('/api/auth/login', {
      method: 'POST', auth: 'none', body: JSON.stringify(input),
    });
  }

  register(input: RegisterInput) {
    return this.client.request<AuthResponse>('/api/auth/register', {
      method: 'POST', auth: 'none', body: JSON.stringify(input),
    });
  }

  getCurrentUser() {
    return this.client.request<CurrentUserResponse>('/api/auth/me', {
      method: 'GET', auth: 'required',
    });
  }
}

export const authService = new AuthService(apiClient);
