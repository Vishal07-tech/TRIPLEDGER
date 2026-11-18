import { Prisma } from '@prisma/client';

// The API runs on MySQL locally and Postgres in production. Prisma creates
// CamelCase table and column names, which Postgres folds to lowercase unless
// they are quoted, so every hand-written query must quote identifiers.
const rawProvider = (process.env.DATABASE_PROVIDER ?? 'mysql').toLowerCase();

export const isPostgres = rawProvider.startsWith('postgres');

export function ident(name: string) {
  return Prisma.raw(isPostgres ? `"${name}"` : `\`${name}\``);
}

// `CAST(amount AS CHAR)` renders a DECIMAL as text on MySQL, but Postgres
// spells the same type TEXT.
export const moneyAsText = Prisma.raw(isPostgres ? 'TEXT' : 'CHAR');
