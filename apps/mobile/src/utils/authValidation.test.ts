import { validateLogin, validateRegistration } from './authValidation';

describe('authentication form validation', () => {
  it('requires a valid email and an eight-character password for login', () => {
    expect(validateLogin('', 'short').errors).toEqual({
      email: 'Enter a valid email address.',
      password: 'Password must be at least 8 characters.',
    });
    expect(validateLogin('  USER@example.test ', 'valid-pass').input).toEqual({ email: 'user@example.test', password: 'valid-pass' });
  });

  it('matches the registration API fields and validates the full name', () => {
    expect(validateRegistration('A', 'not-an-email', '12345678').errors).toEqual({
      fullName: 'Enter your full name.',
      email: 'Enter a valid email address.',
    });
    expect(validateRegistration(' Alex Morgan ', 'ALEX@example.test', 'valid-pass').input).toEqual({
      fullName: 'Alex Morgan', email: 'alex@example.test', password: 'valid-pass',
    });
  });
});
