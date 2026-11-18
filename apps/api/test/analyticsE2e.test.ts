import { afterAll, describe, expect, it } from 'vitest';

import app from '../src/app.js';
import { prisma } from '../src/lib/prisma.js';

type RegisteredUser = { id: string; token: string; email: string };

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

describe('MySQL Analytics Integration Tests', () => {
  it('covers full financial analytics lifecycle, currency conversion, corrections, reversals, settlements, date filters, and authorization', async () => {
    const server = app.listen(0);
    const emailPrefix = `analytics-e2e-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const users: RegisteredUser[] = [];
    let tripId: string | undefined;
    let trip2Id: string | undefined;

    try {
      const address = server.address();
      if (!address || typeof address === 'string') {
        throw new Error('Server did not bind to a TCP port.');
      }
      const baseUrl = `http://127.0.0.1:${address.port}`;

      for (const [index, label] of ['Owner', 'Alice', 'Bob', 'Outsider'].entries()) {
        const { response, payload } = await postJson(baseUrl, '/api/auth/register', {
          email: `${emailPrefix}-${index}@example.com`,
          password: 'StrongPass!123',
          fullName: label,
        });
        expect(response.status).toBe(201);
        users.push({ id: payload.user.id, token: payload.token, email: payload.user.email });
      }

      const [owner, alice, bob, outsider] = users;

      // 1. Create Trip 1 (base currency INR)
      const tripResult = await postJson(
        baseUrl,
        '/api/trips',
        { name: 'Analytics E2E Trip', baseCurrency: 'INR' },
        owner.token,
      );
      expect(tripResult.response.status).toBe(201);
      tripId = tripResult.payload.trip.id;

      // Add Alice and Bob as members
      await prisma.tripMember.createMany({
        data: [alice, bob].map((member) => ({
          tripId: tripId!,
          userId: member.id,
          role: 'MEMBER' as const,
        })),
      });

      // Set member budgets: Owner: 10000, Alice: 5000, Bob: 5000
      for (const member of [
        { u: owner, budget: '10000.00' },
        { u: alice, budget: '5000.00' },
        { u: bob, budget: '5000.00' },
      ]) {
        const { response } = await postJson(
          baseUrl,
          `/api/trips/${tripId}/budgets`,
          { userId: member.u.id, plannedBudget: member.budget },
          owner.token,
        );
        expect(response.status).toBe(201);
      }

      // Create Trip 2 (for cross-trip isolation)
      const trip2Result = await postJson(
        baseUrl,
        '/api/trips',
        { name: 'Trip 2 Isolated', baseCurrency: 'USD' },
        outsider.token,
      );
      expect(trip2Result.response.status).toBe(201);
      trip2Id = trip2Result.payload.trip.id;

      // 2. Add an expense in EUR with currency conversion: 10.00 EUR at 90.00 = 900.00 INR
      // Split equally between owner and alice (450 each), paid by owner
      const eurExpenseResult = await postJson(
        baseUrl,
        `/api/trips/${tripId}/expenses`,
        {
          title: 'Foreign Train Ticket',
          amount: '10.00',
          currency: 'EUR',
          exchangeRate: '90.00',
          category: 'Transportation',
          expenseType: 'GROUP',
          splitMethod: 'EQUAL',
          paymentMethod: 'UPI',
          date: '2026-11-05T10:00:00.000Z',
          payers: [{ userId: owner.id, amount: '10.00' }],
          splits: [{ userId: owner.id }, { userId: alice.id }],
        },
        owner.token,
      );
      expect(eurExpenseResult.response.status).toBe(201);
      expect(Number(eurExpenseResult.payload.expense.convertedAmount)).toBe(900);

      // 3. Add a group expense in Food & Dining: 3000.00 INR, paid by Alice, split equally between all 3 (1000 each)
      const foodExpenseResult = await postJson(
        baseUrl,
        `/api/trips/${tripId}/expenses`,
        {
          title: 'Group Dinner',
          amount: '3000.00',
          currency: 'INR',
          category: 'Food & Dining',
          expenseType: 'GROUP',
          splitMethod: 'EQUAL',
          paymentMethod: 'UPI',
          date: '2026-11-10T19:00:00.000Z',
          payers: [{ userId: alice.id, amount: '3000.00' }],
          splits: [{ userId: owner.id }, { userId: alice.id }, { userId: bob.id }],
        },
        alice.token,
      );
      expect(foodExpenseResult.response.status).toBe(201);

      // 4. Add a Personal expense: Alice personal shopping 500.00 INR, paid by Bob
      const personalExpenseResult = await postJson(
        baseUrl,
        `/api/trips/${tripId}/expenses`,
        {
          title: 'Alice Souvenir',
          amount: '500.00',
          currency: 'INR',
          category: 'Shopping',
          expenseType: 'PERSONAL',
          splitMethod: 'EXACT',
          paymentMethod: 'UPI',
          date: '2026-11-12T14:00:00.000Z',
          responsibleUserId: alice.id,
          payers: [{ userId: bob.id, amount: '500.00' }],
        },
        bob.token,
      );
      expect(personalExpenseResult.response.status).toBe(201);

      // 5. Add an expense to be reversed: 1200.00 INR in Activities
      const toReverseResult = await postJson(
        baseUrl,
        `/api/trips/${tripId}/expenses`,
        {
          title: 'Museum Entry (Cancelled)',
          amount: '1200.00',
          currency: 'INR',
          category: 'Activities',
          expenseType: 'GROUP',
          splitMethod: 'EQUAL',
          paymentMethod: 'UPI',
          date: '2026-11-15T09:00:00.000Z',
          payers: [{ userId: owner.id, amount: '1200.00' }],
          splits: [{ userId: owner.id }, { userId: alice.id }, { userId: bob.id }],
        },
        owner.token,
      );
      expect(toReverseResult.response.status).toBe(201);
      const toReverseId = toReverseResult.payload.expense.id;

      // Reverse it
      const reverseResult = await postJson(
        baseUrl,
        `/api/trips/${tripId}/expenses/${toReverseId}/reversal`,
        { reason: 'Trip was rained out, fully refunded by museum' },
        owner.token,
      );
      expect(reverseResult.response.status).toBe(200);

      // 6. Add an expense to be corrected: 600.00 INR in Snacks -> Correct to 800.00 INR
      const toCorrectResult = await postJson(
        baseUrl,
        `/api/trips/${tripId}/expenses`,
        {
          title: 'Initial Snacks',
          amount: '600.00',
          currency: 'INR',
          category: 'Food & Dining',
          expenseType: 'GROUP',
          splitMethod: 'EQUAL',
          paymentMethod: 'UPI',
          date: '2026-11-18T16:00:00.000Z',
          payers: [{ userId: bob.id, amount: '600.00' }],
          splits: [{ userId: owner.id }, { userId: bob.id }],
        },
        bob.token,
      );
      expect(toCorrectResult.response.status).toBe(201);
      const toCorrectId = toCorrectResult.payload.expense.id;

      // Correct it to 800.00 INR
      const correctionResult = await postJson(
        baseUrl,
        `/api/trips/${tripId}/expenses/${toCorrectId}/corrections`,
        {
          reason: 'Added extra drinks to the bill',
          replacement: {
            title: 'Corrected Snacks',
            amount: '800.00',
            currency: 'INR',
            category: 'Food & Dining',
            expenseType: 'GROUP',
            splitMethod: 'EQUAL',
            paymentMethod: 'UPI',
            date: '2026-11-18T16:00:00.000Z',
            payers: [{ userId: bob.id, amount: '800.00' }],
            splits: [{ userId: owner.id }, { userId: bob.id }],
          },
        },
        bob.token,
      );
      expect(correctionResult.response.status).toBe(201);

      // 7. Verify analytics report
      // Active expenses should be:
      // - Train: 900.00 (Group, Transportation)
      // - Dinner: 3000.00 (Group, Food & Dining)
      // - Souvenir: 500.00 (Personal, Shopping)
      // - Corrected Snacks: 800.00 (Group, Food & Dining)
      // Total active spending = 900 + 3000 + 500 + 800 = 5200.00 INR
      // Group spending = 900 + 3000 + 800 = 4700.00 INR
      // Personal spending = 500.00 INR
      // Reversed expense (1200) and replaced expense (600) MUST NOT be in the active total!
      const reportRes = await getJson(baseUrl, `/api/trips/${tripId}/analytics`, owner.token);
      expect(reportRes.response.status).toBe(200);
      const report = reportRes.payload;

      expect(report.baseCurrency).toBe('INR');
      expect(report.spendingSummary.totalSpending).toBe('5200.00');
      expect(report.spendingSummary.groupSpending).toBe('4700.00');
      expect(report.spendingSummary.personalSpending).toBe('500.00');
      expect(report.spendingSummary.activeExpenseCount).toBe(4);

      // Payer advances and responsibilities must equal each other
      expect(report.spendingSummary.totalPayerAdvances).toBe('5200.00');
      expect(report.spendingSummary.totalResponsibility).toBe('5200.00');

      // Check categories: Food & Dining (3800.00), Transportation (900.00), Shopping (500.00)
      const foodCat = report.categoryBreakdown.find((c: any) => c.category === 'Food & Dining');
      expect(foodCat).toBeDefined();
      expect(foodCat.amount).toBe('3800.00');
      expect(foodCat.expenseCount).toBe(2);

      const transCat = report.categoryBreakdown.find((c: any) => c.category === 'Transportation');
      expect(transCat).toBeDefined();
      expect(transCat.amount).toBe('900.00');

      const shopCat = report.categoryBreakdown.find((c: any) => c.category === 'Shopping');
      expect(shopCat).toBeDefined();
      expect(shopCat.amount).toBe('500.00');
      expect(shopCat.personalAmount).toBe('500.00');

      // Member breakdown:
      // Owner paid: 900 (train) = 900.00
      // Owner resp: 450 (train) + 1000 (dinner) + 400 (snacks) = 1850.00
      // Owner net: 900 - 1850 = -950.00
      const ownerMember = report.memberBreakdown.find((m: any) => m.userId === owner.id);
      expect(ownerMember.payerContribution).toBe('900.00');
      expect(ownerMember.financialResponsibility).toBe('1850.00');
      expect(ownerMember.netBalance).toBe('-950.00');

      // Alice paid: 3000.00 (dinner)
      // Alice resp: 450 (train) + 1000 (dinner) + 500 (personal souvenir) = 1950.00
      // Alice net: 3000 - 1950 = +1050.00
      // Alice personal: 500.00, group: 1450.00
      const aliceMember = report.memberBreakdown.find((m: any) => m.userId === alice.id);
      expect(aliceMember.payerContribution).toBe('3000.00');
      expect(aliceMember.financialResponsibility).toBe('1950.00');
      expect(aliceMember.personalExpenses).toBe('500.00');
      expect(aliceMember.groupResponsibility).toBe('1450.00');
      expect(aliceMember.netBalance).toBe('1050.00');

      // Bob paid: 500 (souvenir) + 800 (snacks) = 1300.00
      // Bob resp: 1000 (dinner) + 400 (snacks) = 1400.00
      // Bob net: 1300 - 1400 = -100.00
      const bobMember = report.memberBreakdown.find((m: any) => m.userId === bob.id);
      expect(bobMember.payerContribution).toBe('1300.00');
      expect(bobMember.financialResponsibility).toBe('1400.00');
      expect(bobMember.netBalance).toBe('-100.00');

      // Sum of net balances must be exactly 0: -950 + 1050 - 100 = 0
      const netSum =
        Number(ownerMember.netBalance) + Number(aliceMember.netBalance) + Number(bobMember.netBalance);
      expect(netSum).toBe(0);

      // Budget utilization:
      // Total planned: 10000 + 5000 + 5000 = 20000.00
      // Total actual: 5200.00
      // Total remaining: 14800.00
      expect(report.budgetUtilization.totalPlannedBudget).toBe('20000.00');
      expect(report.budgetUtilization.totalActualSpending).toBe('5200.00');
      expect(report.budgetUtilization.totalRemainingBudget).toBe('14800.00');

      // 8. Test Date Range Filtering:
      // Filter for Nov 1 to Nov 7 (only Foreign Train Ticket on Nov 5: 900.00)
      const dateFilteredRes = await getJson(
        baseUrl,
        `/api/trips/${tripId}/analytics?startDate=2026-11-01&endDate=2026-11-07`,
        owner.token,
      );
      expect(dateFilteredRes.response.status).toBe(200);
      expect(dateFilteredRes.payload.spendingSummary.totalSpending).toBe('900.00');
      expect(dateFilteredRes.payload.spendingSummary.activeExpenseCount).toBe(1);
      expect(dateFilteredRes.payload.categoryBreakdown.length).toBe(1);
      expect(dateFilteredRes.payload.categoryBreakdown[0].category).toBe('Transportation');

      // Inverted date range returns 400
      const invalidRangeRes = await getJson(
        baseUrl,
        `/api/trips/${tripId}/analytics?startDate=2026-11-20&endDate=2026-11-10`,
        owner.token,
      );
      expect(invalidRangeRes.response.status).toBe(400);

      // 9. Test Settlement generation and partial payment:
      // Net balances: Owner owes 950, Bob owes 100, Alice receives 1050.
      // Move to EXPENSE_REVIEW
      await postJson(baseUrl, `/api/trips/${tripId}/closure/initiate`, {}, owner.token);
      await postJson(baseUrl, `/api/trips/${tripId}/closure/review/start`, {}, owner.token);

      // Review all expenses as REVIEWED
      const reviewsRes = await getJson(baseUrl, `/api/trips/${tripId}/closure/reviews`, owner.token);
      for (const exp of reviewsRes.payload.expenses) {
        for (const review of exp.reviews) {
          const token = review.userId === owner.id ? owner.token : review.userId === alice.id ? alice.token : bob.token;
          await postJson(
            baseUrl,
            `/api/trips/${tripId}/closure/expenses/${exp.id}/review`,
            { status: 'REVIEWED' },
            token,
          );
        }
      }

      // Generate settlement plan
      const planRes = await postJson(baseUrl, `/api/trips/${tripId}/settlements/generate`, {}, owner.token);
      expect(planRes.response.status).toBe(201);

      // Verify settlement analytics before payment:
      const prePaymentOverview = await getJson(
        baseUrl,
        `/api/trips/${tripId}/analytics/settlements`,
        owner.token,
      );
      expect(prePaymentOverview.response.status).toBe(200);
      expect(prePaymentOverview.payload.settlementOverview.totalPlanned).toBe('1050.00');
      expect(prePaymentOverview.payload.settlementOverview.totalPaid).toBe('0.00');
      expect(prePaymentOverview.payload.settlementOverview.totalOutstanding).toBe('1050.00');

      // Find settlement where Bob pays Alice (100.00)
      const settlements = planRes.payload.settlements;
      const bobSettlement = settlements.find((s: any) => s.debtorUserId === bob.id);
      expect(bobSettlement).toBeDefined();

      // Bob makes a partial payment of 40.00
      const paymentRes = await postJson(
        baseUrl,
        `/api/trips/${tripId}/settlements/${bobSettlement.id}/payments`,
        {
          amount: '40.00',
          paymentMethod: 'UPI',
          paymentDateTime: '2026-11-20T12:00:00.000Z',
          idempotencyKey: `bob-pay-40-${Date.now()}`,
        },
        bob.token,
      );
      expect(paymentRes.response.status).toBe(201);
      const paymentId = paymentRes.payload.payment.id;

      // Alice confirms the 40.00 payment
      await postJson(
        baseUrl,
        `/api/trips/${tripId}/settlements/payments/${paymentId}/confirm`,
        { idempotencyKey: `alice-confirm-${Date.now()}` },
        alice.token,
      );

      // Check settlement analytics: totalPaid = 40.00, totalOutstanding = 1010.00
      const postPaymentAnalytics = await getJson(
        baseUrl,
        `/api/trips/${tripId}/analytics/settlements`,
        owner.token,
      );
      expect(postPaymentAnalytics.payload.settlementOverview.totalPaid).toBe('40.00');
      expect(postPaymentAnalytics.payload.settlementOverview.totalOutstanding).toBe('1010.00');

      // Crucial requirement: Settlement payments must NEVER be counted in trip expenses!
      const expenseReportAfterSettlement = await getJson(
        baseUrl,
        `/api/trips/${tripId}/analytics`,
        owner.token,
      );
      expect(expenseReportAfterSettlement.payload.spendingSummary.totalSpending).toBe('5200.00');

      // Test partial refund: Refund 10.00 of the 40.00 payment
      const refundRes = await postJson(
        baseUrl,
        `/api/trips/${tripId}/settlements/payments/${paymentId}/refund`,
        {
          amount: '10.00',
          reason: 'Partial return of accidental overpayment',
          idempotencyKey: `refund-10-${Date.now()}`,
        },
        owner.token,
      );
      expect(refundRes.response.status).toBe(200);

      // Settlement analytics after refund:
      // Paid should now be 30.00 (40 - 10), outstanding 1020.00, refunded 10.00
      const postRefundAnalytics = await getJson(
        baseUrl,
        `/api/trips/${tripId}/analytics/settlements`,
        owner.token,
      );
      expect(postRefundAnalytics.payload.settlementOverview.totalPaid).toBe('30.00');
      expect(postRefundAnalytics.payload.settlementOverview.totalOutstanding).toBe('1020.00');
      expect(postRefundAnalytics.payload.settlementOverview.totalRefunded).toBe('10.00');

      // 10. Test Sub-endpoints
      const catRes = await getJson(baseUrl, `/api/trips/${tripId}/analytics/categories`, alice.token);
      expect(catRes.response.status).toBe(200);
      expect(catRes.payload.categories.length).toBeGreaterThanOrEqual(3);

      const memRes = await getJson(baseUrl, `/api/trips/${tripId}/analytics/members`, bob.token);
      expect(memRes.response.status).toBe(200);
      expect(memRes.payload.members.length).toBe(3);

      const budRes = await getJson(baseUrl, `/api/trips/${tripId}/analytics/budgets`, owner.token);
      expect(budRes.response.status).toBe(200);
      expect(budRes.payload.budgetUtilization.totalPlannedBudget).toBe('20000.00');

      const trendRes = await getJson(baseUrl, `/api/trips/${tripId}/analytics/trends`, owner.token);
      expect(trendRes.response.status).toBe(200);
      expect(trendRes.payload.trends.daily.length).toBeGreaterThanOrEqual(1);
      expect(trendRes.payload.trends.monthly.length).toBeGreaterThanOrEqual(1);

      // 11. Authorization and Cross-Trip Isolation:
      // Outsider cannot access Trip 1 analytics (403)
      const outsiderAccess = await getJson(baseUrl, `/api/trips/${tripId}/analytics`, outsider.token);
      expect(outsiderAccess.response.status).toBe(403);

      // Owner cannot access Trip 2 analytics (403)
      const ownerTrip2 = await getJson(baseUrl, `/api/trips/${trip2Id}/analytics`, owner.token);
      expect(ownerTrip2.response.status).toBe(403);

      // Trip 2 analytics for Outsider has 0 expenses (cross-trip isolation)
      const trip2Report = await getJson(baseUrl, `/api/trips/${trip2Id}/analytics`, outsider.token);
      expect(trip2Report.response.status).toBe(200);
      expect(trip2Report.payload.spendingSummary.totalSpending).toBe('0.00');
      expect(trip2Report.payload.baseCurrency).toBe('USD');
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
