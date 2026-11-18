import app from './app.js';
import { config } from './config/env.js';
import { prisma } from './lib/prisma.js';
import { startOutboxWorker } from './services/outboxService.js';

startOutboxWorker(prisma);
app.listen(config.port, () => {
  console.log(`TripLedger API listening on http://localhost:${config.port}`);
});
