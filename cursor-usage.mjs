function numberOrNull(value) {
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) ? number : null;
}

function timestampOrNull(value) {
  const number = numberOrNull(value);
  if (number !== null) {
    const milliseconds = number > 0 && number < 1_000_000_000_000 ? number * 1000 : number;
    return milliseconds > 0 ? milliseconds : null;
  }

  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function percentOrNull(value) {
  const number = numberOrNull(value);
  if (number === null) return null;
  return Math.max(0, Math.min(100, number));
}

function stringOrNull(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

export function normalizeCursorUsage(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const sourcePlan = source.planUsage || source.individualUsage?.plan || null;
  const totalSpendCents = numberOrNull(
    sourcePlan?.totalSpend ?? sourcePlan?.overallSpend ?? sourcePlan?.used ?? sourcePlan?.overallSpendCents,
  );
  const includedSpendCents = numberOrNull(
    sourcePlan?.includedSpend ?? sourcePlan?.includedSpendCents ?? totalSpendCents,
  );
  const limitCents = numberOrNull(
    sourcePlan?.limit ?? sourcePlan?.includedLimit ?? sourcePlan?.includedSpendLimit,
  );
  const remainingCents = numberOrNull(
    sourcePlan?.remaining
      ?? sourcePlan?.remainingSpend
      ?? (limitCents !== null && totalSpendCents !== null ? limitCents - totalSpendCents : null),
  );
  const reportedTotalPercent = percentOrNull(sourcePlan?.totalPercentUsed);
  const totalPercentUsed = reportedTotalPercent !== null
    ? reportedTotalPercent
    : limitCents !== null && limitCents > 0 && totalSpendCents !== null
      ? Math.max(0, Math.min(100, (totalSpendCents / limitCents) * 100))
      : null;

  return {
    billingCycleStart: timestampOrNull(source.billingCycleStart),
    billingCycleEnd: timestampOrNull(source.billingCycleEnd),
    planUsage: sourcePlan
      ? {
          totalSpendCents,
          includedSpendCents,
          remainingCents,
          limitCents,
          autoPercentUsed: percentOrNull(sourcePlan.autoPercentUsed),
          apiPercentUsed: percentOrNull(sourcePlan.apiPercentUsed),
          totalPercentUsed,
        }
      : null,
    pace: null,
    spendLimitUsage: source.spendLimitUsage
      ? {
          limitType: stringOrNull(source.spendLimitUsage.limitType),
          pooledLimitCents: numberOrNull(source.spendLimitUsage.pooledLimit),
        }
      : null,
    displayMessage: stringOrNull(source.displayMessage),
    autoModelSelectedDisplayMessage: stringOrNull(source.autoModelSelectedDisplayMessage),
    namedModelSelectedDisplayMessage: stringOrNull(source.namedModelSelectedDisplayMessage),
    updatedAt: Date.now(),
  };
}
