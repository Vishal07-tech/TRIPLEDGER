import type { NextFunction, Request, Response } from 'express';

import { verifyAuthToken } from '../services/authService.js';

export type AuthenticatedRequest = Request & {
  user?: {
    id: string;
    email: string;
    role: string;
  };
};

export function requireAuth(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ message: 'Authentication required.' });
    return;
  }

  const token = authHeader.replace('Bearer ', '').trim();

  try {
    const payload = verifyAuthToken(token);
    req.user = {
      id: payload.sub,
      email: payload.email,
      role: payload.role,
    };
    next();
  } catch {
    res.status(401).json({ message: 'Your session is invalid or expired.' });
  }
}
