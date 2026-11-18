import { randomUUID } from 'node:crypto';
import type { Request, Response } from 'express';

import { prisma } from '../lib/prisma.js';
import { createTripInput, generateJoinCode, joinTripSchema, memberBudgetSchema, memberRoleSchema, tripCreateSchema, tripInvitationSchema, tripMemberSchema, tripSettingsSchema } from '../services/tripService.js';
import type { TripAwareRequest } from '../middleware/tripAccess.js';
import { syncMemberBudget } from '../services/budgetService.js';
import { FinancialInputError, minorToDecimalString, parseMoneyToMinor } from '../services/financialMath.js';
import { enqueueTripEvent, type TripEventType } from '../services/outboxService.js';
import { createTripInvitation, InvitationError } from '../services/invitationService.js';

async function enqueueTripManagementEvent(
  tx: Parameters<typeof enqueueTripEvent>[0],
  tripId: string,
  actorUserId: string,
  eventType: TripEventType,
) {
  await enqueueTripEvent(tx, {
    tripId,
    eventKey: `trip:${tripId}:${eventType}:${randomUUID()}`,
    eventType,
    payload: { entityType: 'Trip', entityId: tripId, actorUserId },
  });
}

function normalizeTripResponse(trip: any) {
  return {
    id: trip.id,
    name: trip.name,
    description: trip.description,
    startDate: trip.startDate ?? null,
    endDate: trip.endDate ?? null,
    baseCurrency: trip.baseCurrency,
    status: trip.status,
    joinCode: trip.joinCode ?? null,
    cashManagerUserId: trip.cashManagerUserId,
    createdByUserId: trip.createdByUserId,
    createdAt: trip.createdAt,
    updatedAt: trip.updatedAt,
    members: trip.members ?? [],
    settings: trip.tripSettings ?? null,
  };
}

function toSingleString(value: string | string[] | undefined) {
  if (Array.isArray(value)) {
    return value[0] ?? '';
  }

  return value ?? '';
}

export async function createTrip(req: Request, res: Response) {
  const parsed = tripCreateSchema.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({ message: 'Invalid trip payload.', issues: parsed.error.flatten() });
    return;
  }

  const authUser = (req as any).user;

  if (!authUser?.id) {
    res.status(401).json({ message: 'Authentication required.' });
    return;
  }

  const payload = createTripInput(parsed.data);

  let trip: any = null;
  // A join-code collision is vanishingly rare, but the unique index aborts the
  // transaction, so retry with a fresh code instead of failing the request.
  for (let attempt = 0; attempt < 5 && !trip; attempt += 1) {
    try {
      trip = await prisma.$transaction(async (tx) => {
        const tripRecord = await tx.trip.create({
          data: {
            name: payload.name,
            description: payload.description,
            startDate: payload.startDate ? new Date(`${payload.startDate}T00:00:00.000Z`) : null,
            endDate: payload.endDate ? new Date(`${payload.endDate}T00:00:00.000Z`) : null,
            baseCurrency: payload.baseCurrency,
            joinCode: generateJoinCode(),
            createdByUserId: authUser.id,
            cashManagerUserId: authUser.id,
          },
        });

        await tx.tripMember.create({
          data: {
            tripId: tripRecord.id,
            userId: authUser.id,
            role: 'OWNER',
          },
        });

        await tx.tripSetting.create({ data: { tripId: tripRecord.id, ...payload.settings } });

        return await tx.trip.findUnique({
          where: { id: tripRecord.id },
          include: {
            members: { include: { user: { select: { id: true, fullName: true, email: true } } } },
            tripSettings: true,
          },
        });
      });
    } catch (error) {
      if ((error as { code?: string })?.code === 'P2002') continue;
      throw error;
    }
  }

  if (!trip) {
    res.status(500).json({ message: 'Could not create the trip. Please try again.' });
    return;
  }

  res.status(201).json({ trip: normalizeTripResponse(trip) });
}

