import { Router } from 'express';

import {
  addMember,
  createInvitation,
  createTrip,
  getTrip,
  joinTrip,
  listTrips,
  listTripInvitations,
  setMemberBudget,
  updateCashManager,
  updateMemberRole,
  updateTripSettings,
} from '../controllers/tripController.js';
import { getTripBudgets } from '../controllers/budgetController.js';
import {
  correctTripExpense,
  createTripExpense,
  getTripExpenseBalances,
  getTripExpenseHistory,
  listTripExpenses,
  reverseTripExpense,
} from '../controllers/expenseController.js';
import {
  getTripAnalyticsReport,
  getTripCategoryAnalytics,
  getTripMemberAnalytics,
  getTripBudgetAnalytics,
  getTripSettlementAnalytics,
  getTripTrendAnalytics,
} from '../controllers/analyticsController.js';
import {
  exportTripReportCsv,
  getTripReport,
} from '../controllers/reportController.js';
import {
  listTripLocations,
  shareTripLocation,
  stopSharingTripLocation,
} from '../controllers/locationController.js';
import {
  closeTrip,
  confirmPayment,
  generatePlan,
  getExpenseReviews,
  getOverview,
  initiateClosure,
  initiatePayment,
  raisePaymentDispute,
  refundSettlementPayment,
  reopenClosedTrip,
  requestClosure,
  resolvePayment,
  resolveReview,
  reviewExpense,
  startExpenseReview,
  updatePaymentStatus,
} from '../controllers/settlementController.js';
import {
  listTripNotifications,
  markAllTripNotificationsRead,
  markTripNotificationRead,
  streamTripEvents,
} from '../controllers/notificationController.js';
import { requireAuth } from '../middleware/authMiddleware.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { createRateLimiter } from '../middleware/rateLimit.js';
import { requireTripAccess } from '../middleware/tripAccess.js';

const router = Router();

// Guessing an 8-character code already needs ~10^12 tries; this makes online
// brute force hopeless as well. Keyed by IP and scoped to this route only.
const joinLimiter = createRateLimiter({ windowMs: 60_000, max: 20, keyPrefix: 'trip-join' });
// The mobile client refreshes while the location screen is open; this only
// stops a runaway client from hammering the database.
const locationLimiter = createRateLimiter({ windowMs: 60_000, max: 120, keyPrefix: 'trip-location' });

router.use(requireAuth);

