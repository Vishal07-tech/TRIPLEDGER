import { PrismaClient as MysqlClient } from '../tmp/mysql-client/index.js';
import { PrismaClient as PgClient } from '../tmp/pg-client/index.js';

const mysqlUrl = process.env.MYSQL_SOURCE_URL;
const pgUrl = process.env.PG_TARGET_URL;

if (!mysqlUrl || !pgUrl) {
  throw new Error('MYSQL_SOURCE_URL and PG_TARGET_URL must be set.');
}

const mysql = new MysqlClient({ datasources: { db: { url: mysqlUrl } } });
const pg = new PgClient({ datasources: { db: { url: pgUrl } } });

function normalize(row) {
  const out = {};
  for (const [key, value] of Object.entries(row)) {
    if (
      value &&
      typeof value === 'object' &&
      !(value instanceof Date) &&
      typeof value.toFixed === 'function' &&
      typeof value.toNumber === 'function'
    ) {
      out[key] = value.toString();
    } else {
      out[key] = value;
    }
  }
  return out;
}

async function copyModel(name, transform = (row) => row) {
  const rows = await mysql[name].findMany();
  if (rows.length === 0) {
    console.log(`${name}: 0`);
    return;
  }
  const data = rows.map((row) => normalize(transform(row)));
  const chunkSize = 500;
  for (let i = 0; i < data.length; i += chunkSize) {
    await pg[name].createMany({ data: data.slice(i, i + chunkSize) });
  }
  console.log(`${name}: ${rows.length}`);
}

async function main() {
  await copyModel('user');
  await copyModel('userPreference');
  await copyModel('trip');
  await copyModel('tripSetting');
  await copyModel('tripMember');
  await copyModel('tripInvitation');
  await copyModel('memberBudget');

  const expenses = await mysql.expense.findMany();
  await copyModel('expense', (row) => ({ ...row, correctedFromExpenseId: null }));
  await copyModel('expensePayer');
  await copyModel('expenseAllocation');
  await copyModel('expenseLocation');
  await copyModel('expenseReceipt');

  await copyModel('settlement');
  await copyModel('settlementPayment');
  await copyModel('settlementExpenseReview');
  await copyModel('settlementPaymentEvent');
  await copyModel('settlementRefund');
  await copyModel('settlementLedgerEntry');

  const financialEntries = await mysql.financialEntry.findMany();
  await copyModel('financialEntry', (row) => ({ ...row, reversalOfId: null }));
  await copyModel('exchangeRate');
  await copyModel('notification');
  await copyModel('auditLog');
  await copyModel('idempotencyKey');
  await copyModel('outboxEvent');

  for (const row of expenses) {
    if (row.correctedFromExpenseId) {
      await pg.expense.update({
        where: { id: row.id },
        data: { correctedFromExpenseId: row.correctedFromExpenseId },
      });
    }
  }
  console.log(`expense corrections: ${expenses.filter((row) => row.correctedFromExpenseId).length}`);

  for (const row of financialEntries) {
    if (row.reversalOfId) {
      await pg.financialEntry.update({
        where: { id: row.id },
        data: { reversalOfId: row.reversalOfId },
      });
    }
  }
  console.log(`financial reversals: ${financialEntries.filter((row) => row.reversalOfId).length}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mysql.$disconnect();
    await pg.$disconnect();
  });
