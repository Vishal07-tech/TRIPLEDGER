import type { Response } from 'express';
import { z } from 'zod';

import { prisma } from '../lib/prisma.js';
import type { AuthenticatedRequest } from '../middleware/authMiddleware.js';
import { acceptTripInvitation, declineTripInvitation, InvitationError, listPendingInvitations } from '../services/invitationService.js';

const invitationIdSchema = z.string().uuid();

export async function getMyInvitations(req: AuthenticatedRequest, res: Response) {
  const invitations = await listPendingInvitations(prisma, req.user!.id);
  res.json({ invitations });
}

export async function acceptInvitation(req: AuthenticatedRequest, res: Response) {
  const parsed = invitationIdSchema.safeParse(req.params.invitationId);
  if (!parsed.success) {
    res.status(400).json({ message: 'Invalid invitation identifier.' });
    return;
  }

  try {
    const result = await acceptTripInvitation(prisma, parsed.data, req.user!.id);
    if ('expired' in result && result.expired) {
      res.status(410).json({ message: 'This invitation has expired.' });
      return;
    }
    res.json({
      accepted: true,
      alreadyAccepted: result.alreadyAccepted,
      tripId: result.invitation.tripId,
    });
  } catch (error) {
    if (error instanceof InvitationError) {
      res.status(error.statusCode).json({ message: error.message });
      return;
    }
    throw error;
  }
}

export async function declineInvitation(req: AuthenticatedRequest, res: Response) {
  const parsed = invitationIdSchema.safeParse(req.params.invitationId);
  if (!parsed.success) {
    res.status(400).json({ message: 'Invalid invitation identifier.' });
    return;
  }
  try {
    const invitation = await declineTripInvitation(prisma, parsed.data, req.user!.id);
    if ('expired' in invitation) {
      res.status(410).json({ message: 'This invitation has expired.' });
      return;
    }
    res.json({ declined: true, tripId: invitation.tripId });
  } catch (error) {
    if (error instanceof InvitationError) {
      res.status(error.statusCode).json({ message: error.message });
      return;
    }
    throw error;
  }
}
