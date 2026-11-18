import { Router } from 'express';

import { getCurrentUser, loginUser, registerUser } from '../controllers/authController.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { requireAuth } from '../middleware/authMiddleware.js';
import { createRateLimiter } from '../middleware/rateLimit.js';

const router = Router();

// Password guessing protection. Separate buckets keep a locked-out login from
// blocking registration (and vice versa).
const loginLimiter = createRateLimiter({ windowMs: 60_000, max: 30, keyPrefix: 'auth-login' });
const registerLimiter = createRateLimiter({ windowMs: 60_000, max: 20, keyPrefix: 'auth-register' });

router.post('/register', registerLimiter, asyncHandler(registerUser));
router.post('/login', loginLimiter, asyncHandler(loginUser));
router.get('/me', requireAuth, asyncHandler(getCurrentUser));

export default router;
