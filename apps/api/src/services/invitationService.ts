import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import type { PrismaClient } from '@prisma/client';

import { ident } from '../lib/sqlDialect.js';
import { enqueueTripEvent } from './outboxService.js';

type Db = PrismaClient | Prisma.TransactionClient;

const INVITATION_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;

export class InvitationError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
  ) {
    super(message);
    this.name = 'InvitationError';
  }
}

export async function listPendingInvitations(db: Db, userId: string) {
  const user = await db.user.findUnique({ where: { id: userId }, select: { email: true } });
  if (!user) return [];

  const email = user.email.trim().toLowerCase();
  const now = new Date();
  await db.tripInvitation.updateMany({
    where: { email, status: 'pending', expiresAt: { lte: now } },
    data: { status: 'expired' },
  });

  return db.tripInvitation.findMany({
    where: { email, status: 'pending', expiresAt: { gt: now }, trip: { status: 'ACTIVE' } },
    select: {
      id: true,
      tripId: true,
      email: true,
      expiresAt: true,
      createdAt: true,
      trip: { select: { name: true, baseCurrency: true, status: true } },
    },
    orderBy: { createdAt: 'desc' },
  });
}

export async function createTripInvitation(
  db: Prisma.TransactionClient,
  input: { tripId: string; email: string; invitedBy: string },
) {
  const email = input.email.trim().toLowerCase();
  const now = new Date();
  await db.tripInvitation.updateMany({
    where: { tripId: input.tripId, email, status: 'pending', expiresAt: { lte: now } },
    data: { status: 'expired' },
  });

  const existing = await db.tripInvitation.findFirst({
    where: { tripId: input.tripId, email, status: 'pending', expiresAt: { gt: now } },
    select: { id: true },
  });
  if (existing) throw new InvitationError('A pending invitation already exists for this account.', 409);

  return db.tripInvitation.create({
    data: {
      tripId: input.tripId,
      email,
      invitedBy: input.invitedBy,
      status: 'pending',
      expiresAt: new Date(now.getTime() + INVITATION_LIFETIME_MS),
    },
  });
}

export async function acceptTripInvitation(db: PrismaClient, invitationId: string, userId: string) {
  return db.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT ${ident('id')} FROM ${ident('TripInvitation')} WHERE ${ident('id')} = ${invitationId} FOR UPDATE
    `);
    if (locked.length === 0) throw new InvitationError('Invitation not found.', 404);

    const [user, invitation] = await Promise.all([
      tx.user.findUnique({ where: { id: userId }, select: { email: true } }),
      tx.tripInvitation.findUnique({
        where: { id: invitationId },
        include: { trip: { select: { status: true } } },
      }),
    ]);
    if (!user || !invitation || invitation.email.toLowerCase() !== user.email.trim().toLowerCase()) {
      throw new InvitationError('Invitation not found.', 404);
    }

    if (invitation.status === 'accepted' && invitation.acceptedByUserId === userId) {
      const membership = await tx.tripMember.findUnique({
        where: { tripId_userId: { tripId: invitation.tripId, userId } },
      });
      if (membership?.isActive) return { invitation, membership, alreadyAccepted: true };
    }
    if (invitation.status !== 'pending') {
      const statusCode = invitation.status === 'expired' ? 410 : 409;
      throw new InvitationError('This invitation is no longer available.', statusCode);
    }

    const now = new Date();
    if (invitation.expiresAt <= now) {
      await tx.tripInvitation.update({ where: { id: invitation.id }, data: { status: 'expired' } });
      return { expired: true as const };
    }
    if (invitation.trip.status !== 'ACTIVE') {
      throw new InvitationError('This trip is no longer accepting members.', 409);
    }

    const existingMembership = await tx.tripMember.findUnique({
      where: { tripId_userId: { tripId: invitation.tripId, userId } },
    });
    let membership;
    if (existingMembership?.isActive) {
      membership = existingMembership;
    } else if (existingMembership) {
      membership = await tx.tripMember.update({
        where: { id: existingMembership.id },
        data: { isActive: true, role: 'MEMBER', joinedAt: now },
      });
    } else {
      membership = await tx.tripMember.create({
        data: { tripId: invitation.tripId, userId, role: 'MEMBER', joinedAt: now },
      });
    }

    const acceptedInvitation = await tx.tripInvitation.update({
      where: { id: invitation.id },
      data: { status: 'accepted', acceptedAt: now, acceptedByUserId: userId },
    });

    if (!existingMembership?.isActive) {
      await enqueueTripEvent(tx, {
        tripId: invitation.tripId,
        eventKey: `trip:${invitation.tripId}:invitation-accepted:${invitation.id}:${randomUUID()}`,
        eventType: 'TRIP_MEMBER_ADDED',
        payload: { entityType: 'Trip', entityId: invitation.tripId, actorUserId: userId },
      });
    }

    return { invitation: acceptedInvitation, membership, alreadyAccepted: false };
  });
}

export async function declineTripInvitation(db: PrismaClient, invitationId: string, userId: string) {
  return db.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT ${ident('id')} FROM ${ident('TripInvitation')} WHERE ${ident('id')} = ${invitationId} FOR UPDATE
    `);
    if (locked.length === 0) throw new InvitationError('Invitation not found.', 404);
    const [user, invitation] = await Promise.all([
      tx.user.findUnique({ where: { id: userId }, select: { email: true } }),
      tx.tripInvitation.findUnique({ where: { id: invitationId } }),
    ]);
    if (!user || !invitation || invitation.email.toLowerCase() !== user.email.trim().toLowerCase()) {
      throw new InvitationError('Invitation not found.', 404);
    }
    if (invitation.status !== 'pending') {
      throw new InvitationError('This invitation is no longer available.', invitation.status === 'expired' ? 410 : 409);
    }
    if (invitation.expiresAt <= new Date()) {
      const expiredInvitation = await tx.tripInvitation.update({
        where: { id: invitation.id },
        data: { status: 'expired' },
        select: { id: true, tripId: true, status: true },
      });
      return { expired: true as const, invitation: expiredInvitation };
    }
    const declined = await tx.tripInvitation.update({
      where: { id: invitation.id },
      data: { status: 'declined' },
      select: { id: true, tripId: true, status: true },
    });
    return declined;
  });
}