export async function joinTrip(req: Request, res: Response) {
  const parsed = joinTripSchema.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({ message: 'Enter a valid trip code.' });
    return;
  }

  const authUser = (req as any).user;

  if (!authUser?.id) {
    res.status(401).json({ message: 'Authentication required.' });
    return;
  }

  const match = await prisma.trip.findUnique({
    where: { joinCode: parsed.data.code },
    select: {
      id: true,
      status: true,
      members: { where: { userId: authUser.id }, select: { id: true, isActive: true } },
    },
  });

  if (!match) {
    res.status(404).json({ message: 'Invalid or expired trip code.' });
    return;
  }

  if (match.status !== 'ACTIVE' && match.status !== 'CLOSING') {
    res.status(409).json({ message: 'This trip is no longer accepting members.' });
    return;
  }

  const existing = match.members[0];

  await prisma.$transaction(async (tx) => {
    if (existing) {
      if (!existing.isActive) {
        await tx.tripMember.update({ where: { id: existing.id }, data: { isActive: true } });
        await enqueueTripManagementEvent(tx, match.id, authUser.id, 'TRIP_MEMBER_ADDED');
      }
      return;
    }

    await tx.tripMember.create({
      data: { tripId: match.id, userId: authUser.id, role: 'MEMBER' },
    });
    await enqueueTripManagementEvent(tx, match.id, authUser.id, 'TRIP_MEMBER_ADDED');
  });

  const trip = await prisma.trip.findUnique({
    where: { id: match.id },
    include: {
      members: { include: { user: { select: { id: true, fullName: true, email: true } } } },
      tripSettings: true,
    },
  });

  res.status(existing?.isActive ? 200 : 201).json({ trip: normalizeTripResponse(trip) });
}

export async function listTrips(req: Request, res: Response) {
  const authUser = (req as any).user;

  if (!authUser?.id) {
    res.status(401).json({ message: 'Authentication required.' });
    return;
  }

  const trips = await prisma.trip.findMany({
    where: {
      members: {
        some: {
          userId: authUser.id,
          isActive: true,
        },
      },
    },
    include: {
      members: { include: { user: { select: { id: true, fullName: true, email: true } } } },
      tripSettings: true,
    },
    orderBy: {
      createdAt: 'desc',
    },
  });

  res.json({ trips: trips.map(normalizeTripResponse) });
}

export async function getTrip(req: TripAwareRequest, res: Response) {
  const tripId = toSingleString(req.params.tripId);

  const trip = await prisma.trip.findUnique({
    where: { id: tripId },
    include: {
      members: { include: { user: { select: { id: true, fullName: true, email: true } } } },
      tripSettings: true,
      memberBudgets: true,
    },
  });

  if (!trip) {
    res.status(404).json({ message: 'Trip not found.' });
    return;
  }

  res.json({ trip: normalizeTripResponse(trip) });
}

export async function listTripInvitations(req: TripAwareRequest, res: Response) {
  const tripId = toSingleString(req.params.tripId);
  const now = new Date();
  await prisma.tripInvitation.updateMany({
    where: { tripId, status: 'pending', expiresAt: { lte: now } },
    data: { status: 'expired' },
  });
  const invitations = await prisma.tripInvitation.findMany({
    where: { tripId, status: 'pending', expiresAt: { gt: now } },
    select: { id: true, email: true, status: true, expiresAt: true, createdAt: true },
    orderBy: { createdAt: 'desc' },
  });
  res.json({ invitations });
}

export async function updateTripSettings(req: TripAwareRequest, res: Response) {
  const tripId = toSingleString(req.params.tripId);
  const authMember = req.tripMember;

  if (!authMember || !['OWNER', 'ADMIN'].includes(authMember.role)) {
    res.status(403).json({ message: 'Only owners and admins can update trip settings.' });
    return;
  }

  const parsed = tripSettingsSchema.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({ message: 'Invalid trip settings payload.', issues: parsed.error.flatten() });
    return;
  }

  const existingTrip = await prisma.trip.findUnique({
    where: { id: tripId },
    include: { tripSettings: true },
  });

  if (!existingTrip) {
    res.status(404).json({ message: 'Trip not found.' });
    return;
  }

  const settings = await prisma.$transaction(async (tx) => {
    const updatedSettings = await tx.tripSetting.upsert({
      where: { tripId },
      update: parsed.data,
      create: {
        tripId,
        ...parsed.data,
      },
    });
    await enqueueTripManagementEvent(tx, tripId, authMember.userId, 'TRIP_SETTINGS_UPDATED');
    return updatedSettings;
  });

  res.json({ settings });
}

