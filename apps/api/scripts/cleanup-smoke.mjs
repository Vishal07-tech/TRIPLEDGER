import { PrismaClient } from '../tmp/pg-client/index.js';

const url = process.env.PG_TARGET_URL;
if (!url) throw new Error('PG_TARGET_URL required');

const p = new PrismaClient({ datasources: { db: { url } } });

const tripId = process.env.SMOKE_TRIP_ID;
const testEmails = [
  'join.check.1794984947@tripledger.test',
  'cloud.outsider.1794937554@tripledger.test',
];

async function cleanupTrip(tripId) {
  const expenses = await p.expense.findMany({ where: { tripId }, select: { id: true } });
  const expenseIds = expenses.map((row) => row.id);
  const settlements = await p.settlement.findMany({ where: { tripId }, select: { id: true } });
  const settlementIds = settlements.map((row) => row.id);
  const payments = await p.settlementPayment.findMany({
    where: { settlementId: { in: settlementIds } },
    select: { id: true },
  });
  const paymentIds = payments.map((row) => row.id);

  await p.settlementPaymentEvent.deleteMany({ where: { paymentId: { in: paymentIds } } });
  await p.settlementRefund.deleteMany({ where: { paymentId: { in: paymentIds } } });
  await p.settlementPayment.deleteMany({ where: { settlementId: { in: settlementIds } } });
  await p.settlementExpenseReview.deleteMany({ where: { tripId } });
  await p.settlementLedgerEntry.deleteMany({ where: { tripId } });
  await p.settlement.deleteMany({ where: { tripId } });

  await p.expensePayer.deleteMany({ where: { expenseId: { in: expenseIds } } });
  await p.expenseAllocation.deleteMany({ where: { expenseId: { in: expenseIds } } });
  await p.expenseLocation.deleteMany({ where: { expenseId: { in: expenseIds } } });
  await p.expenseReceipt.deleteMany({ where: { expenseId: { in: expenseIds } } });
  await p.expense.deleteMany({ where: { tripId } });

  await p.financialEntry.deleteMany({ where: { tripId } });
  await p.notification.deleteMany({ where: { tripId } });
  await p.auditLog.deleteMany({ where: { tripId } });
  await p.outboxEvent.deleteMany({ where: { tripId } });
  await p.memberBudget.deleteMany({ where: { tripId } });
  await p.tripSetting.deleteMany({ where: { tripId } });
  await p.tripInvitation.deleteMany({ where: { tripId } });
  await p.tripMember.deleteMany({ where: { tripId } });
  await p.trip.delete({ where: { id: tripId } });
  console.log(`removed smoke trip ${tripId}`);
}

async function main() {
  if (tripId) await cleanupTrip(tripId);

  const users = await p.user.findMany({ where: { email: { in: testEmails } }, select: { id: true, email: true } });
  for (const user of users) {
    await p.tripMember.deleteMany({ where: { userId: user.id } });
    await p.notification.deleteMany({ where: { userId: user.id } });
    await p.auditLog.deleteMany({ where: { userId: user.id } });
    await p.financialEntry.deleteMany({ where: { userId: user.id } });
    await p.userPreference.deleteMany({ where: { userId: user.id } });
    await p.user.delete({ where: { id: user.id } });
    console.log(`removed test user ${user.email}`);
  }
  console.log('cleanup complete');
}

main()
  .catch((error) => {
    console.error('cleanup failed:', error.message);
    process.exitCode = 1;
  })
  .finally(() => p.$disconnect());
