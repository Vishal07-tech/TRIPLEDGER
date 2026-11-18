import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const apiDirectory = fileURLToPath(new URL('..', import.meta.url));
const projectDirectory = resolve(apiDirectory, '../..');

dotenv.config({ path: resolve(projectDirectory, '.env') });

const migrationDatabaseUrl = process.env.MIGRATION_DATABASE_URL;

if (!migrationDatabaseUrl) {
  throw new Error('MIGRATION_DATABASE_URL must be configured to run Prisma migrations.');
}

const [command, ...args] = process.argv.slice(2);

if (command !== 'dev' && command !== 'deploy') {
  throw new Error('Usage: npm run db:migrate -- <dev|deploy> [Prisma migrate options]');
}

const shadowDatabaseUrl =
  command === 'dev'
    ? process.env.SHADOW_DATABASE_URL
    : process.env.SHADOW_DATABASE_URL ?? 'mysql://unused:unused@127.0.0.1:1/unused';

if (!shadowDatabaseUrl) {
  throw new Error('SHADOW_DATABASE_URL must be configured for development migrations.');
}

const prismaCli = resolve(projectDirectory, 'node_modules/prisma/build/index.js');
const schemaPath = resolve(apiDirectory, 'prisma/schema.prisma');
const result = spawnSync(
  process.execPath,
  [prismaCli, 'migrate', command, ...args, '--schema', schemaPath],
  {
    stdio: 'inherit',
    env: {
      ...process.env,
      DATABASE_URL: migrationDatabaseUrl,
      SHADOW_DATABASE_URL: shadowDatabaseUrl,
    },
  },
);

if (result.error) {
  throw result.error;
}

if (result.status !== 0) {
  process.exit(result.status ?? 1);
}