export async function createInvitation(req: TripAwareRequest, res: Response) {
  const tripId = toSingleString(req.params.tripId);

  if (!['OWNER', 'ADMIN'].includes(req.tripMember?.role ?? 'MEMBER')) {
    res.status(403).json({ message: 'Only owners and admins can invite members.' });
    return;
  }

  const parsed = tripInvitationSchema.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({ message: 'Invalid invitation payload.', issues: parsed.error.flatten() });
    return;
  }

  const invitedUser = await prisma.user.findUnique({ where: { email: parsed.data.email } });

  if (!invitedUser) {
    res.status(404).json({ message: 'User does not exist. Invite must be sent to a registered member.' });
    return;
  }

  const existingMembership = await prisma.tripMember.findFirst({
    where: {
      tripId,
      userId: invitedUser.id,
      isActive: true,
    },
  });

  if (existingMembership) {
    res.status(409).json({ message: 'This user is already a member of the trip.' });
    return;
  }

  try {
    const invitation = await prisma.$transaction(async (tx) => {
      const trip = await tx.trip.findUnique({ where: { id: tripId }, select: { status: true } });
      if (trip?.status !== 'ACTIVE') {
        throw new InvitationError('Invitations can only be created for active trips.', 409);
      }
      const createdInvitation = await createTripInvitation(tx, {
        tripId,
        email: parsed.data.email,
        invitedBy: req.user!.id,
      });
      await enqueueTripManagementEvent(tx, tripId, req.tripMember!.userId, 'TRIP_INVITATION_CREATED');
      return createdInvitation;
    });

    res.status(201).json({ invitation });
  } catch (error) {
    if (error instanceof InvitationError) {
      res.status(error.statusCode).json({ message: error.message });
      return;
    }
    throw error;
  }
}

export async function addMember(req: TripAwareRequest, res: Response) {
  const tripId = toSingleString(req.params.tripId);

  if (!['OWNER', 'ADMIN'].includes(req.tripMember?.role ?? 'MEMBER')) {
    res.status(403).json({ message: 'Only owners and admins can add members.' });
    return;
  }

  const parsed = tripMemberSchema.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({ message: 'Invalid member payload.', issues: parsed.error.flatten() });
    return;
  }

  const targetUser = parsed.data.userId
    ? await prisma.user.findUnique({ where: { id: parsed.data.userId } })
    : await prisma.user.findUnique({ where: { email: parsed.data.email! } });

  if (!targetUser) {
    res.status(404).json({ message: 'Target user not found.' });
    return;
  }

  const existingMembership = await prisma.tripMember.findFirst({
    where: {
      tripId,
      userId: targetUser.id,
      isActive: true,
    },
  });

  if (existingMembership) {
    res.status(409).json({ message: 'User is already a trip member.' });
    return;
  }

  const member = await prisma.$transaction(async (tx) => {
    const createdMember = await tx.tripMember.create({
      data: {
        tripId,
        userId: targetUser.id,
        role: parsed.data.role,
        budgetLimit: parsed.data.budgetLimit ? parsed.data.budgetLimit : null,
      },
    });
    await enqueueTripManagementEvent(tx, tripId, req.tripMember!.userId, 'TRIP_MEMBER_ADDED');
    return createdMember;
  });

  res.status(201).json({ member });
}

export async function updateMemberRole(req: TripAwareRequest, res: Response) {
  const tripId = toSingleString(req.params.tripId);

  if (!['OWNER', 'ADMIN'].includes(req.tripMember?.role ?? 'MEMBER')) {
    res.status(403).json({ message: 'Only owners and admins can manage member roles.' });
    return;
  }

  const parsed = memberRoleSchema.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({ message: 'Invalid role payload.', issues: parsed.error.flatten() });
    return;
  }

  const memberId = toSingleString(req.params.memberId);

  const member = await prisma.tripMember.findUnique({ where: { id: memberId } });

  if (!member || member.tripId !== tripId) {
    res.status(404).json({ message: 'Member record not found.' });
    return;
  }

  const updatedMember = await prisma.$transaction(async (tx) => {
    const changedMember = await tx.tripMember.update({
      where: { id: memberId },
      data: {
        role: parsed.data.role,
        isActive: parsed.data.isActive ?? member.isActive,
        budgetLimit: parsed.data.budgetLimit ?? member.budgetLimit,
      },
    });
    await enqueueTripManagementEvent(tx, tripId, req.tripMember!.userId, 'TRIP_MEMBER_UPDATED');
    return changedMember;
  });

  res.json({ member: updatedMember });
}

