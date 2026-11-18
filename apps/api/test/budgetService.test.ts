import { describe, expect, it } from 'vitest';

import {
  createBudgetSnapshot,
  formatBudgetUtilization,
  getReachedBudgetThresholds,
  projectThirtyDayResponsibility,
} from '../src/services/budgetService.js';
import { parseMoneyToMinor } from '../src/services/financialMath.js';

describe('budget calculations', () => {
  it('uses exact minor-unit threshold comparisons at 50, 75, 90, and 100 percent', () => {
    const planned = parseMoneyToMinor('1000.00', 'INR');
    expect(getReachedBudgetThresholds(planned, 49_999n)).toEqual([]);
    expect(getReachedBudgetThresholds(planned, 50_000n)).toEqual([50]);
    expect(getReachedBudgetThresholds(planned, 75_000n)).toEqual([50, 75]);
    expect(getReachedBudgetThresholds(planned, 90_000n)).toEqual([50, 75, 90]);
    expect(getReachedBudgetThresholds(planned, 100_000n)).toEqual([50, 75, 90, 100]);
    expect(getReachedBudgetThresholds(planned, 100_000n)).toEqual([50, 75, 90, 100]);
  });

  it('computes remaining, utilization, and overspending from responsibility', () => {
    expect(createBudgetSnapshot(10_000n, 7_500n, 'INR')).toEqual({
      plannedBudget: '100.00',
      remainingBudget: '25.00',
      utilizationPct: '75.00',
      overspending: '0.00',
    });
    expect(createBudgetSnapshot(10_000n, 12_345n, 'INR')).toEqual({
      plannedBudget: '100.00',
      remainingBudget: '-23.45',
      utilizationPct: '123.45',
      overspending: '23.45',
    });
    expect(formatBudgetUtilization(3n, 1n)).toBe('33.33');
  });

  it('projects a 30-day responsibility run rate using integer rounding', () => {
    expect(projectThirtyDayResponsibility(1_000n, 10)).toBe(3_000n);
    expect(projectThirtyDayResponsibility(1_001n, 30)).toBe(1_001n);
    expect(projectThirtyDayResponsibility(1n, 2)).toBe(15n);
    expect(projectThirtyDayResponsibility(-1n, 2)).toBe(-15n);
  });
});
