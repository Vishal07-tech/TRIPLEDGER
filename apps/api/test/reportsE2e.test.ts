import { afterAll, describe, expect, it } from 'vitest';

import app from '../src/app.js';
import { prisma } from '../src/lib/prisma.js';

type RegisteredUser = { id: string; token: string; email: string };

function amountToMinor(value: string) {
  const [whole, fraction = ''] = value.split('.');
  return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0').slice(0, 2));
}

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

async function getJson(baseUrl: string, path: string, token?: string) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'GET',
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
  return { response, payload: await response.json() };
}

async function getText(baseUrl: string, path: string, token?: string) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'GET',
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
  return { response, text: await response.text() };
}

describe('MySQL Trip Reports and CSV Exports Integration Tests', () => {
  it('generates all 6 report types, verifies formula-injection defense, partial settlements, refunds, and authorization', async () => {
    const server = app.listen(0);
    const emailPrefix = `reports-e2e-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const users: RegisteredUser[] = [];
    let tripId: string | undefined;
    let trip2Id: string | undefined;

    try {
      const address = server.address();
      if (!address || typeof address === 'string') {
        throw new Error('Server did not bind to a TCP port.');
      }
      const baseUrl = `http://127.0.0.1:${address.port}`;

      for (const [index, label] of ['Report Owner', 'Report Alice', 'Report Bob', 'Report Outsider'].entries()) {
        const { response, payload } = await postJson(baseUrl, '/api/auth/register', {
          email: `${emailPrefix}-${index}@example.com`,
          password: 'StrongPass!123',
          fullName: label,
        });
        expect(response.status).toBe(201);
        users.push({ id: payload.user.id, token: payload.token, email: payload.user.email });
      }

      const [owner, alice, bob, outsider] = users;

      // 1. Create Trip 1 (INR)
      const tripRes = await postJson(
        baseUrl,
        '/api/trips',
        { name: 'Reports Test Trip', baseCurrency: 'INR' },
        owner.token,
      );
      expect(tripRes.response.status).toBe(201);
      tripId = tripRes.payload.trip.id;

      // Add Alice and Bob as members
      await prisma.tripMember.createMany({
        data: [alice, bob].map((member) => ({
          tripId: tripId!,
          userId: member.id,
          role: 'MEMBER' as const,
        })),
      });

      // Set member budgets
      for (const member of [
        { u: owner, budget: '12000.00' },
        { u: alice, budget: '6000.00' },
        { u: bob, budget: '6000.00' },
      ]) {
        await postJson(
          baseUrl,
          `/api/trips/${tripId}/budgets`,
          { userId: member.u.id, plannedBudget: member.budget },
          owner.token,
        );
      }

      // Create Trip 2 for cross-trip isolation testing
      const trip2Res = await postJson(
        baseUrl,
        '/api/trips',
        { name: 'Outsider Private Trip', baseCurrency: 'USD' },
        outsider.token,
      );
      trip2Id = trip2Res.payload.trip.id;

      // 2. Add an expense with formula injection characters in title and description:
      // `=1+1 Dinner` and description `@SUM(A1:A10)`
      const formulaExpenseRes = await postJson(
        baseUrl,
        `/api/trips/${tripId}/expenses`,
        {
          title: '=1+1 Dinner with Suspicious Formula',
          description: '@SUM(A1:A10) malicious formula attempt',
          amount: '2400.00',
          currency: 'INR',
          category: 'Food & Dining',
          expenseType: 'GROUP',
          splitMethod: 'EQUAL',
          paymentMethod: 'UPI',
          date: '2026-11-02T19:00:00.000Z',
          payers: [{ userId: owner.id, amount: '2400.00' }],
          splits: [{ userId: owner.id }, { userId: alice.id }, { userId: bob.id }],
        },
        owner.token,
      );
      expect(formulaExpenseRes.response.status).toBe(201);

      // 3. Add a personal expense for Alice paid by Bob
      const personalExpenseRes = await postJson(
        baseUrl,
        `/api/trips/${tripId}/expenses`,
        {
          title: 'Alice Personal Spa',
          amount: '800.00',
          currency: 'INR',
          category: 'Personal Care',
          expenseType: 'PERSONAL',
          splitMethod: 'EXACT',
          paymentMethod: 'UPI',
          date: '2026-11-08T15:00:00.000Z',
          responsibleUserId: alice.id,
          payers: [{ userId: bob.id, amount: '800.00' }],
        },
        bob.token,
      );
      expect(personalExpenseRes.response.status).toBe(201);

      // 4. Add an expense to be reversed
      const toReverseRes = await postJson(
        baseUrl,
        `/api/trips/${tripId}/expenses`,
        {
          title: 'Cancelled Kayaking',
          amount: '1500.00',
          currency: 'INR',
          category: 'Activities',
          expenseType: 'GROUP',
          splitMethod: 'EQUAL',
          paymentMethod: 'UPI',
          date: '2026-11-12T10:00:00.000Z',
          payers: [{ userId: alice.id, amount: '1500.00' }],
          splits: [{ userId: owner.id }, { userId: alice.id }, { userId: bob.id }],
        },
        alice.token,
      );
      expect(toReverseRes.response.status).toBe(201);
      const toReverseId = toReverseRes.payload.expense.id;

      await postJson(
        baseUrl,
        `/api/trips/${tripId}/expenses/${toReverseId}/reversal`,
        { reason: 'Weather hazard cancellation' },
        alice.token,
      );

      // 5. Add an expense to be corrected
      const toCorrectRes = await postJson(
        baseUrl,
        `/api/trips/${tripId}/expenses`,
        {
          title: 'Taxi to Beach',
          amount: '400.00',
          currency: 'INR',
          category: 'Transportation',
          expenseType: 'GROUP',
          splitMethod: 'EQUAL',
          paymentMethod: 'CASH',
          date: '2026-11-14T11:00:00.000Z',
          payers: [{ userId: owner.id, amount: '400.00' }],
          splits: [{ userId: owner.id }, { userId: bob.id }],
        },
        owner.token,
      );
      // Wait, CASH expense requires cash manager: assign cash manager
      if (toCorrectRes.response.status !== 201) {
        await postJson(
          baseUrl,
          `/api/trips/${tripId}/cash-manager`,
          { cashManagerUserId: owner.id },
          owner.token,
        );
      }

      // Add group expense in Transportation with UPI
      const taxiRes = await postJson(
        baseUrl,
        `/api/trips/${tripId}/expenses`,
        {
          title: 'Taxi to Resort',
          amount: '600.00',
          currency: 'INR',
          category: 'Transportation',
          expenseType: 'GROUP',
          splitMethod: 'EQUAL',
          paymentMethod: 'UPI',
          date: '2026-11-14T11:00:00.000Z',
          payers: [{ userId: owner.id, amount: '600.00' }],
          splits: [{ userId: owner.id }, { userId: bob.id }],
        },
        owner.token,
      );
      expect(taxiRes.response.status).toBe(201);

      // Correct it to 900.00 INR
      const correctedRes = await postJson(
        baseUrl,
        `/api/trips/${tripId}/expenses/${taxiRes.payload.expense.id}/corrections`,
        {
          reason: 'Toll fees added',
          replacement: {
            title: 'Taxi to Resort (with Tolls)',
            amount: '900.00',
            currency: 'INR',
            category: 'Transportation',
            expenseType: 'GROUP',
            splitMethod: 'EQUAL',
            paymentMethod: 'UPI',
            date: '2026-11-14T11:00:00.000Z',
            payers: [{ userId: owner.id, amount: '900.00' }],
            splits: [{ userId: owner.id }, { userId: bob.id }],
          },
        },
        owner.token,
      );
      expect(correctedRes.response.status).toBe(201);

      // 6. Test Settlements: Generate plan and make partial payment & refund
      await postJson(baseUrl, `/api/trips/${tripId}/closure/initiate`, {}, owner.token);
      await postJson(baseUrl, `/api/trips/${tripId}/closure/review/start`, {}, owner.token);

      const reviewsRes = await getJson(baseUrl, `/api/trips/${tripId}/closure/reviews`, owner.token);
      for (const exp of reviewsRes.payload.expenses) {
        for (const review of exp.reviews) {
          const t = review.userId === owner.id ? owner.token : review.userId === alice.id ? alice.token : bob.token;
          await postJson(
            baseUrl,
            `/api/trips/${tripId}/closure/expenses/${exp.id}/review`,
            { status: 'REVIEWED' },
            t,
          );
        }
      }

      const planRes = await postJson(baseUrl, `/api/trips/${tripId}/settlements/generate`, {}, owner.token);
      expect(planRes.response.status).toBe(201);
      const settlements = planRes.payload.settlements;

      // Find a settlement transfer to pay partially
      if (settlements.length > 0) {
        const transfer = settlements[0];
        const debtorToken = transfer.debtorUserId === owner.id ? owner.token : transfer.debtorUserId === alice.id ? alice.token : bob.token;
        const creditorToken = transfer.creditorUserId === owner.id ? owner.token : transfer.creditorUserId === alice.id ? alice.token : bob.token;

        const payRes = await postJson(
          baseUrl,
          `/api/trips/${tripId}/settlements/${transfer.id}/payments`,
          {
            amount: '100.00',
            paymentMethod: 'UPI',
            paymentDateTime: '2026-11-20T10:00:00.000Z',
            idempotencyKey: `pay-test-${Date.now()}`,
          },
          debtorToken,
        );
        expect(payRes.response.status).toBe(201);
        const paymentId = payRes.payload.payment.id;

        // Creditor confirms payment
        await postJson(
          baseUrl,
          `/api/trips/${tripId}/settlements/payments/${paymentId}/confirm`,
          { idempotencyKey: `confirm-test-${Date.now()}` },
          creditorToken,
        );

        // Refund 25.00
        await postJson(
          baseUrl,
          `/api/trips/${tripId}/settlements/payments/${paymentId}/refund`,
          {
            amount: '25.00',
            reason: 'Excess advance returned',
            idempotencyKey: `refund-test-${Date.now()}`,
          },
          owner.token,
        );
      }

      // ======================================================================
      // 7. Verify JSON Reports: All 6 Report Types
      // ======================================================================

      // Report 1: Complete Trip Financial Report
      const completeRep = await getJson(baseUrl, `/api/trips/${tripId}/reports?type=complete`, owner.token);
      expect(completeRep.response.status).toBe(200);
      expect(completeRep.payload.meta.reportType).toBe('complete');
      expect(completeRep.payload.meta.tripName).toBe('Reports Test Trip');
      expect(completeRep.payload.spendingSummary.totalSpending).toBe('4500.00'); // 2400 (dinner) + 800 (spa) + 400 (beach taxi) + 900 (resort taxi)
      expect(completeRep.payload.spendingSummary.groupSpending).toBe('3700.00'); // 2400 + 400 + 900
      expect(completeRep.payload.spendingSummary.personalSpending).toBe('800.00');
      expect(completeRep.payload.spendingSummary.correctedExpenseCount).toBe(1);
      expect(completeRep.payload.spendingSummary.reversedExpenseCount).toBe(1);
      expect(completeRep.payload.categories.length).toBeGreaterThanOrEqual(3);
      expect(completeRep.payload.members.length).toBe(3);
      expect(completeRep.payload.expenses.length).toBeGreaterThanOrEqual(4);
      expect(completeRep.payload.members.reduce(
        (sum: bigint, member: { payerContribution: string }) => sum + amountToMinor(member.payerContribution),
        0n,
      )).toBe(amountToMinor(completeRep.payload.spendingSummary.totalSpending));
      expect(completeRep.payload.members.reduce(
        (sum: bigint, member: { financialResponsibility: string }) => sum + amountToMinor(member.financialResponsibility),
        0n,
      )).toBe(amountToMinor(completeRep.payload.spendingSummary.totalSpending));
      expect(completeRep.payload.members.reduce(
        (sum: bigint, member: { netBalance: string }) => sum + amountToMinor(member.netBalance),
        0n,
      )).toBe(0n);
      expect(completeRep.payload.members.reduce(
        (sum: bigint, member: { settlementBalance: string }) => sum + amountToMinor(member.settlementBalance),
        0n,
      )).toBe(0n);

      // Report 2: Expense History Report
      const expenseRep = await getJson(baseUrl, `/api/trips/${tripId}/reports?type=expenses`, alice.token);
      expect(expenseRep.response.status).toBe(200);
      expect(expenseRep.payload.meta.reportType).toBe('expenses');
      expect(expenseRep.payload.expenses.some((e: any) => e.status === 'REVERSED')).toBe(true);
      expect(expenseRep.payload.expenses.some((e: any) => e.status === 'CORRECTED')).toBe(true);

      // Report 3: Member-wise Financial Report
      const memberRep = await getJson(baseUrl, `/api/trips/${tripId}/reports?type=members`, bob.token);
      expect(memberRep.response.status).toBe(200);
      expect(memberRep.payload.meta.reportType).toBe('members');
      expect(memberRep.payload.members.length).toBe(3);
      for (const m of memberRep.payload.members) {
        expect(m.payerContribution).toBeDefined();
        expect(m.financialResponsibility).toBeDefined();
        expect(m.netBalance).toBeDefined();
      }

      // Report 4: Group vs Personal Report
      const gvspRep = await getJson(baseUrl, `/api/trips/${tripId}/reports?type=group-vs-personal`, owner.token);
      expect(gvspRep.response.status).toBe(200);
      expect(gvspRep.payload.meta.reportType).toBe('group-vs-personal');
      expect(gvspRep.payload.expenseTypes.group.amount).toBe('3700.00');
      expect(gvspRep.payload.expenseTypes.personal.amount).toBe('800.00');

      // Report 5: Budget Utilization Report
      const budgetRep = await getJson(baseUrl, `/api/trips/${tripId}/reports?type=budgets`, owner.token);
      expect(budgetRep.response.status).toBe(200);
      expect(budgetRep.payload.meta.reportType).toBe('budgets');
      expect(budgetRep.payload.budgets.totalPlannedBudget).toBe('24000.00');

      // Report 6: Settlement and Refund History Report
      const settlementRep = await getJson(baseUrl, `/api/trips/${tripId}/reports?type=settlements`, owner.token);
      expect(settlementRep.response.status).toBe(200);
      expect(settlementRep.payload.meta.reportType).toBe('settlements');
      expect(settlementRep.payload.settlements.totalPaid).toBe('75.00'); // 100 - 25 refund
      expect(settlementRep.payload.settlements.totalRefunded).toBe('25.00');
      expect(settlementRep.payload.settlements.history[0].planRevision).toBe(
        settlementRep.payload.settlements.planRevision,
      );
      const reportPayments = settlementRep.payload.settlements.history.flatMap(
        (settlement: { payments: Array<{ events: Array<{ action: string }>; refunds: Array<unknown> }> }) =>
          settlement.payments,
      );
      expect(reportPayments.some((payment: { events: Array<{ action: string }> }) => payment.events.some(
        (event: { action: string }) => event.action === 'CREDITOR_CONFIRMED_RECEIPT',
      ))).toBe(true);
      expect(reportPayments.flatMap((payment: { refunds: Array<{ amount: string; reason: string }> }) => payment.refunds)[0]).toMatchObject({
        amount: '25.00',
        reason: 'Excess advance returned',
      });

      // ======================================================================
      // 8. Test Date Filtering & Member Filtering in Reports
      // ======================================================================
      // Date filter: Nov 1 to Nov 5 (only the dinner expense: 2400.00)
      const dateFilteredRep = await getJson(
        baseUrl,
        `/api/trips/${tripId}/reports?type=complete&startDate=2026-11-01&endDate=2026-11-05`,
        owner.token,
      );
      expect(dateFilteredRep.response.status).toBe(200);
      expect(dateFilteredRep.payload.spendingSummary.totalSpending).toBe('2400.00');

      // Member filter: only Alice
      const memberFilteredRep = await getJson(
        baseUrl,
        `/api/trips/${tripId}/reports?type=members&memberId=${alice.id}`,
        owner.token,
      );
      expect(memberFilteredRep.response.status).toBe(200);
      expect(memberFilteredRep.payload.members.length).toBe(1);
      expect(memberFilteredRep.payload.members[0].userId).toBe(alice.id);

      // ======================================================================
      // 9. Test CSV Export Downloads & Formula Injection Neutralization
      // ======================================================================

      // CSV for Expense History
      const expenseCsv = await getText(
        baseUrl,
        `/api/trips/${tripId}/reports/export?type=expenses`,
        owner.token,
      );
      expect(expenseCsv.response.status).toBe(200);
      expect(expenseCsv.response.headers.get('content-type')).toContain('text/csv');
      expect(expenseCsv.response.headers.get('content-disposition')).toContain('.csv');

      // Formula injection check:
      // The expense title was '=1+1 Dinner with Suspicious Formula'
      // In CSV, it MUST be escaped as "'=1+1 Dinner..." so Excel does not execute it!
      expect(expenseCsv.text).toContain(`"'=1+1 Dinner with Suspicious Formula"`);
      expect(expenseCsv.text).not.toContain(`"=1+1 Dinner with Suspicious Formula"`);

      // And the description was '@SUM(A1:A10)...'
      // In CSV, it MUST be escaped as "'@SUM(A1:A10)..."
      expect(expenseCsv.text).toContain(`"'@SUM(A1:A10) malicious formula attempt"`);
      expect(expenseCsv.text).toContain('Weather hazard cancellation');

      // CSV for Complete Report
      const completeCsv = await getText(baseUrl, `/api/trips/${tripId}/reports/export?type=complete`, owner.token);
      expect(completeCsv.response.status).toBe(200);
      expect(completeCsv.text).toContain('TRIP INFO');
      expect(completeCsv.text).toContain('Reports Test Trip');

      // CSV for Member-wise Report
      const memberCsv = await getText(baseUrl, `/api/trips/${tripId}/reports/export?type=members`, owner.token);
      expect(memberCsv.response.status).toBe(200);
      expect(memberCsv.text).toContain('Member Name');
      expect(memberCsv.text).toContain('Report Alice');

      // CSV for Group vs Personal
      const gvspCsv = await getText(baseUrl, `/api/trips/${tripId}/reports/export?type=group-vs-personal`, owner.token);
      expect(gvspCsv.response.status).toBe(200);
      expect(gvspCsv.text).toContain('TOTAL SUMMARY');

      // CSV for Budgets
      const budgetCsv = await getText(baseUrl, `/api/trips/${tripId}/reports/export?type=budgets`, owner.token);
      expect(budgetCsv.response.status).toBe(200);
      expect(budgetCsv.text).toContain('Planned Budget');

      // CSV for Settlements
      const settlementCsv = await getText(baseUrl, `/api/trips/${tripId}/reports/export?type=settlements`, owner.token);
      expect(settlementCsv.response.status).toBe(200);
      expect(settlementCsv.text).toContain('Confirmed Paid');
      expect(settlementCsv.text).toContain('Payment Status');
      expect(settlementCsv.text).toContain('Excess advance returned');

      // ======================================================================
      // 10. Security: Authorization & Cross-Trip Isolation
      // ======================================================================
      // Outsider cannot access Trip 1 reports (403)
      const outsiderRep = await getJson(baseUrl, `/api/trips/${tripId}/reports`, outsider.token);
      expect(outsiderRep.response.status).toBe(403);

      const outsiderCsv = await getText(baseUrl, `/api/trips/${tripId}/reports/export`, outsider.token);
      expect(outsiderCsv.response.status).toBe(403);

      // Owner cannot access Trip 2 reports (403)
      const ownerTrip2 = await getJson(baseUrl, `/api/trips/${trip2Id}/reports`, owner.token);
      expect(ownerTrip2.response.status).toBe(403);

      // Unauthenticated request receives 401
      const noAuth = await getJson(baseUrl, `/api/trips/${tripId}/reports`);
      expect(noAuth.response.status).toBe(401);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
