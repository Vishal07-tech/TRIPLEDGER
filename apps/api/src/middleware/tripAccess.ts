import type { Response } from 'express';

import { prisma } from '../lib/prisma.js';
import { asyncHandler } from './asyncHandler.js';
import type { AuthenticatedRequest } from './authMiddleware.js';

export type TripAwareRequest = AuthenticatedRequest & {
  tripMember?: {
    id: string;
    tripId: string;
    userId: string;
    role: string;
    isActive: boolean;
  };
};

function toSingleString(value: string | string[] | undefined) {
  if (Array.isArray(value)) {
    return value[0] ?? '';
  }

  return value ?? '';
}

export function requireTripAccess(requiredRoles?: string[]) {
  return asyncHandler<TripAwareRequest>(async function tripAccessMiddleware(req, res, next) {
    const tripId = toSingleString(req.params.tripId);

    if (!tripId) {
      res.status(400).json({ message: 'Trip identifier is required.' });
      return;
    }

    if (!req.user?.id) {
      res.status(401).json({ message: 'Authentication required.' });
      return;
    }

    const membership = await prisma.tripMember.findFirst({
      where: {
        tripId,
        userId: req.user.id,
        isActive: true,
      },
      select: {
        id: true,
        tripId: true,
        userId: true,
        role: true,
        isActive: true,
      },
    });

    if (!membership) {
      res.status(403).json({ message: 'You are not a member of this trip.' });
      return;
    }

    if (requiredRoles && requiredRoles.length > 0 && !requiredRoles.includes(membership.role)) {
      res.status(403).json({ message: 'You do not have permission to perform this action.' });
      return;
    }

    req.tripMember = membership;
    next();
  });
}
