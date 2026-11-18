import { PrismaClient } from '../tmp/pg-client/index.js';

const p = new PrismaClient({ datasources: { db: { url: process.env.PG_TARGET_URL } } });

const code = process.argv[2];

const trip = await p.trip.findUnique({
  where: { joinCode: code },
  include: {
    members: { include: { user: { select: { fullName: true } } } },
    expenses: { include: { payers: true, allocations: true } },
  },
});

if (!trip) {
  console.log('not found');
} else {
  console.log('TRIP', trip.name, 'members', trip.members.length);
  for (const m of trip.members) {
    console.log(' member', m.user.fullName, 'joined', m.joinedAt.toISOString(), 'active', m.isActive, m.userId);
  }
  for (const e of trip.expenses) {
    console.log(' expense', e.title, e.amount, e.expenseType, 'created', e.createdAt.toISOString());
    console.log('  payers', e.payers.map((x) => `${x.userId}:${x.amount}`).join(', '));
    console.log('  allocs', e.allocations.map((x) => `${x.userId}:${x.amount}`).join(', '));
  }
}

await p.$disconnect();
