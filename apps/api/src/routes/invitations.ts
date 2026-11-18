import { Router } from 'express';

import { acceptInvitation, declineInvitation, getMyInvitations } from '../controllers/invitationController.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { requireAuth } from '../middleware/authMiddleware.js';

const router = Router();

router.use(requireAuth);
router.get('/', asyncHandler(getMyInvitations));
router.post('/:invitationId/accept', asyncHandler(acceptInvitation));
router.post('/:invitationId/decline', asyncHandler(declineInvitation));

export default router;
