export type SplitMethod = 'EQUAL' | 'EXACT' | 'PERCENTAGE' | 'WEIGHTED';

export type SplitInput = {
  userId: string;
  amount?: string;
  percentage?: string;
  weight?: string;
};

export type SplitAllocation = {
  userId: string;
  amountMinor: bigint;
};

const databaseMinorLimit = 999_999_999_999_999_999n;
const rateScale = 100_000_000n;
const weightScale = 1_000_000n;

export class FinancialInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FinancialInputError';
  }
}

export function getCurrencyDigits(currency: string) {
  if (!/^[A-Z]{3}$/.test(currency)) {
    throw new FinancialInputError('Currency must be a three-letter ISO code.');
  }

  let digits: number | undefined;
  try {
    digits = new Intl.NumberFormat('en', {
      style: 'currency',
      currency,
    }).resolvedOptions().maximumFractionDigits;
  } catch {
    throw new FinancialInputError(`Currency ${currency} is not supported.`);
  }

  if (digits === undefined || !Number.isInteger(digits)) {
    throw new FinancialInputError(`Currency ${currency} is not supported.`);
  }

  if (digits > 2) {
    throw new FinancialInputError('Currencies with more than two minor-unit digits are not supported.');
  }

  return digits;
}

function getScale(currency: string) {
  return 10n ** BigInt(getCurrencyDigits(currency));
}

function assertDatabaseRange(amountMinor: bigint, currency: string) {
  const maximumMinor = databaseMinorLimit / (10n ** BigInt(2 - getCurrencyDigits(currency)));
  if (amountMinor < 0n || amountMinor > maximumMinor) {
    throw new FinancialInputError('Amount exceeds the supported database precision.');
  }
}

export function parseMoneyToMinor(value: string, currency: string) {
  const digits = getCurrencyDigits(currency);
  const match = /^(\d+)(?:\.(\d+))?$/.exec(value);
  if (!match) {
    throw new FinancialInputError('Amount must be a positive decimal value.');
  }

  const fraction = match[2] ?? '';
  if (fraction.length > digits) {
    throw new FinancialInputError(`${currency} amounts support at most ${digits} decimal places.`);
  }

  const scale = 10n ** BigInt(digits);
  const amountMinor = BigInt(match[1]) * scale + BigInt((fraction || '0').padEnd(digits, '0') || '0');
  if (amountMinor <= 0n) {
    throw new FinancialInputError('Amount must be greater than zero.');
  }

  assertDatabaseRange(amountMinor, currency);
  return amountMinor;
}

export function parseStoredMoneyToMinor(value: string, currency: string) {
  const digits = getCurrencyDigits(currency);
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(value);
  if (!match) {
    throw new FinancialInputError('Stored amount is not a valid decimal.');
  }

  const fraction = match[3] ?? '';
  const relevantFraction = fraction.slice(0, digits);
  const excessFraction = fraction.slice(digits);
  if (excessFraction && /[1-9]/.test(excessFraction)) {
    throw new FinancialInputError('Stored amount has precision beyond the currency minor unit.');
  }

  const scale = 10n ** BigInt(digits);
  const minor = BigInt(match[2]) * scale + BigInt((relevantFraction || '0').padEnd(digits, '0') || '0');
  return match[1] === '-' ? -minor : minor;
}

export function minorToDecimalString(amountMinor: bigint, currency: string) {
  const digits = getCurrencyDigits(currency);
  const negative = amountMinor < 0n;
  const absolute = negative ? -amountMinor : amountMinor;
  const scale = 10n ** BigInt(digits);
  const whole = absolute / scale;
  const fraction = digits ? `.${(absolute % scale).toString().padStart(digits, '0')}` : '';
  const currencyDecimal = `${negative ? '-' : ''}${whole}${fraction}`;

  return digits < 2 ? `${currencyDecimal}${digits === 0 ? '.00' : '0'}` : currencyDecimal;
}

export function parseRate(value: string) {
  const match = /^(\d+)(?:\.(\d{1,8}))?$/.exec(value);
  if (!match) {
    throw new FinancialInputError('Exchange rate must be a positive decimal with up to eight places.');
  }

  const rate = BigInt(match[1]) * rateScale + BigInt((match[2] ?? '').padEnd(8, '0') || '0');
  if (rate <= 0n) {
    throw new FinancialInputError('Exchange rate must be greater than zero.');
  }
  if (rate > databaseMinorLimit) {
    throw new FinancialInputError('Exchange rate exceeds the supported database precision.');
  }

  return rate;
}

function roundQuotient(numerator: bigint, denominator: bigint) {
  const quotient = numerator / denominator;
  const remainder = numerator % denominator;
  return remainder * 2n >= denominator ? quotient + 1n : quotient;
}

