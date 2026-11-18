import cors from 'cors';
import express from 'express';

import { config } from './config/env.js';
import authRoutes from './routes/auth.js';
import invitationRoutes from './routes/invitations.js';
import tripRoutes from './routes/trips.js';

function redactForServerLog(value: string) {
  let redacted = value;
  if (config.jwtSecret) redacted = redacted.split(config.jwtSecret).join('[REDACTED]');
  return redacted.replace(/(:\/\/[^:/\s]+:)[^@/\s]+@/g, '$1[REDACTED]@');
}

export function apiErrorHandler(
  error: unknown,
  _req: express.Request,
  res: express.Response,
  next: express.NextFunction,
) {
  const detail = error instanceof Error
    ? {
        name: error.name,
        message: redactForServerLog(error.message),
        stack: error.stack ? redactForServerLog(error.stack) : undefined,
      }
    : { message: redactForServerLog(String(error)) };

  console.error('[api] Unhandled request error', detail);

  if (res.headersSent) {
    next(error);
    return;
  }

  res.status(500).json({ message: 'Unexpected server error.' });
}

const app = express();

// Vercel terminates TLS in front of the function, so the socket address is the
// proxy. Trusting exactly one hop makes req.ip the caller's address, which
// keeps rate-limit buckets per client instead of shared by every user.
app.set('trust proxy', 1);

// Do not advertise the stack, and cap request bodies so a single request cannot
// exhaust memory.
app.disable('x-powered-by');

app.use(
  cors({
    origin: config.clientUrl,
    credentials: true,
  }),
);

app.use(express.json({ limit: '100kb' }));

app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'tripledger-api' });
});

app.use('/api/auth', authRoutes);
app.use('/api/invitations', invitationRoutes);
app.use('/api/trips', tripRoutes);

app.use(apiErrorHandler);

export default app;