router.post('/', asyncHandler(createTrip));
router.post('/join', joinLimiter, asyncHandler(joinTrip));
router.get('/', asyncHandler(listTrips));
router.get('/:tripId', requireTripAccess(), asyncHandler(getTrip));
router.patch('/:tripId/settings', requireTripAccess(['OWNER', 'ADMIN']), asyncHandler(updateTripSettings));
router.post('/:tripId/invitations', requireTripAccess(['OWNER', 'ADMIN']), asyncHandler(createInvitation));
router.get('/:tripId/invitations', requireTripAccess(['OWNER', 'ADMIN']), asyncHandler(listTripInvitations));
router.post('/:tripId/members', requireTripAccess(['OWNER', 'ADMIN']), asyncHandler(addMember));
router.patch('/:tripId/members/:memberId', requireTripAccess(['OWNER', 'ADMIN']), asyncHandler(updateMemberRole));
router.get('/:tripId/budgets', requireTripAccess(), asyncHandler(getTripBudgets));
router.get('/:tripId/locations', requireTripAccess(), asyncHandler(listTripLocations));
router.put('/:tripId/locations', requireTripAccess(), locationLimiter, asyncHandler(shareTripLocation));
router.delete('/:tripId/locations', requireTripAccess(), asyncHandler(stopSharingTripLocation));
router.post('/:tripId/budgets', requireTripAccess(['OWNER', 'ADMIN']), asyncHandler(setMemberBudget));
router.patch('/:tripId/cash-manager', requireTripAccess(['OWNER', 'ADMIN']), asyncHandler(updateCashManager));
router.get('/:tripId/events', requireTripAccess(), asyncHandler(streamTripEvents));
router.get('/:tripId/notifications', requireTripAccess(), asyncHandler(listTripNotifications));
router.post('/:tripId/notifications/read-all', requireTripAccess(), asyncHandler(markAllTripNotificationsRead));
router.patch('/:tripId/notifications/:notificationId/read', requireTripAccess(), asyncHandler(markTripNotificationRead));
router.get('/:tripId/expenses/balances', requireTripAccess(), asyncHandler(getTripExpenseBalances));
router.get('/:tripId/analytics', requireTripAccess(), asyncHandler(getTripAnalyticsReport));
router.get('/:tripId/analytics/categories', requireTripAccess(), asyncHandler(getTripCategoryAnalytics));
router.get('/:tripId/analytics/members', requireTripAccess(), asyncHandler(getTripMemberAnalytics));
router.get('/:tripId/analytics/budgets', requireTripAccess(), asyncHandler(getTripBudgetAnalytics));
router.get('/:tripId/analytics/settlements', requireTripAccess(), asyncHandler(getTripSettlementAnalytics));
router.get('/:tripId/analytics/trends', requireTripAccess(), asyncHandler(getTripTrendAnalytics));
router.get('/:tripId/reports', requireTripAccess(), asyncHandler(getTripReport));
router.get('/:tripId/reports/export', requireTripAccess(), asyncHandler(exportTripReportCsv));
router.get('/:tripId/expenses', requireTripAccess(), asyncHandler(listTripExpenses));
router.post('/:tripId/expenses', requireTripAccess(), asyncHandler(createTripExpense));
router.get('/:tripId/expenses/:expenseId/history', requireTripAccess(), asyncHandler(getTripExpenseHistory));
router.post('/:tripId/expenses/:expenseId/corrections', requireTripAccess(), asyncHandler(correctTripExpense));
router.post('/:tripId/expenses/:expenseId/reversal', requireTripAccess(), asyncHandler(reverseTripExpense));
router.post('/:tripId/closure-requests', requireTripAccess(), asyncHandler(requestClosure));
router.post('/:tripId/closure/initiate', requireTripAccess(['OWNER', 'ADMIN']), asyncHandler(initiateClosure));
router.post('/:tripId/closure/review/start', requireTripAccess(['OWNER', 'ADMIN']), asyncHandler(startExpenseReview));
router.get('/:tripId/closure/reviews', requireTripAccess(), asyncHandler(getExpenseReviews));
router.post('/:tripId/closure/expenses/:expenseId/review', requireTripAccess(), asyncHandler(reviewExpense));
router.post('/:tripId/closure/expenses/:expenseId/resolve', requireTripAccess(['OWNER', 'ADMIN']), asyncHandler(resolveReview));
router.get('/:tripId/settlements', requireTripAccess(), asyncHandler(getOverview));
router.post('/:tripId/settlements/generate', requireTripAccess(['OWNER', 'ADMIN']), asyncHandler(generatePlan));
router.post('/:tripId/settlements/:settlementId/payments', requireTripAccess(), asyncHandler(initiatePayment));
router.post('/:tripId/settlements/payments/:paymentId/confirm', requireTripAccess(), asyncHandler(confirmPayment));
router.post('/:tripId/settlements/payments/:paymentId/status', requireTripAccess(), asyncHandler(updatePaymentStatus));
router.post('/:tripId/settlements/payments/:paymentId/dispute', requireTripAccess(), asyncHandler(raisePaymentDispute));
router.post('/:tripId/settlements/payments/:paymentId/resolve', requireTripAccess(['OWNER', 'ADMIN']), asyncHandler(resolvePayment));
router.post('/:tripId/settlements/payments/:paymentId/refund', requireTripAccess(['OWNER', 'ADMIN']), asyncHandler(refundSettlementPayment));
router.post('/:tripId/closure/finalize', requireTripAccess(['OWNER', 'ADMIN']), asyncHandler(closeTrip));
router.post('/:tripId/closure/reopen', requireTripAccess(['OWNER']), asyncHandler(reopenClosedTrip));

export default router;
