export const SESSION_EXPIRED_EVENT = 'tripledger:session-expired';
const sessionStorageKey = 'tripledger_token';

export function getSessionToken() {
  return typeof localStorage === 'undefined' ? '' : localStorage.getItem(sessionStorageKey) ?? '';
}

export function setSessionToken(token: string) {
  localStorage.setItem(sessionStorageKey, token);
}

export function clearSessionToken() {
  if (typeof localStorage !== 'undefined') localStorage.removeItem(sessionStorageKey);
}

export function notifySessionExpired() {
  clearSessionToken();
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(SESSION_EXPIRED_EVENT));
  }
}
