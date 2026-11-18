import { PrismaClient } from '../tmp/pg-client/index.js';

const p = new PrismaClient({ datasources: { db: { url: process.env.PG_TARGET_URL } } });

const code = process.argv[2];
const title = process.argv[3];

const trip = await p.trip.findUnique({
  where: { joinCode: code },
  include: {
    members: { include: { user: { select: { id: true, fullName: true } } } },
    expenses: {
      where: title ? { title } : undefined,
      include: {
        payers: true,
        allocations: true,
        financialEntries: true,
      },
    },
  },
});

if (!trip) {
  console.log('not found');
} else {
  console.log('TRIP', trip.name, trip.baseCurrency, 'status', trip.status);
  const names = new Map(trip.members.map((m) => [m.userId, m.user.fullName]));
  for (const m of trip.members) {
    console.log(' member', m.user.fullName, m.userId, 'active', m.isActive, 'role', m.role);
  }
  for (const e of trip.expenses) {
    console.log('expense', e.id, e.title, 'amount', e.amount, 'converted', e.convertedAmount, e.expenseType, e.status, e.splitMethod, e.createdAt.toISOString());
    console.log(' payers', e.payers.map((x) => `${names.get(x.userId) ?? x.userId}:${x.amount}`).join(', '));
    console.log(' allocs', e.allocations.map((x) => `${names.get(x.userId) ?? x.userId}:${x.amount}`).join(', '));
    console.log(' entries', e.financialEntries.map((x) => `${x.entryType}:${names.get(x.userId) ?? x.userId}:${x.amount}:${x.id}`).join(' | '));
  }
}

await p.$disconnect();
