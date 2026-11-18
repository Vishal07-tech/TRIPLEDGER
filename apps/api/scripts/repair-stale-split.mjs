import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';

import { PrismaClient } from '../tmp/pg-client/index.js';

const p = new PrismaClient({ datasources: { db: { url: process.env.PG_TARGET_URL } } });

const tripCode = process.argv[2];
const expenseTitle = process.argv[3];

function moneyToMinor(value) {
  return Math.round(Number(String(value)) * 100);
}

function minorToMoney(minor) {
  return (minor / 100).toFixed(2);
}

const trip = await p.trip.findUnique({
  where: { joinCode: tripCode },
  include: {
    members: { where: { isActive: true }, include: { user: { select: { fullName: true } } } },
    expenses: {
      where: { title: expenseTitle, status: 'ACTIVE' },
      include: { allocations: true, payers: true, financialEntries: true },
    },
  },
});

if (!trip) throw new Error(`Trip ${tripCode} not found.`);
if (trip.expenses.length !== 1) throw new Error(`Expected exactly one active "${expenseTitle}" expense, found ${trip.expenses.length}.`);

const expense = trip.expenses[0];
const totalMinor = moneyToMinor(expense.convertedAmount ?? expense.amount);
const payerMinor = expense.payers.reduce((sum, payer) => sum + moneyToMinor(payer.amount), 0);

if (payerMinor !== totalMinor) {
  throw new Error(`Payers add up to ${minorToMoney(payerMinor)} but the expense is ${minorToMoney(totalMinor)}.`);
}

// Only repair the known stale-split shape: one allocation for the whole amount,
// held by the member who paid. Anything else is left untouched for a human.
const staleShape =
  expense.allocations.length === 1
  && expense.allocations[0].userId === expense.payers[0]?.userId
  && moneyToMinor(expense.allocations[0].allocatedAmount) === totalMinor;

if (!staleShape) {
  throw new Error('This expense does not look like the stale single-member split; refusing to change it.');
}

if (trip.members.length === 0) throw new Error('Trip has no active members.');

const base = Math.floor(totalMinor / trip.members.length);
const remainder = totalMinor - base * trip.members.length;

const shares = trip.members.map((member, index) => ({
  userId: member.userId,
  fullName: member.user.fullName,
  amountMinor: base + (index < remainder ? 1 : 0),
}));

if (!shares.every((share) => share.amountMinor > 0)) {
  throw new Error('Equal split produced a zero share; refusing to change it.');
}

const backupPath = process.env.BACKUP_PATH;
if (!backupPath) throw new Error('BACKUP_PATH is required.');

writeFileSync(
  backupPath,
  JSON.stringify(
    {
      capturedAt: new Date().toISOString(),
      trip: { id: trip.id, name: trip.name, code: trip.joinCode },
      expense: {
        id: expense.id,
        title: expense.title,
        amount: String(expense.amount),
        convertedAmount: String(expense.convertedAmount ?? expense.amount),
        allocations: expense.allocations.map((row) => ({
          id: row.id,
          userId: row.userId,
          allocatedAmount: String(row.allocatedAmount),
        })),
        financialEntries: expense.financialEntries.map((row) => ({
          id: row.id,
          userId: row.userId,
          entryType: row.entryType,
          amount: String(row.amount),
          currency: row.currency,
        })),
      },
      replacementShares: shares,
    },
    null,
    2,
  ),
);

// A batched transaction goes over as one request, which is far more reliable
// against a serverless Postgres endpoint than a long interactive session.
await p.$transaction([
  p.expenseAllocation.deleteMany({ where: { expenseId: expense.id } }),
  p.expenseAllocation.createMany({
    data: shares.map((share) => ({
      id: randomUUID(),
      expenseId: expense.id,
      userId: share.userId,
      allocatedAmount: minorToMoney(share.amountMinor),
      isManual: false,
    })),
  }),
  p.financialEntry.deleteMany({
    where: { expenseId: expense.id, entryType: 'RESPONSIBILITY' },
  }),
  p.financialEntry.createMany({
    data: shares.map((share) => ({
      id: randomUUID(),
      tripId: trip.id,
      expenseId: expense.id,
      userId: share.userId,
      createdByUserId: expense.createdByUserId,
      entryType: 'RESPONSIBILITY',
      amount: `-${minorToMoney(share.amountMinor)}`,
      currency: expense.currency,
    })),
  }),
  p.auditLog.create({
    data: {
      tripId: trip.id,
      userId: null,
      entityType: 'Expense',
      entityId: expense.id,
      action: 'EXPENSE_SPLIT_REPAIRED',
      details: {
        reason: 'Expense was created from a stale member list and was split only to the payer.',
        previousAllocations: 1,
        newShares: shares.map((share) => ({ userId: share.userId, amount: minorToMoney(share.amountMinor) })),
        backupPath,
      },
    },
  }),
]);

const [allocations, responsibility, payerAdvances] = await Promise.all([
  p.expenseAllocation.findMany({ where: { expenseId: expense.id } }),
  p.financialEntry.findMany({ where: { expenseId: expense.id, entryType: 'RESPONSIBILITY' } }),
  p.financialEntry.findMany({ where: { expenseId: expense.id, entryType: 'PAYER_ADVANCE' } }),
]);

const nameOf = new Map(shares.map((share) => [share.userId, share.fullName]));
const allocatedTotal = allocations.reduce((sum, row) => sum + moneyToMinor(row.allocatedAmount), 0);
const responsibilityTotal = responsibility.reduce((sum, row) => sum + moneyToMinor(row.amount), 0);
const advanceTotal = payerAdvances.reduce((sum, row) => sum + moneyToMinor(row.amount), 0);

console.log('Backup written to', backupPath);
console.log('Allocations:', allocations.map((row) => `${nameOf.get(row.userId)}:${String(row.allocatedAmount)}`).join(', '));
console.log('Responsibility:', responsibility.map((row) => `${nameOf.get(row.userId)}:${String(row.amount)}`).join(', '));
console.log('Checks: allocated=', minorToMoney(allocatedTotal), 'responsibility=', minorToMoney(responsibilityTotal), 'advances=', minorToMoney(advanceTotal));

if (allocatedTotal !== totalMinor) throw new Error('Allocation total no longer matches the expense amount.');
if (responsibilityTotal !== -totalMinor) throw new Error('Responsibility total no longer matches the expense amount.');
if (advanceTotal !== totalMinor) throw new Error('Payer advances no longer match the expense amount.');
console.log('Repair verified: expense is balanced.');

await p.$disconnect();
