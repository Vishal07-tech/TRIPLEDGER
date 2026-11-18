import dotenv from 'dotenv';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = fileURLToPath(new URL('../../../..', import.meta.url));

dotenv.config({ path: resolve(projectRoot, '.env') });

export function validateJwtSecret(secret: string | undefined, nodeEnv: string | undefined): string {
  const value = secret?.trim();
  if (!value) {
    throw new Error('JWT_SECRET must be configured before starting the API.');
  }

  if (nodeEnv === 'production' && Buffer.byteLength(value, 'utf8') < 32) {
    throw new Error('JWT_SECRET must be at least 32 bytes in production.');
  }

  return value;
}

const jwtSecret = validateJwtSecret(process.env.JWT_SECRET, process.env.NODE_ENV);

export const config = {
  port: Number(process.env.PORT ?? 4000),
  jwtSecret,
  clientUrl: process.env.CLIENT_URL ?? 'http://localhost:5173',
};
