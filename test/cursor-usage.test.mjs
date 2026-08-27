import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeCursorUsage } from '../cursor-usage.mjs';

test('normalizes Cursor usage amounts, percentages, and timestamps', () => {
  const usage = normalizeCursorUsage({
    billingCycleStart: '2026-08-14T00:00:00.000Z',
    billingCycleEnd: '1789396138000',
    planUsage: {
      totalSpend: 188,
      includedSpend: 188,
      remaining: 6812,
      limit: 7000,
      autoPercentUsed: 0.235,
      apiPercentUsed: 0,
      totalPercentUsed: 0.2065934065934066,
    },
    spendLimitUsage: { limitType: 'user', pooledLimit: 7000 },
  });

  assert.equal(usage.billingCycleStart, Date.parse('2026-08-14T00:00:00.000Z'));
  assert.equal(usage.planUsage.totalSpendCents, 188);
  assert.equal(usage.planUsage.remainingCents, 6812);
  assert.equal(usage.planUsage.autoPercentUsed, 0.235);
  assert.equal(usage.planUsage.totalPercentUsed, 0.2065934065934066);
  assert.equal(usage.spendLimitUsage.limitType, 'user');
});

test('derives total spend percentage when Cursor omits it', () => {
  const usage = normalizeCursorUsage({
    planUsage: { totalSpend: 250, limit: 1000 },
  });

  assert.equal(usage.planUsage.totalPercentUsed, 25);
  assert.equal(usage.planUsage.remainingCents, 750);
});

test('accepts the alternate individual usage shape', () => {
  const usage = normalizeCursorUsage({
    individualUsage: {
      plan: { used: 120, limit: 4000, autoPercentUsed: 2.5 },
    },
  });

  assert.equal(usage.planUsage.totalSpendCents, 120);
  assert.equal(usage.planUsage.limitCents, 4000);
  assert.equal(usage.planUsage.autoPercentUsed, 2.5);
});
