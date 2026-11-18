import { afterAll, describe, expect, it } from 'vitest';

import app from '../src/app.js';
import { prisma } from '../src/lib/prisma.js';
import { parseStoredMoneyToMinor } from '../src/services/financialMath.js';
import { processOutboxBatch } from '../src/services/outboxService.js';

type TestUser = { id: string; token: string };

const paymentMetadata = {
  paymentMethod: 'UPI',
  paymentDateTime: '2026-11-09T12:00:00.000Z',
  paymentNotes: 'Recorded manually by the debtor.',
};

async function postJson(baseUrl: string, path: string, body: unknown, token?: string) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  return { response, payload: await response.json() };
}

async function getJson(baseUrl: string, path: string, token: string) {
  const response = await fetch(`${baseUrl}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return { response, payload: await response.json() };
}

async function assertSettlementLedgerReconciles(tripId: string) {
  const entries = await prisma.settlementLedgerEntry.findMany({
    where: { tripId },
    select: { paymentId: true, userId: true, amount: true, currency: true },
  });
  const byMember = new Map<string, bigint>();
  const byPayment = new Map<string, bigint>();
  for (const entry of entries) {
    const amount = parseStoredMoneyToMinor(String(entry.amount), entry.currency);
    byMember.set(entry.userId, (byMember.get(entry.userId) ?? 0n) + amount);
    byPayment.set(entry.paymentId, (byPayment.get(entry.paymentId) ?? 0n) + amount);
  }
  expect([...byMember.values()].reduce((sum, amount) => sum + amount, 0n)).toBe(0n);
  expect([...byPayment.values()].every((amount) => amount === 0n)).toBe(true);
  return byMember;
}

describe('MySQL settlement lifecycle', () => {
  it('reviews expenses, reconciles partial two-party payments once, refunds, and reopens into a new revision', async () => {
    const server = app.listen(0);
    const userIds: string[] = [];
    const tripIds: string[] = [];

    try {
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Server did not bind to a TCP port.');
      const baseUrl = `http://127.0.0.1:${address.port}`;
      const prefix = `settlement-e2e-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const users: TestUser[] = [];

      for (const [index, fullName] of ['Settlement owner', 'Settlement member', 'Unrelated trip member'].entries()) {
        const { response, payload } = await postJson(baseUrl, '/api/auth/register', {
          email: `${prefix}-${index}@example.com`,
          password: 'StrongPass!123',
          fullName,
        });
        expect(response.status).toBe(201);
        users.push({ id: payload.user.id as string, token: payload.token as string });
        userIds.push(payload.user.id as string);
      }

      const [owner, member, unrelatedMember] = users;
      const tripResult = await postJson(baseUrl, '/api/trips', {
        name: 'Settlement test trip',
        baseCurrency: 'INR',
      }, owner.token);
      expect(tripResult.response.status).toBe(201);
      const tripId = tripResult.payload.trip.id as string;
      tripIds.push(tripId);
      await prisma.tripMember.create({
        data: { tripId, userId: member.id, role: 'MEMBER' },
      });
      await prisma.tripMember.create({
        data: { tripId, userId: unrelatedMember.id, role: 'MEMBER' },
      });

      const expenseResult = await postJson(baseUrl, `/api/trips/${tripId}/expenses`, {
        title: 'Reviewed test expense',
        amount: '10.01',
        currency: 'INR',
        category: 'Test',
        expenseType: 'PERSONAL',
        splitMethod: 'EQUAL',
        paymentMethod: 'UPI',
        date: new Date().toISOString(),
        responsibleUserId: member.id,
        payers: [{ userId: owner.id, amount: '10.01' }],
      }, owner.token);
      expect(expenseResult.response.status).toBe(201);
      const expenseId = expenseResult.payload.expense.id as string;

      expect((await postJson(baseUrl, `/api/trips/${tripId}/closure-requests`, {}, member.token)).response.status).toBe(201);
      expect((await postJson(baseUrl, `/api/trips/${tripId}/closure/initiate`, {}, member.token)).response.status).toBe(403);
      expect((await postJson(baseUrl, `/api/trips/${tripId}/settlements/generate`, {}, owner.token)).response.status).toBe(400);

      expect((await postJson(baseUrl, `/api/trips/${tripId}/closure/initiate`, {}, owner.token)).response.status).toBe(200);
      expect((await postJson(baseUrl, `/api/trips/${tripId}/closure/review/start`, {}, owner.token)).response.status).toBe(200);

      const blockedPlan = await postJson(baseUrl, `/api/trips/${tripId}/settlements/generate`, {}, owner.token);
      expect(blockedPlan.response.status).toBe(400);
      expect(blockedPlan.payload.message).toMatch(/reviews|disputes/i);

      expect((await postJson(baseUrl, `/api/trips/${tripId}/closure/expenses/${expenseId}/review`, {
        status: 'REVIEWED',
      }, member.token)).response.status).toBe(200);
      expect((await postJson(baseUrl, `/api/trips/${tripId}/closure/expenses/${expenseId}/review`, {
        status: 'REVIEWED',
      }, owner.token)).response.status).toBe(200);

      const planResult = await postJson(baseUrl, `/api/trips/${tripId}/settlements/generate`, {}, owner.token);
      expect(planResult.response.status).toBe(201);
      expect(planResult.payload.settlements).toHaveLength(1);
      expect(planResult.payload.settlements[0].totalAmount).toBe('10.01');
      const settlementId = planResult.payload.settlements[0].id as string;
      const outsiderResult = await postJson(baseUrl, '/api/trips/not-a-member/settlements/generate', {}, owner.token);
      expect(outsiderResult.response.status).toBe(403);

      const competingAttempts = await Promise.all([
        postJson(baseUrl, `/api/trips/${tripId}/settlements/${settlementId}/payments`, {
          ...paymentMetadata,
          amount: '6.00',
          idempotencyKey: `${prefix}-reserved-a`,
        }, member.token),
        postJson(baseUrl, `/api/trips/${tripId}/settlements/${settlementId}/payments`, {
          ...paymentMetadata,
          amount: '5.00',
          transactionReference: 'reserved-ref-b',
          idempotencyKey: `${prefix}-reserved-b`,
        }, member.token),
      ]);
      expect(competingAttempts.map(({ response }) => response.status).sort()).toEqual([201, 400]);
      const reservedAttempt = competingAttempts.find(({ response }) => response.status === 201)!;
      const reservedReference = competingAttempts.indexOf(reservedAttempt) === 0 ? null : 'reserved-ref-b';
      const reservedPaymentId = reservedAttempt.payload.payment.id as string;
      expect(reservedAttempt.payload.settlement).toEqual({
        id: settlementId,
        debtorUserId: member.id,
        creditorUserId: owner.id,
      });
      expect(reservedAttempt.payload.payment).toMatchObject({
        transactionReference: reservedReference,
        paymentMethod: 'UPI',
        paymentNotes: paymentMetadata.paymentNotes,
      });
      expect(reservedAttempt.payload.payment.paymentDateTime).toBe(paymentMetadata.paymentDateTime);
      const paymentSubmittedEvent = await prisma.outboxEvent.findUniqueOrThrow({
        where: { eventKey: `settlement-payment:${reservedPaymentId}:submitted` },
      });
      expect(paymentSubmittedEvent).toMatchObject({
        tripId,
        eventType: 'SETTLEMENT_PAYMENT_SUBMITTED',
        payload: {
          entityType: 'SettlementPayment',
          entityId: reservedPaymentId,
          actorUserId: member.id,
        },
      });
      expect(Object.keys(paymentSubmittedEvent.payload as object).sort()).toEqual([
        'actorUserId',
        'entityId',
        'entityType',
      ]);
      const creditorOverview = await getJson(baseUrl, `/api/trips/${tripId}/settlements`, owner.token);
      const submittedNotification = creditorOverview.payload.paymentNotifications.find(
        (notification: { metadata: { paymentId: string } }) =>
          notification.metadata.paymentId === reservedPaymentId,
      );
      expect(submittedNotification).toMatchObject({
        title: 'Manual payment recorded',
        metadata: { paymentId: reservedPaymentId, settlementId, debtorUserId: member.id },
      });
      const debtorOverview = await getJson(baseUrl, `/api/trips/${tripId}/settlements`, member.token);
      expect(debtorOverview.payload.paymentNotifications).not.toContainEqual(submittedNotification);
      expect((await getJson(baseUrl, `/api/trips/${tripId}/settlements`, owner.token))
        .payload.settlements[0].remainingAmount).toBe('10.01');
      const reservationRelease = await postJson(baseUrl, `/api/trips/${tripId}/settlements/payments/${reservedPaymentId}/status`, {
        status: 'FAILED',
        idempotencyKey: `${prefix}-reserved-release`,
      }, member.token);
      expect(reservationRelease.response.status).toBe(200);
      expect(await prisma.settlementPayment.count({
        where: { settlementId, status: 'INITIATED' },
      })).toBe(0);

      const failedAttempt = await postJson(baseUrl, `/api/trips/${tripId}/settlements/${settlementId}/payments`, {
        ...paymentMetadata,
        amount: '4.00',
        transactionReference: 'ref-failed',
        idempotencyKey: `${prefix}-failed-payment`,
      }, member.token);
      expect(failedAttempt.response.status).toBe(201);
      const failedPaymentId = failedAttempt.payload.payment.id as string;
      const failed = await postJson(baseUrl, `/api/trips/${tripId}/settlements/payments/${failedPaymentId}/status`, {
        status: 'FAILED',
        idempotencyKey: `${prefix}-failed-status`,
      }, member.token);
      expect(failed.response.status).toBe(200);
      expect((await getJson(baseUrl, `/api/trips/${tripId}/settlements`, owner.token))
        .payload.settlements[0].remainingAmount).toBe('10.01');
      for (const [status, suffix, amount] of [
        ['EXPIRED', 'expired', '1.00'],
        ['DECLINED', 'declined', '0.50'],
      ] as const) {
        const attempt = await postJson(baseUrl, `/api/trips/${tripId}/settlements/${settlementId}/payments`, {
          ...paymentMetadata,
          amount,
          transactionReference: `ref-${suffix}`,
          idempotencyKey: `${prefix}-${suffix}-payment`,
        }, member.token);
        const attemptId = attempt.payload.payment.id as string;
        expect(attempt.response.status).toBe(201);
        expect((await postJson(baseUrl, `/api/trips/${tripId}/settlements/payments/${attemptId}/status`, {
          status,
          idempotencyKey: `${prefix}-${suffix}-status`,
        }, member.token)).response.status).toBe(200);
      }
      expect((await getJson(baseUrl, `/api/trips/${tripId}/settlements`, owner.token))
        .payload.settlements[0].remainingAmount).toBe('10.01');

      const firstAttemptBody = {
        ...paymentMetadata,
        amount: '4.00',
        idempotencyKey: `${prefix}-partial-one`,
        debtorUserId: owner.id,
        creditorUserId: member.id,
      };
      const firstAttempt = await postJson(baseUrl, `/api/trips/${tripId}/settlements/${settlementId}/payments`, firstAttemptBody, member.token);
      const duplicateAttempt = await postJson(baseUrl, `/api/trips/${tripId}/settlements/${settlementId}/payments`, firstAttemptBody, member.token);
      expect(firstAttempt.response.status).toBe(201);
      expect(firstAttempt.payload.settlement).toEqual({
        id: settlementId,
        debtorUserId: member.id,
        creditorUserId: owner.id,
      });
      expect(duplicateAttempt.payload.payment.id).toBe(firstAttempt.payload.payment.id);
      let firstPaymentId = firstAttempt.payload.payment.id as string;

      const debtorConfirm = await postJson(baseUrl, `/api/trips/${tripId}/settlements/payments/${firstPaymentId}/confirm`, {
        idempotencyKey: `${prefix}-bad-confirm`,
      }, member.token);
      expect(debtorConfirm.response.status).toBe(400);

      let firstConfirmationKey = `${prefix}-racing-confirmation`;
      const [racingConfirmation, racingFailure] = await Promise.all([
        postJson(baseUrl, `/api/trips/${tripId}/settlements/payments/${firstPaymentId}/confirm`, {
          idempotencyKey: firstConfirmationKey,
        }, owner.token),
        postJson(baseUrl, `/api/trips/${tripId}/settlements/payments/${firstPaymentId}/status`, {
          status: 'FAILED',
          idempotencyKey: `${prefix}-racing-failure`,
        }, owner.token),
      ]);
      expect([racingConfirmation.response.status, racingFailure.response.status].sort()).toEqual([200, 400]);
      let firstPaymentStatus = await prisma.settlementPayment.findUniqueOrThrow({
        where: { id: firstPaymentId }, select: { status: true },
      });
      expect(['SUCCESSFUL', 'FAILED']).toContain(firstPaymentStatus.status);
      let firstPaymentLedgerCount = await prisma.settlementLedgerEntry.count({
        where: { paymentId: firstPaymentId, entryType: { in: ['PAYMENT_DEBTOR', 'PAYMENT_CREDITOR'] } },
      });
      expect(firstPaymentLedgerCount).toBe(firstPaymentStatus.status === 'SUCCESSFUL' ? 2 : 0);
      if (firstPaymentStatus.status === 'FAILED') {
        const replacement = await postJson(baseUrl, `/api/trips/${tripId}/settlements/${settlementId}/payments`, {
          ...paymentMetadata,
          amount: '4.00',
          transactionReference: 'bank-ref-1001-replacement',
          idempotencyKey: `${prefix}-partial-one-replacement`,
        }, member.token);
        expect(replacement.response.status).toBe(201);
        firstPaymentId = replacement.payload.payment.id as string;
        firstConfirmationKey = `${prefix}-confirmation-one-replacement`;
        expect((await postJson(baseUrl, `/api/trips/${tripId}/settlements/payments/${firstPaymentId}/confirm`, {
          idempotencyKey: firstConfirmationKey,
        }, owner.token)).response.status).toBe(200);
        firstPaymentStatus = await prisma.settlementPayment.findUniqueOrThrow({
          where: { id: firstPaymentId }, select: { status: true },
        });
        firstPaymentLedgerCount = await prisma.settlementLedgerEntry.count({
          where: { paymentId: firstPaymentId, entryType: { in: ['PAYMENT_DEBTOR', 'PAYMENT_CREDITOR'] } },
        });
      }
      expect(firstPaymentStatus.status).toBe('SUCCESSFUL');
      expect(firstPaymentLedgerCount).toBe(2);
      expect((await postJson(baseUrl, `/api/trips/${tripId}/settlements/payments/${firstPaymentId}/confirm`, {
        idempotencyKey: firstConfirmationKey,
      }, member.token)).response.status).toBe(400);
      expect(await prisma.settlementLedgerEntry.count({
        where: { paymentId: firstPaymentId, entryType: { in: ['PAYMENT_DEBTOR', 'PAYMENT_CREDITOR'] } },
      })).toBe(2);
      for (const [status, suffix] of [
        ['FAILED', 'after-success-failed'],
        ['EXPIRED', 'after-success-expired'],
        ['DECLINED', 'after-success-declined'],
      ] as const) {
        expect((await postJson(baseUrl, `/api/trips/${tripId}/settlements/payments/${firstPaymentId}/status`, {
          status,
          idempotencyKey: `${prefix}-${suffix}`,
        }, owner.token)).response.status).toBe(400);
        expect((await prisma.settlementPayment.findUniqueOrThrow({
          where: { id: firstPaymentId }, select: { status: true },
        })).status).toBe('SUCCESSFUL');
      }
      const confirmed = await getJson(baseUrl, `/api/trips/${tripId}/settlements`, owner.token);
      expect(confirmed.payload.settlements[0].confirmedPaidAmount).toBe('4.00');
      expect(confirmed.payload.settlements[0].remainingAmount).toBe('6.01');
      const balancesAfterFirstPayment = confirmed.payload.balances as Array<{ balanceMinor: string }>;
      expect(balancesAfterFirstPayment.reduce((sum, balance) => sum + BigInt(balance.balanceMinor), 0n)).toBe(0n);
      expect(balancesAfterFirstPayment.map(({ balanceMinor }) => balanceMinor).sort()).toEqual(['-601', '0', '601']);
      expect(await assertSettlementLedgerReconciles(tripId)).toEqual(new Map([
        [owner.id, -400n],
        [member.id, 400n],
      ]));

      const secondAttempt = await postJson(baseUrl, `/api/trips/${tripId}/settlements/${settlementId}/payments`, {
        ...paymentMetadata,
        amount: '6.01',
        transactionReference: 'bank-ref-1002',
        idempotencyKey: `${prefix}-partial-two`,
      }, member.token);
      expect(secondAttempt.response.status).toBe(201);
      const secondPaymentId = secondAttempt.payload.payment.id as string;
      expect((await postJson(baseUrl, `/api/trips/${tripId}/settlements/payments/${secondPaymentId}/confirm`, {
        idempotencyKey: `${prefix}-confirmation-two`,
      }, owner.token)).response.status).toBe(200);
      expect(await prisma.outboxEvent.findUniqueOrThrow({
        where: { eventKey: `settlement-payment:${secondPaymentId}:confirmed` },
      })).toMatchObject({
        tripId,
        eventType: 'SETTLEMENT_PAYMENT_CONFIRMED',
        payload: {
          entityType: 'SettlementPayment',
          entityId: secondPaymentId,
          actorUserId: owner.id,
        },
      });
      await processOutboxBatch(prisma, 50, tripId);
      expect(await prisma.notification.count({
        where: { tripId, userId: member.id, type: 'PAYMENT_CONFIRMED' },
      })).toBe(2);
      expect(await prisma.notification.count({
        where: { tripId, userId: owner.id, type: 'PAYMENT_CONFIRMED' },
      })).toBe(0);

      const paidOverview = await getJson(baseUrl, `/api/trips/${tripId}/settlements`, owner.token);
      expect(paidOverview.payload.tripStatus).toBe('FULLY_SETTLED');
      expect(paidOverview.payload.balances.every((balance: { balance: string }) => balance.balance === '0.00')).toBe(true);
      expect(await assertSettlementLedgerReconciles(tripId)).toEqual(new Map([
        [owner.id, -1001n],
        [member.id, 1001n],
      ]));
      const historicalSettlementIds = (await prisma.settlement.findMany({
        where: { tripId }, select: { id: true },
      })).map(({ id }) => id).sort();
      const historicalPaymentIds = (await prisma.settlementPayment.findMany({
        where: { settlement: { tripId } }, select: { id: true },
      })).map(({ id }) => id).sort();
      const historicalLedgerIds = (await prisma.settlementLedgerEntry.findMany({
        where: { tripId }, select: { id: true },
      })).map(({ id }) => id).sort();
      expect((await postJson(baseUrl, `/api/trips/${tripId}/closure/finalize`, {}, owner.token)).response.status).toBe(200);
      expect((await getJson(baseUrl, `/api/trips/${tripId}`, owner.token)).payload.trip.status).toBe('TRIP_CLOSED');

      expect((await postJson(baseUrl, `/api/trips/${tripId}/closure/reopen`, {
        reason: 'Audit a manually reconciled transfer.',
      }, member.token)).response.status).toBe(403);
      expect((await postJson(baseUrl, `/api/trips/${tripId}/closure/reopen`, {
        reason: 'Audit a manually reconciled transfer.',
      }, owner.token)).response.status).toBe(200);
      expect((await prisma.settlement.findMany({
        where: { tripId, planRevision: 1 }, select: { id: true },
      })).map(({ id }) => id).sort()).toEqual(historicalSettlementIds);
      expect((await prisma.settlementPayment.findMany({
        where: { settlement: { tripId } }, select: { id: true },
      })).map(({ id }) => id).sort()).toEqual(historicalPaymentIds);
      expect((await prisma.settlementLedgerEntry.findMany({
        where: { tripId }, select: { id: true },
      })).map(({ id }) => id).sort()).toEqual(historicalLedgerIds);
      expect(await assertSettlementLedgerReconciles(tripId)).toEqual(new Map([
        [owner.id, -1001n],
        [member.id, 1001n],
      ]));

      const refund = await postJson(baseUrl, `/api/trips/${tripId}/settlements/payments/${firstPaymentId}/refund`, {
        amount: '1.50',
        reason: 'Bank returned the first partial transfer.',
        idempotencyKey: `${prefix}-refund-one`,
      }, owner.token);
      expect(refund.response.status).toBe(200);
      expect((await prisma.settlementPayment.findUniqueOrThrow({ where: { id: firstPaymentId } })).status).toBe('SUCCESSFUL');
      const partialRefund = await prisma.settlementRefund.findFirstOrThrow({ where: { paymentId: firstPaymentId } });
      expect((await prisma.settlementLedgerEntry.aggregate({
        where: { paymentId: firstPaymentId, refundId: partialRefund.id, entryType: { startsWith: 'REFUND_PAYMENT_DEBTOR_' } },
        _sum: { amount: true },
      }))._sum.amount?.toFixed(2)).toBe('-1.50');
      expect(await assertSettlementLedgerReconciles(tripId)).toEqual(new Map([
        [owner.id, -851n],
        [member.id, 851n],
      ]));
      const afterPartialRefund = await getJson(baseUrl, `/api/trips/${tripId}/settlements`, owner.token);
      expect(afterPartialRefund.payload.balances
        .map((balance: { balanceMinor: string }) => balance.balanceMinor).sort()).toEqual(['-150', '0', '150']);
      const overRefund = await postJson(baseUrl, `/api/trips/${tripId}/settlements/payments/${firstPaymentId}/refund`, {
        amount: '2.51',
        reason: 'Attempt to refund more than the remaining transfer.',
        idempotencyKey: `${prefix}-refund-over`,
      }, owner.token);
      expect(overRefund.response.status).toBe(400);
      const repeatedRefund = await postJson(baseUrl, `/api/trips/${tripId}/settlements/payments/${firstPaymentId}/refund`, {
        amount: '1.50',
        reason: 'Retry the same refund request.',
        idempotencyKey: `${prefix}-refund-one`,
      }, owner.token);
      expect(repeatedRefund.response.status).toBe(200);
      const finalRefund = await postJson(baseUrl, `/api/trips/${tripId}/settlements/payments/${firstPaymentId}/refund`, {
        amount: '2.50',
        reason: 'Return the remaining transfer amount.',
        idempotencyKey: `${prefix}-refund-two`,
      }, owner.token);
      expect(finalRefund.response.status).toBe(200);
      expect((await prisma.settlementPayment.findUniqueOrThrow({ where: { id: firstPaymentId } })).status).toBe('REFUNDED');
      expect(await prisma.settlementLedgerEntry.count({
        where: { paymentId: firstPaymentId, entryType: { startsWith: 'REFUND_' } },
      })).toBe(4);
      expect(await prisma.settlementRefund.count({ where: { paymentId: firstPaymentId } })).toBe(2);
      expect((await prisma.settlementRefund.aggregate({
        where: { paymentId: firstPaymentId },
        _sum: { amount: true },
      }))._sum.amount?.toFixed(2)).toBe('4.00');
      expect(await assertSettlementLedgerReconciles(tripId)).toEqual(new Map([
        [owner.id, -601n],
        [member.id, 601n],
      ]));
      expect((await getJson(baseUrl, `/api/trips/${tripId}/settlements`, owner.token)).payload.balances
        .map((balance: { balanceMinor: string }) => balance.balanceMinor).sort()).toEqual(['-400', '0', '400']);

      const secondRefund = await postJson(baseUrl, `/api/trips/${tripId}/settlements/payments/${secondPaymentId}/refund`, {
        amount: '1.00',
        reason: 'One unit of the second transfer was returned.',
        idempotencyKey: `${prefix}-refund-second`,
      }, owner.token);
      expect(secondRefund.response.status).toBe(200);
      const debtorDispute = await postJson(baseUrl, `/api/trips/${tripId}/settlements/payments/${secondPaymentId}/dispute`, {
        reason: 'Debtor cannot dispute their own payment.',
        idempotencyKey: `${prefix}-debtor-payment-dispute`,
      }, member.token);
      expect(debtorDispute.response.status).toBe(400);
      const unrelatedDispute = await postJson(baseUrl, `/api/trips/${tripId}/settlements/payments/${secondPaymentId}/dispute`, {
        reason: 'Unrelated trip member cannot dispute.',
        idempotencyKey: `${prefix}-unrelated-payment-dispute`,
      }, unrelatedMember.token);
      expect(unrelatedDispute.response.status).toBe(400);
      expect((await prisma.settlementPayment.findUniqueOrThrow({
        where: { id: secondPaymentId }, select: { status: true },
      })).status).toBe('SUCCESSFUL');
      expect((await getJson(baseUrl, `/api/trips/${tripId}/settlements`, owner.token)).payload.balances
        .map((balance: { balanceMinor: string }) => balance.balanceMinor).sort()).toEqual(['-500', '0', '500']);
      const dispute = await postJson(baseUrl, `/api/trips/${tripId}/settlements/payments/${secondPaymentId}/dispute`, {
        reason: 'Creditor disputes the second transfer record.',
        idempotencyKey: `${prefix}-payment-dispute`,
      }, owner.token);
      expect(dispute.response.status).toBe(200);
      const unauthorizedDisputeRetry = await postJson(baseUrl, `/api/trips/${tripId}/settlements/payments/${secondPaymentId}/dispute`, {
        reason: 'Debtor cannot replay the creditor dispute.',
        idempotencyKey: `${prefix}-payment-dispute`,
      }, member.token);
      expect(unauthorizedDisputeRetry.response.status).toBe(400);
      const duplicateDispute = await postJson(baseUrl, `/api/trips/${tripId}/settlements/payments/${secondPaymentId}/dispute`, {
        reason: 'Creditor disputes the second transfer record.',
        idempotencyKey: `${prefix}-payment-dispute`,
      }, owner.token);
      expect(duplicateDispute.response.status).toBe(200);
      expect(await prisma.settlementPaymentEvent.count({
        where: { paymentId: secondPaymentId, idempotencyKey: `dispute:${prefix}-payment-dispute` },
      })).toBe(1);
      expect((await prisma.settlementPayment.findUniqueOrThrow({
        where: { id: secondPaymentId }, select: { status: true },
      })).status).toBe('DISPUTED');
      expect((await getJson(baseUrl, `/api/trips/${tripId}/settlements`, owner.token)).payload.balances
        .map((balance: { balanceMinor: string }) => balance.balanceMinor).sort()).toEqual(['-1001', '0', '1001']);
      expect(await assertSettlementLedgerReconciles(tripId)).toEqual(new Map([
        [owner.id, 0n],
        [member.id, 0n],
      ]));
      const disputeAudit = await prisma.auditLog.findFirst({
        where: { tripId, entityId: secondPaymentId, action: 'SETTLEMENT_PAYMENT_DISPUTED' },
      });
      expect(disputeAudit?.userId).toBe(owner.id);
      expect(disputeAudit?.details).toMatchObject({
        reason: 'Creditor disputes the second transfer record.',
        previousStatus: 'SUCCESSFUL',
      });
      expect(disputeAudit?.createdAt).toBeInstanceOf(Date);
      const unauthorizedOverride = await postJson(baseUrl, `/api/trips/${tripId}/settlements/payments/${secondPaymentId}/resolve`, {
        status: 'SUCCESSFUL',
        reason: 'Member must not resolve disputes.',
        idempotencyKey: `${prefix}-unauthorized-override`,
      }, member.token);
      expect(unauthorizedOverride.response.status).toBe(403);
      const unrelatedOverride = await postJson(baseUrl, `/api/trips/${tripId}/settlements/payments/${secondPaymentId}/resolve`, {
        status: 'SUCCESSFUL',
        reason: 'Unrelated trip member must not resolve disputes.',
        idempotencyKey: `${prefix}-unrelated-override`,
      }, unrelatedMember.token);
      expect(unrelatedOverride.response.status).toBe(403);
      const override = await postJson(baseUrl, `/api/trips/${tripId}/settlements/payments/${secondPaymentId}/resolve`, {
        status: 'DECLINED',
        reason: 'Bank reconciliation found no completed transfer.',
        idempotencyKey: `${prefix}-payment-override`,
      }, owner.token);
      expect(override.response.status).toBe(200);
      expect((await prisma.settlementPayment.findUniqueOrThrow({ where: { id: secondPaymentId } })).status).toBe('DECLINED');
      expect(await prisma.settlementLedgerEntry.count({
        where: { paymentId: secondPaymentId, entryType: { startsWith: 'DISPUTE_REVERSAL_' } },
      })).toBe(2);
      const secondPaymentEntries = await prisma.settlementLedgerEntry.aggregate({
        where: { paymentId: secondPaymentId, userId: member.id },
        _sum: { amount: true },
      });
      expect(secondPaymentEntries._sum.amount?.toFixed(2)).toBe('0.00');
      expect(await assertSettlementLedgerReconciles(tripId)).toEqual(new Map([
        [owner.id, 0n],
        [member.id, 0n],
      ]));
      const balancesAfterReversal = await getJson(baseUrl, `/api/trips/${tripId}/settlements`, owner.token);
      expect(balancesAfterReversal.payload.balances
        .map((balance: { balanceMinor: string }) => balance.balanceMinor).sort()).toEqual(['-1001', '0', '1001']);
      const overrideAudit = await prisma.auditLog.findFirst({
        where: { tripId, entityId: secondPaymentId, action: 'SETTLEMENT_PAYMENT_DISPUTE_RESOLVED' },
      });
      expect(overrideAudit?.details).toMatchObject({
        status: 'DECLINED',
        reason: 'Bank reconciliation found no completed transfer.',
      });

      const reopenedTrip = await getJson(baseUrl, `/api/trips/${tripId}`, owner.token);
      expect(reopenedTrip.payload.trip.status).toBe('ACTIVE');
      expect((await prisma.trip.findUniqueOrThrow({ where: { id: tripId } })).settlementRevision).toBe(2);
      const reopenAudit = await prisma.auditLog.findFirst({
        where: { tripId, action: 'TRIP_REOPENED', userId: owner.id },
      });
      expect(reopenAudit?.action).toBe('TRIP_REOPENED');
      expect(reopenAudit?.userId).toBe(owner.id);
      expect(reopenAudit?.details).toMatchObject({ previousPlanRevision: 1, nextPlanRevision: 2 });
      const historicalReport = await getJson(baseUrl, `/api/trips/${tripId}/reports?type=settlements`, owner.token);
      expect(historicalReport.response.status).toBe(200);
      expect(historicalReport.payload.settlements.history.some(
        (settlement: { planRevision: number; id: string }) =>
          settlement.planRevision === 1 && historicalSettlementIds.includes(settlement.id),
      )).toBe(true);
      expect(historicalReport.payload.settlements.history.some(
        (settlement: { payments: Array<{ events: Array<{ action: string }> }> }) =>
          settlement.payments.some((payment) =>
            payment.events.some((event) => event.action === 'PAYMENT_REFUNDED'),
          ),
      )).toBe(true);
      expect(historicalReport.payload.settlements.planRevision).toBe(2);
      expect(historicalReport.payload.settlements.totalOutstanding).toBe('0.00');
      expect(historicalReport.payload.auditHistory.some(
        (entry: { action: string; actorName: string }) =>
          entry.action === 'TRIP_REOPENED' && entry.actorName === 'Settlement owner',
      )).toBe(true);
      const history = await prisma.settlementPaymentEvent.findMany({
        where: { paymentId: firstPaymentId },
        orderBy: { createdAt: 'asc' },
      });
      expect(history.map((event) => event.action)).toContain('PAYMENT_REFUNDED');

      expect((await postJson(baseUrl, `/api/trips/${tripId}/closure/initiate`, {}, owner.token)).response.status).toBe(200);
      expect((await postJson(baseUrl, `/api/trips/${tripId}/closure/review/start`, {}, owner.token)).response.status).toBe(200);
      expect((await postJson(baseUrl, `/api/trips/${tripId}/closure/expenses/${expenseId}/review`, {
        status: 'REVIEWED',
      }, member.token)).response.status).toBe(200);
      expect((await postJson(baseUrl, `/api/trips/${tripId}/closure/expenses/${expenseId}/review`, {
        status: 'REVIEWED',
      }, owner.token)).response.status).toBe(200);
      const revisionTwoPlan = await postJson(baseUrl, `/api/trips/${tripId}/settlements/generate`, {}, owner.token);
      expect(revisionTwoPlan.response.status).toBe(201);
      expect(revisionTwoPlan.payload.settlements).toHaveLength(1);
      expect(revisionTwoPlan.payload.settlements[0].totalAmount).toBe('10.01');
      expect(revisionTwoPlan.payload.settlements[0].planRevision).toBe(2);
      expect((await prisma.settlement.findMany({
        where: { tripId, planRevision: 1 }, select: { id: true },
      })).map(({ id }) => id).sort()).toEqual(historicalSettlementIds);
      expect((await prisma.settlement.findMany({
        where: { tripId, planRevision: 2 }, select: { id: true },
      })).map(({ id }) => id).sort()).toEqual(revisionTwoPlan.payload.settlements.map(
        (settlement: { id: string }) => settlement.id,
      ).sort());
      expect(await assertSettlementLedgerReconciles(tripId)).toEqual(new Map([
        [owner.id, 0n],
        [member.id, 0n],
      ]));
    } finally {
      if (tripIds.length) {
        await prisma.settlementLedgerEntry.deleteMany({ where: { tripId: { in: tripIds } } });
        await prisma.settlementPaymentEvent.deleteMany({
          where: { payment: { settlement: { tripId: { in: tripIds } } } },
        });
        await prisma.settlementRefund.deleteMany({
          where: { payment: { settlement: { tripId: { in: tripIds } } } },
        });
        await prisma.settlementPayment.deleteMany({ where: { settlement: { tripId: { in: tripIds } } } });
        await prisma.settlementExpenseReview.deleteMany({ where: { tripId: { in: tripIds } } });
        await prisma.settlement.deleteMany({ where: { tripId: { in: tripIds } } });
        await prisma.financialEntry.deleteMany({ where: { tripId: { in: tripIds } } });
        await prisma.expense.deleteMany({ where: { tripId: { in: tripIds } } });
        await prisma.trip.deleteMany({ where: { id: { in: tripIds } } });
      }
      if (userIds.length) await prisma.user.deleteMany({ where: { id: { in: userIds } } });
      server.close();
    }
  }, 15_000);

  afterAll(async () => {
    await prisma.$disconnect();
  });
});
