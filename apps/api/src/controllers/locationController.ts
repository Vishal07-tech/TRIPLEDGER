import type { Response } from 'express';
import { z } from 'zod';

import { prisma } from '../lib/prisma.js';
import type { TripAwareRequest } from '../middleware/tripAccess.js';

const shareLocationSchema = z.object({
  latitude: z.number().finite().min(-90).max(90),
  longitude: z.number().finite().min(-180).max(180),
  accuracyMeters: z.number().finite().min(0).max(100_000).optional(),
  capturedAt: z.string().datetime({ offset: true }).optional(),
});

/** Older than this is treated as stale and not handed back to the group. */
const LOCATION_TTL_MS = 24 * 60 * 60 * 1000;

function toSingleString(value: string | string[] | undefined) {
  return Array.isArray(value) ? (value[0] ?? '') : (value ?? '');
}

/**
 * Lists every member of a trip together with the last position they chose to
 * share. Coordinates are only readable by members of that trip.
 */
export async function listTripLocations(req: TripAwareRequest, res: Response) {
  const tripId = toSingleString(req.params.tripId);
  const since = new Date(Date.now() - LOCATION_TTL_MS);

  const [members, locations] = await Promise.all([
    prisma.tripMember.findMany({
      where: { tripId },
      include: { user: { select: { id: true, fullName: true } } },
      orderBy: { joinedAt: 'asc' },
    }),
    prisma.memberLocation.findMany({
      where: { tripId, updatedAt: { gte: since } },
    }),
  ]);

  const byUserId = new Map(locations.map((location) => [location.userId, location]));

  res.json({
    members: members.map((member) => {
      const location = byUserId.get(member.userId);
      return {
        userId: member.userId,
        fullName: member.user.fullName,
        isActive: member.isActive,
        isSharing: Boolean(location),
        latitude: location ? Number(location.latitude) : null,
        longitude: location ? Number(location.longitude) : null,
        accuracyMeters: location?.accuracyMeters ?? null,
        updatedAt: location ? location.updatedAt.toISOString() : null,
      };
    }),
    refreshAfterSeconds: 15,
  });
}

/** Creates or refreshes the caller's shared position for this trip. */
export async function shareTripLocation(req: TripAwareRequest, res: Response) {
  const tripId = toSingleString(req.params.tripId);
  const parsed = shareLocationSchema.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({ message: 'That location reading is not valid.', issues: parsed.error.flatten() });
    return;
  }

  const capturedAt = parsed.data.capturedAt ? new Date(parsed.data.capturedAt) : new Date();
  const values = {
    latitude: parsed.data.latitude,
    longitude: parsed.data.longitude,
    accuracyMeters: parsed.data.accuracyMeters === undefined ? null : Math.round(parsed.data.accuracyMeters),
    capturedAt,
  };

  const location = await prisma.memberLocation.upsert({
    where: { tripId_userId: { tripId, userId: req.user!.id } },
    create: { tripId, userId: req.user!.id, ...values },
    update: values,
  });

  res.json({
    location: {
      userId: location.userId,
      latitude: Number(location.latitude),
      longitude: Number(location.longitude),
      accuracyMeters: location.accuracyMeters,
      updatedAt: location.updatedAt.toISOString(),
    },
  });
}

/** Removes the caller's shared position so it is no longer visible to the trip. */
export async function stopSharingTripLocation(req: TripAwareRequest, res: Response) {
  const tripId = toSingleString(req.params.tripId);
  await prisma.memberLocation.deleteMany({ where: { tripId, userId: req.user!.id } });
  res.json({ sharing: false });
}