export function convertMinorUnits(
  amountMinor: bigint,
  sourceCurrency: string,
  baseCurrency: string,
  exchangeRate?: string,
) {
  if (sourceCurrency === baseCurrency) {
    if (exchangeRate !== undefined) {
      throw new FinancialInputError('Do not supply an exchange rate for the trip base currency.');
    }
    return amountMinor;
  }

  if (!exchangeRate) {
    throw new FinancialInputError('An exchange rate to the trip base currency is required.');
  }

  const sourceScale = getScale(sourceCurrency);
  const baseScale = getScale(baseCurrency);
  const rate = parseRate(exchangeRate);
  const converted = roundQuotient(amountMinor * rate * baseScale, sourceScale * rateScale);
  assertDatabaseRange(converted, baseCurrency);
  if (converted <= 0n) {
    throw new FinancialInputError('Converted amount must be at least one minor unit.');
  }
  return converted;
}

export function apportionMinorUnits(totalMinor: bigint, weights: Array<{ userId: string; weight: bigint }>) {
  if (totalMinor < 0n || weights.length === 0 || weights.some((item) => item.weight <= 0n)) {
    throw new FinancialInputError('A positive total and positive participant weights are required.');
  }

  const totalWeight = weights.reduce((sum, item) => sum + item.weight, 0n);
  const portions = weights.map((item) => {
    const numerator = totalMinor * item.weight;
    return {
      userId: item.userId,
      amountMinor: numerator / totalWeight,
      remainder: numerator % totalWeight,
    };
  });

  const remainderCount = Number(totalMinor - portions.reduce((sum, item) => sum + item.amountMinor, 0n));
  const remainderOrder = [...portions].sort((left, right) => {
    if (left.remainder !== right.remainder) {
      return left.remainder > right.remainder ? -1 : 1;
    }
    if (left.userId < right.userId) {
      return -1;
    }
    if (left.userId > right.userId) {
      return 1;
    }
    return 0;
  });

  for (let index = 0; index < remainderCount; index += 1) {
    remainderOrder[index].amountMinor += 1n;
  }

  return portions.map(({ userId, amountMinor }) => ({ userId, amountMinor }));
}

function parsePercentage(value: string) {
  const match = /^(100(?:\.0{1,2})?|(?:\d{1,2})(?:\.\d{1,2})?)$/.exec(value);
  if (!match) {
    throw new FinancialInputError('Percentage must be between 0 and 100 with up to two decimals.');
  }

  const [whole, fraction = ''] = value.split('.');
  return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0') || '0');
}

function parseWeight(value: string) {
  const match = /^(\d+)(?:\.(\d{1,6}))?$/.exec(value);
  if (!match) {
    throw new FinancialInputError('Weights must be positive decimals with up to six places.');
  }
  const weight = BigInt(match[1]) * weightScale + BigInt((match[2] ?? '').padEnd(6, '0') || '0');
  if (weight <= 0n) {
    throw new FinancialInputError('Every weight must be greater than zero.');
  }
  return weight;
}

export function splitAmount(
  totalMinor: bigint,
  method: SplitMethod,
  splits: SplitInput[],
  currency: string,
): SplitAllocation[] {
  if (!Number.isSafeInteger(splits.length) || splits.length === 0) {
    throw new FinancialInputError('At least one responsible member is required.');
  }

  const userIds = splits.map((split) => split.userId);
  if (new Set(userIds).size !== userIds.length) {
    throw new FinancialInputError('A member may appear only once in the expense split.');
  }

  if (method === 'EXACT') {
    const exact = splits.map((split) => {
      if (!split.amount || split.percentage !== undefined || split.weight !== undefined) {
        throw new FinancialInputError('Exact splits require only an amount for each member.');
      }
      return { userId: split.userId, amountMinor: parseMoneyToMinor(split.amount, currency) };
    });

    if (exact.reduce((sum, item) => sum + item.amountMinor, 0n) !== totalMinor) {
      throw new FinancialInputError('Exact split amounts must add up to the expense total.');
    }
    return exact;
  }

  if (method === 'EQUAL') {
    if (splits.some((split) => split.amount !== undefined || split.percentage !== undefined || split.weight !== undefined)) {
      throw new FinancialInputError('Equal splits require member IDs only.');
    }
    return apportionMinorUnits(
      totalMinor,
      splits.map(({ userId }) => ({ userId, weight: 1n })),
    );
  }

  if (method === 'PERCENTAGE') {
    const percentages = splits.map((split) => {
      if (!split.percentage || split.amount !== undefined || split.weight !== undefined) {
        throw new FinancialInputError('Percentage splits require only a percentage for each member.');
      }
      return { userId: split.userId, weight: parsePercentage(split.percentage) };
    });
    if (percentages.reduce((sum, item) => sum + item.weight, 0n) !== 10_000n) {
      throw new FinancialInputError('Percentages must add up to exactly 100.00%.');
    }
    return apportionMinorUnits(totalMinor, percentages);
  }

  const weighted = splits.map((split) => {
    if (!split.weight || split.amount !== undefined || split.percentage !== undefined) {
      throw new FinancialInputError('Weighted splits require only a weight for each member.');
    }
    return { userId: split.userId, weight: parseWeight(split.weight) };
  });

  return apportionMinorUnits(totalMinor, weighted);
}