export async function setMemberBudget(req: TripAwareRequest, res: Response) {
  const tripId = toSingleString(req.params.tripId);

  if (!['OWNER', 'ADMIN'].includes(req.tripMember?.role ?? 'MEMBER')) {
    res.status(403).json({ message: 'Only owners and admins can set member budgets.' });
    return;
  }

  const parsed = memberBudgetSchema.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({ message: 'Invalid budget payload.', issues: parsed.error.flatten() });
    return;
  }

  const member = await prisma.tripMember.findFirst({
    where: {
      tripId,
      userId: parsed.data.userId,
      isActive: true,
    },
  });

  if (!member) {
    res.status(404).json({ message: 'Target member does not belong to this trip.' });
    return;
  }

  try {
    const budget = await prisma.$transaction(async (tx) => {
      const trip = await tx.trip.findUniqueOrThrow({
        where: { id: tripId },
        select: { baseCurrency: true },
      });
      const planned = parseMoneyToMinor(String(parsed.data.plannedBudget), trip.baseCurrency);
      if (planned <= 0n) {
        throw new FinancialInputError('Planned budget must be greater than zero.');
      }
      await tx.memberBudget.upsert({
        where: { tripId_userId: { tripId, userId: parsed.data.userId } },
        update: {
          plannedBudget: minorToDecimalString(planned, trip.baseCurrency),
        },
        create: {
          tripId,
          userId: parsed.data.userId,
          plannedBudget: minorToDecimalString(planned, trip.baseCurrency),
          remainingBudget: minorToDecimalString(planned, trip.baseCurrency),
          utilizationPct: '0.00',
          overspending: '0.00',
          warningLevel: 'normal',
        },
      });
      const budget = await syncMemberBudget(tx, tripId, parsed.data.userId, trip.baseCurrency);
      if (budget) {
        await enqueueTripEvent(tx, {
          tripId,
          eventKey: `budget:${budget.id}:${randomUUID()}`,
          eventType: 'TRIP_BUDGET_UPDATED',
          payload: {
            entityType: 'MemberBudget',
            entityId: budget.id,
            actorUserId: req.tripMember!.userId,
          },
        });
      }
      return budget;
    });

    res.status(201).json({ budget });
  } catch (error) {
    if (error instanceof FinancialInputError) {
      res.status(400).json({ message: error.message });
      return;
    }
    throw error;
  }
}

export async function updateCashManager(req: TripAwareRequest, res: Response) {
  const tripId = toSingleString(req.params.tripId);

  if (!['OWNER', 'ADMIN'].includes(req.tripMember?.role ?? 'MEMBER')) {
    res.status(403).json({ message: 'Only owners and admins can assign the cash manager.' });
    return;
  }

  const { userId } = req.body ?? {};

  if (!userId || typeof userId !== 'string') {
    res.status(400).json({ message: 'A valid userId is required.' });
    return;
  }

  const destinationMember = await prisma.tripMember.findFirst({
    where: {
      tripId,
      userId,
      isActive: true,
    },
  });

  if (!destinationMember) {
    res.status(404).json({ message: 'Selected user is not a member of this trip.' });
    return;
  }

  const updatedTrip = await prisma.$transaction(async (tx) => {
    const changedTrip = await tx.trip.update({
      where: { id: tripId },
      data: { cashManagerUserId: userId },
    });
    await enqueueTripManagementEvent(tx, tripId, req.tripMember!.userId, 'TRIP_CASH_MANAGER_UPDATED');
    return changedTrip;
  });

  res.json({ trip: normalizeTripResponse(updatedTrip) });
}
