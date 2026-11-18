export const appConfig = {
  apiBaseUrl: 'http://localhost:4000',
};

export type AppRole = 'OWNER' | 'ADMIN' | 'MEMBER' | 'VIEWER';

export const roleLabels: Record<AppRole, string> = {
  OWNER: 'Owner',
  ADMIN: 'Admin',
  MEMBER: 'Member',
  VIEWER: 'Viewer',
};
