import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ProxyAgent, fetch as undiciFetch } from 'undici';
import { getWeekWindowFromUsage, isLikelyTransientUsageGlitch, preserveTransientWindowRegressions } from './usage-guard.mjs';
import { calculateRemainingTimePercent, calculateUsageRate, getLatestMonotonicSegment, isUsageRateAvailable, projectExhaustionHours, reconcilePaceSamples } from './pace-window.mjs';
import { normalizeCursorUsage } from './cursor-usage.mjs';
import { buildCursorUsagePace, reconcileCursorPaceSamples } from './cursor-pace.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PUBLIC_DIR = path.join(__dirname, 'dist');
const DATA_DIR = path.join(__dirname, 'data');
const STORE_PATH = path.join(DATA_DIR, 'accounts.json');
const SETTINGS_PATH = path.join(DATA_DIR, 'settings.json');
const HISTORY_PATH = path.join(DATA_DIR, 'history.json');
const ALERTS_PATH = path.join(DATA_DIR, 'alerts.json');
const CLAUDE_STATE_PATH = path.join(DATA_DIR, 'claude-code.json');
const OPENCODE_GO_STATE_PATH = path.join(DATA_DIR, 'opencode-go.json');
const CURSOR_STATE_PATH = path.join(DATA_DIR, 'cursor.json');
const DEFAULT_SETTINGS = { liveInterval: 30, backgroundInterval: 300 };
const MAX_HISTORY_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const PORT = Number(process.env.PORT || 1455);
const HOST = process.env.HOST || '127.0.0.1';
const OPENAI_PROXY = process.env.OPENAI_PROXY || '';
const SHOW_CLAUDE_CARD = process.env.CODEX_USAGE_SHOW_CLAUDE === 'true';
const SHOW_OPENCODE_GO_CARD = process.env.CODEX_USAGE_SHOW_OPENCODE_GO === 'true';
const TELEGRAM_BOT_TOKEN = process.env.CODEX_USAGE_TELEGRAM_BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN || '';
const TELEGRAM_CHAT_ID = process.env.CODEX_USAGE_TELEGRAM_CHAT_ID || process.env.TELEGRAM_CHAT_ID || '';
const USAGE_ALERT_TIMEZONE = process.env.CODEX_USAGE_ALERT_TIMEZONE || 'Europe/Moscow';
const DAILY_USAGE_LIMIT_PERCENT = Number(process.env.CODEX_USAGE_DAILY_LIMIT_PERCENT || 20);
const USAGE_ALERT_BURN_RATE_MULTIPLIER = Number(process.env.CODEX_USAGE_BURN_RATE_ALERT_MULTIPLIER || 1.25);
const USAGE_ALERT_SLOW_RATE_MULTIPLIER = Number(process.env.CODEX_USAGE_SLOW_RATE_MULTIPLIER || 0.75);
const USAGE_ALERT_MIN_SPENT_PERCENT = Number(process.env.CODEX_USAGE_ALERT_MIN_SPENT_PERCENT || 0.5);
const USAGE_ALERT_MIN_RATE_OVER_PERCENT_PER_HOUR = Number(process.env.CODEX_USAGE_ALERT_MIN_RATE_OVER_PERCENT_PER_HOUR || 0.1);
const USAGE_ALERT_WEEKDAYS_ONLY = process.env.CODEX_USAGE_ALERT_WEEKDAYS_ONLY !== 'false';
const USAGE_ALERT_WEEKEND_WEIGHT = Number(process.env.CODEX_USAGE_ALERT_WEEKEND_WEIGHT || 0.35);
const USAGE_ALERT_ACTIVE_HOURS = process.env.CODEX_USAGE_ALERT_ACTIVE_HOURS || '09:00-23:00';
const USAGE_ALERT_ESTIMATE_FRACTIONS = process.env.CODEX_USAGE_ESTIMATE_FRACTIONS !== 'false';
const USAGE_ALERT_DEFAULT_5H_TO_WEEK_RATIO = Number(process.env.CODEX_USAGE_DEFAULT_5H_TO_WEEK_RATIO || 0);
const RECENT_PACE_HOURS = Number(process.env.CODEX_USAGE_RECENT_PACE_HOURS || 3);
const SHORT_WINDOW_PACE_HOURS = Number(process.env.CODEX_USAGE_SHORT_WINDOW_PACE_HOURS || 1);
const MIN_PACE_ELAPSED_HOURS = Number(process.env.CODEX_USAGE_MIN_PACE_ELAPSED_HOURS || (1 / 12));
const CLAUDE_CREDENTIALS_PATH = process.env.CLAUDE_CREDENTIALS_PATH || path.join(process.env.HOME || '', '.claude', '.credentials.json');
const CLAUDE_CLIENT_ID = process.env.CLAUDE_CODE_OAUTH_CLIENT_ID || '9d1c250a-e61b-44d9-88ed-5944d1962f5e';
const CLAUDE_TOKEN_URL = process.env.CLAUDE_TOKEN_URL || 'https://platform.claude.com/v1/oauth/token';
const CLAUDE_PROFILE_URL = process.env.CLAUDE_PROFILE_URL || 'https://api.anthropic.com/api/oauth/profile';
const CLAUDE_USAGE_URL = process.env.CLAUDE_USAGE_URL || 'https://api.anthropic.com/api/oauth/usage';
const CLAUDE_BETA = 'oauth-2025-04-20';
const CLAUDE_SLOT = 'claude-code';
const OPENCODE_GO_SLOT = 'opencode-go';
const OPENCODE_PROVIDER_IDS = new Set(['opencode', 'opencode-go']);
const OPENCODE_GO_DB_PATH = process.env.OPENCODE_DB_PATH || path.join(process.env.HOME || '', '.local', 'share', 'opencode', 'opencode.db');
const OPENCODE_MODELS_PATH = process.env.OPENCODE_MODELS_PATH || path.join(process.env.HOME || '', '.cache', 'opencode', 'models.json');
const OPENCODE_GO_API_KEY = process.env.OPENCODE_API_KEY || process.env.OPENCODE_GO_API_KEY || '';
const CURSOR_AUTH_PATH = process.env.CURSOR_AUTH_PATH || path.join(
  process.env.XDG_CONFIG_HOME || path.join(process.env.HOME || '', '.config'),
  'cursor',
  'auth.json',
);
const CURSOR_ACCESS_TOKEN = process.env.CURSOR_ACCESS_TOKEN || '';
const CURSOR_API_URL = process.env.CURSOR_API_URL || 'https://api2.cursor.sh';
const CURSOR_CLIENT_VERSION = process.env.CURSOR_CLIENT_VERSION || 'cli-' + (getCursorCliVersion() || 'unknown');
const OPENCODE_GO_LIMITS = [
  { label: '5h', durationMs: 5 * 60 * 60 * 1000, limit: 12 },
  { label: 'Week', durationMs: 7 * 24 * 60 * 60 * 1000, limit: 30 },
  { label: 'Month', durationMs: 30 * 24 * 60 * 60 * 1000, limit: 60 },
];
const OPENCODE_GO_MODEL_COSTS = {
  'glm-5.1': { input: 1.4, output: 4.4, cache_read: 0.26 },
  'glm-5': { input: 1, output: 3.2, cache_read: 0.2 },
  'kimi-k2.6': { input: 0.95, output: 4, cache_read: 0.16 },
  'kimi-k2.5': { input: 0.6, output: 3, cache_read: 0.1 },
  'mimo-v2.5': { input: 0.14, output: 0.28, cache_read: 0.0028 },
  'mimo-v2-omni': { input: 0.14, output: 0.28, cache_read: 0.0028 },
  'mimo-v2.5-pro': { input: 1.74, output: 3.48, cache_read: 0.0145 },
  'mimo-v2-pro': { input: 1.74, output: 3.48, cache_read: 0.0145 },
  'minimax-m3': { input: 0.6, output: 2.4, cache_read: 0.12, cache_write: 0.75 },
  'minimax-m2.7': { input: 0.3, output: 1.2, cache_read: 0.06, cache_write: 0.375 },
  'minimax-m2.5': { input: 0.3, output: 1.2, cache_read: 0.06, cache_write: 0.375 },
  'qwen3.7-max': { input: 2.5, output: 7.5, cache_read: 0.5, cache_write: 3.125 },
  'qwen3.6-plus': { input: 0.5, output: 3, cache_read: 0.05, cache_write: 0.625 },
  'deepseek-v4-pro': { input: 1.74, output: 3.48, cache_read: 0.0145 },
  'deepseek-v4-flash': { input: 0.14, output: 0.28, cache_read: 0.0028 },
};
const CLAUDE_MIN_REFRESH_INTERVAL_MS = Number(process.env.CLAUDE_REFRESH_INTERVAL_SECONDS || 300) * 1000;
const CLAUDE_RATE_LIMIT_COOLDOWN_MS = Number(process.env.CLAUDE_RATE_LIMIT_COOLDOWN_SECONDS || 900) * 1000;
const CLAUDE_CLI_VERSION = getClaudeCliVersion();
const CLAUDE_USER_AGENT = `claude-code/${CLAUDE_CLI_VERSION || 'unknown'}`;

const CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann';
const AUTHORIZE_URL = 'https://auth.openai.com/oauth/authorize';
const TOKEN_URL = 'https://auth.openai.com/oauth/token';
const USAGE_URL = 'https://chatgpt.com/backend-api/wham/usage';

const REDIRECT_URI = `http://localhost:${PORT}/auth/callback`;
const SCOPE = 'openid profile email offline_access';
const JWT_CLAIM_PATH = 'https://api.openai.com/auth';
const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

const pendingLogins = new Map();

const PROXY_URL = OPENAI_PROXY || process.env.https_proxy || process.env.http_proxy || '';
const proxyDispatcher = PROXY_URL ? new ProxyAgent(PROXY_URL) : null;
if (proxyDispatcher) console.log(`Proxy: ${PROXY_URL}`);

function fetchOpenAI(url, options = {}) {
  return proxyDispatcher
    ? undiciFetch(url, { ...options, dispatcher: proxyDispatcher })
    : globalThis.fetch(url, options);
}

function ensureStore() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(STORE_PATH)) {
    fs.writeFileSync(
      STORE_PATH,
      JSON.stringify({ version: 1, accounts: {} }, null, 2) + '\n',
      'utf8',
    );
  }
}

function loadStore() {
  ensureStore();
  const raw = fs.readFileSync(STORE_PATH, 'utf8');
  const parsed = JSON.parse(raw || '{}');
  parsed.accounts ||= {};
  return parsed;
}

function saveStore(store) {
  ensureStore();
  fs.writeFileSync(STORE_PATH, JSON.stringify(store, null, 2) + '\n', 'utf8');
}

function loadSettings() {
  ensureStore();
  try {
    if (fs.existsSync(SETTINGS_PATH)) {
      const raw = JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf8'));
      // Migrate legacy refreshInterval → liveInterval + backgroundInterval
      if ('refreshInterval' in raw && !('liveInterval' in raw)) {
        const migrated = {
          liveInterval: raw.refreshInterval || 30,
          backgroundInterval: raw.backgroundInterval || 300,
        };
        saveSettings(migrated);
        return migrated;
      }
      return { ...DEFAULT_SETTINGS, ...raw };
    }
  } catch {}
  return { ...DEFAULT_SETTINGS };
}

function saveSettings(settings) {
  ensureStore();
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2) + '\n', 'utf8');
}

function loadHistory() {
  try {
    if (fs.existsSync(HISTORY_PATH)) {
      return JSON.parse(fs.readFileSync(HISTORY_PATH, 'utf8'));
    }
  } catch {}
  return { snapshots: [] };
}

function saveHistory(history) {
  fs.writeFileSync(HISTORY_PATH, JSON.stringify(history) + '\n', 'utf8');
}

function loadAlerts() {
  try {
    if (fs.existsSync(ALERTS_PATH)) return JSON.parse(fs.readFileSync(ALERTS_PATH, 'utf8'));
  } catch {}
  return { slots: {} };
}

function saveAlerts(alerts) {
  ensureStore();
  fs.writeFileSync(ALERTS_PATH, JSON.stringify(alerts, null, 2) + '\n', 'utf8');
}

const localDateFormatters = new Map();

function getLocalDateParts(date = new Date(), timeZone = USAGE_ALERT_TIMEZONE) {
  let formatter = localDateFormatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    });
    localDateFormatters.set(timeZone, formatter);
  }
  const parts = formatter.formatToParts(date);
  const get = (type) => parts.find(part => part.type === type)?.value || '';
  return {
    dateKey: `${get('year')}-${get('month')}-${get('day')}`,
    weekday: get('weekday'),
    minutesOfDay: Number(get('hour')) * 60 + Number(get('minute')),
  };
}

function parseTimeToMinutes(value) {
  const match = String(value || '').trim().match(/^(\d{1,2})(?::(\d{2}))?$/);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2] || 0);
  if (hour < 0 || hour > 24 || minute < 0 || minute > 59 || (hour === 24 && minute !== 0)) return null;
  return hour * 60 + minute;
}

function parseActiveHours(value = USAGE_ALERT_ACTIVE_HOURS) {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw || raw === 'all' || raw === '24h') return [{ start: 0, end: 24 * 60 }];
  return raw.split(',').map(part => {
    const [startRaw, endRaw] = part.split('-');
    const start = parseTimeToMinutes(startRaw);
    const end = parseTimeToMinutes(endRaw);
    if (start === null || end === null || start === end) return null;
    return { start, end };
  }).filter(Boolean);
}

const usageAlertActiveWindows = parseActiveHours();

function isInActiveHours(timestamp = Date.now()) {
  if (!usageAlertActiveWindows.length) return true;
  const { minutesOfDay } = getLocalDateParts(new Date(timestamp));
  return usageAlertActiveWindows.some(({ start, end }) => (
    start < end
      ? minutesOfDay >= start && minutesOfDay < end
      : minutesOfDay >= start || minutesOfDay < end
  ));
}

function isWeekendTime(timestamp = Date.now()) {
  const weekday = getLocalDateParts(new Date(timestamp)).weekday.toLowerCase();
  return weekday === 'sat' || weekday === 'sun';
}

function getUsageTimeWeight(timestamp = Date.now()) {
  if (!isInActiveHours(timestamp)) return 0;
  if (isWeekendTime(timestamp)) {
    return USAGE_ALERT_WEEKDAYS_ONLY ? 0 : Math.max(0, USAGE_ALERT_WEEKEND_WEIGHT);
  }
  return 1;
}

function isUsageAlertBusinessTime(timestamp = Date.now()) {
  return getUsageTimeWeight(timestamp) > 0;
}

function getShortWindow(account) {
  return (account?.usage?.windows || []).find(window => window?.label === '5h' || window?.label === 'Day');
}

function getWeekWindow(account) {
  return (account?.usage?.windows || []).find(window => window?.label === 'Week');
}

async function sendTelegramUsageAlert(text) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) return { ok: false, skipped: true };
  const response = await fetchOpenAI(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: TELEGRAM_CHAT_ID,
      text,
      disable_web_page_preview: true,
    }),
  });
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Telegram alert failed: ${response.status} ${body}`.trim());
  }
  return { ok: true };
}

function formatPercent(value) {
  return `${Number(value).toFixed(1).replace(/\.0$/, '')}%`;
}

function formatHours(value) {
  return `${Number(value).toFixed(1).replace(/\.0$/, '')}h`;
}

function formatRate(value) {
  return `${Number(value).toFixed(2).replace(/\.00$/, '').replace(/(\.\d)0$/, '$1')}%/h`;
}

function formatResetAt(timestamp) {
  if (!Number.isFinite(Number(timestamp))) return 'unknown';
  return new Intl.DateTimeFormat('ru-RU', {
    timeZone: USAGE_ALERT_TIMEZONE,
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(Number(timestamp)));
}

function getBudgetMs(start, end) {
  const from = Number(start);
  const to = Number(end);
  if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) return 0;

  let countedMs = 0;
  let cursor = from;
  const stepMs = 15 * 60 * 1000;
  while (cursor < to) {
    const next = Math.min(to, cursor + stepMs);
    const midpoint = cursor + (next - cursor) / 2;
    countedMs += (next - cursor) * getUsageTimeWeight(midpoint);
    cursor = next;
  }
  return countedMs;
}

function getRemainingBudgetDays(now, resetAt) {
  const countedMs = getBudgetMs(now, resetAt);
  return countedMs > 0 ? countedMs / (24 * 60 * 60 * 1000) : null;
}

function getCurrentWeekCycleStart(resetAt) {
  const reset = Number(resetAt);
  return Number.isFinite(reset) && reset > 0 ? reset - 7 * 24 * 60 * 60 * 1000 : 0;
}

function getHistoryWeekSamples(slot, resetAt, now = Date.now()) {
  const cycleStart = getCurrentWeekCycleStart(resetAt);
  return loadHistory().snapshots
    .filter(snapshot => snapshot.timestamp >= cycleStart && snapshot.timestamp <= now)
    .map(snapshot => {
      const account = snapshot.accounts?.[slot];
      const week = (account?.windows || []).find(window => window?.label === 'Week');
      return week && Number.isFinite(Number(week.usedPercent))
        ? { at: snapshot.timestamp, weekPercent: Number(week.usedPercent) }
        : null;
    })
    .filter(Boolean);
}

function getHistoryShortSamples(slot, shortWindow, now = Date.now()) {
  const durationHours = Number.parseFloat(String(shortWindow?.label || '').match(/^(\d+(?:\.\d+)?)h$/i)?.[1] || '5');
  const resetAt = Number(shortWindow?.resetAt || 0);
  const cycleStart = resetAt > now
    ? resetAt - durationHours * 60 * 60 * 1000
    : now - durationHours * 60 * 60 * 1000;
  return loadHistory().snapshots
    .filter(snapshot => snapshot.timestamp >= cycleStart && snapshot.timestamp <= now)
    .map(snapshot => {
      const account = snapshot.accounts?.[slot];
      const short = (account?.windows || []).find(window => window?.label === shortWindow?.label);
      return short && Number.isFinite(Number(short.usedPercent))
        ? { at: snapshot.timestamp, weekPercent: Number(short.usedPercent) }
        : null;
    })
    .filter(Boolean);
}

function updatePaceSamples(state, slot, currentWeekPercent, resetAt, now = Date.now(), evidence = {}) {
  state.paceSamples = reconcilePaceSamples({
    storedSamples: Array.isArray(state.paceSamples) ? state.paceSamples : [],
    historySamples: getHistoryWeekSamples(slot, resetAt, now),
    now,
    cycleStart: getCurrentWeekCycleStart(resetAt),
    currentPercent: currentWeekPercent,
    previousRawPercent: evidence.previousRawPercent,
    currentRawPercent: evidence.currentRawPercent,
    resetConfirmed: evidence.resetConfirmed,
  });
  return state.paceSamples;
}

function buildUsageAlertState({ dateKey, now, currentWeekPercent, resetAt }) {
  const remainingBudgetDays = getRemainingBudgetDays(now, resetAt);
  const remainingWeekPercent = Math.max(0, 100 - currentWeekPercent);
  const safeRatePercentPerHour = remainingBudgetDays
    ? remainingWeekPercent / (remainingBudgetDays * 24)
    : DAILY_USAGE_LIMIT_PERCENT / 24;
  return {
    dateKey,
    baselineAt: now,
    baselineWeekPercent: currentWeekPercent,
    resetAt: Number.isFinite(Number(resetAt)) ? Number(resetAt) : null,
    remainingBudgetDaysAtBaseline: remainingBudgetDays,
    remainingWeekPercentAtBaseline: remainingWeekPercent,
    safeRatePercentPerHour,
    notifiedAt: null,
    notifiedRateMultiple: 0,
    lastSeenWeekPercent: currentWeekPercent,
    rawWeekPercent: currentWeekPercent,
    rawWeekPercentChangedAt: now,
    raw5hPercent: null,
    raw5hPercentChangedAt: now,
    empirical5hToWeekRatio: Number.isFinite(USAGE_ALERT_DEFAULT_5H_TO_WEEK_RATIO) && USAGE_ALERT_DEFAULT_5H_TO_WEEK_RATIO > 0
      ? USAGE_ALERT_DEFAULT_5H_TO_WEEK_RATIO
      : null,
    calibrationWeekPercent: currentWeekPercent,
    calibration5hPercent: null,
    estimatedWeekPercentFrom5h: currentWeekPercent,
  };
}

function getNextAlertMultiple(value) {
  const multiple = Number(value || 0);
  if (multiple >= 2) return multiple + 1;
  if (multiple >= 1.5) return 2;
  if (multiple >= 1) return 1.5;
  return 1;
}

function updateEmpiricalWeekEstimateState(state, rawWeekPercent, rawShortPercent, now) {
  if (!state || !Number.isFinite(Number(rawWeekPercent))) return;
  const currentWeek = Number(rawWeekPercent);
  const currentShort = Number(rawShortPercent);
  const previousWeek = Number(state.rawWeekPercent ?? state.lastSeenWeekPercent ?? currentWeek);

  if (!Number.isFinite(previousWeek) || currentWeek < previousWeek) {
    state.rawWeekPercent = currentWeek;
    state.rawWeekPercentChangedAt = now;
    state.raw5hPercent = Number.isFinite(currentShort) ? currentShort : null;
    state.raw5hPercentChangedAt = now;
    state.calibrationWeekPercent = currentWeek;
    state.calibration5hPercent = Number.isFinite(currentShort) ? currentShort : null;
    state.estimatedWeekPercentFrom5h = currentWeek;
    return;
  }

  if (Number.isFinite(currentShort)) {
    const anchorWeek = Number(state.calibrationWeekPercent ?? previousWeek);
    const anchorShort = Number(state.calibration5hPercent);

    if (!Number.isFinite(anchorShort) || currentShort < anchorShort) {
      state.calibrationWeekPercent = currentWeek;
      state.calibration5hPercent = currentShort;
    } else if (currentWeek > anchorWeek) {
      const weekDelta = currentWeek - anchorWeek;
      const shortDelta = currentShort - anchorShort;
      if (weekDelta > 0 && shortDelta >= weekDelta && shortDelta <= 80) {
        const observedRatio = weekDelta / shortDelta;
        const previousRatio = Number(state.empirical5hToWeekRatio);
        state.empirical5hToWeekRatio = Number.isFinite(previousRatio) && previousRatio > 0
          ? previousRatio * 0.75 + observedRatio * 0.25
          : observedRatio;
      }
      state.calibrationWeekPercent = currentWeek;
      state.calibration5hPercent = currentShort;
    }

    state.raw5hPercent = currentShort;
    state.raw5hPercentChangedAt = now;
  }

  if (currentWeek > previousWeek) {
    state.rawWeekPercent = currentWeek;
    state.rawWeekPercentChangedAt = now;
    state.estimatedWeekPercentFrom5h = currentWeek;
  }
}

function getEstimatedWeekPercent(rawWeekPercent, rawShortPercent, state) {
  const raw = Number(rawWeekPercent);
  if (!USAGE_ALERT_ESTIMATE_FRACTIONS || !Number.isFinite(raw)) return raw;
  const ratio = Number(state?.empirical5hToWeekRatio);
  const baseShort = Number(state?.calibration5hPercent ?? state?.raw5hPercent);
  if (!Number.isFinite(ratio) || ratio <= 0 || !Number.isFinite(baseShort) || !Number.isFinite(Number(rawShortPercent))) return raw;
  const shortDelta = rawShortPercent >= baseShort
    ? rawShortPercent - baseShort
    : rawShortPercent;
  const estimatedDelta = Math.max(0, shortDelta * ratio);
  const estimated = Math.min(100, raw + Math.min(0.95, estimatedDelta));
  if (state) state.estimatedWeekPercentFrom5h = estimated;
  return estimated;
}

function isLikelyTransientWeekZero(state, rawWeekPercent, now = Date.now()) {
  const raw = Number(rawWeekPercent);
  const last = Number(state?.lastSeenWeekPercent ?? state?.rawWeekPercent ?? state?.baselineWeekPercent);
  const storedResetAt = Number(state?.resetAt || 0);
  const resetWindowReached = Number.isFinite(storedResetAt) && storedResetAt > 0
    ? now >= storedResetAt - 10 * 60 * 1000
    : false;
  return Number.isFinite(raw)
    && raw <= 1
    && Number.isFinite(last)
    && last >= 20
    && !resetWindowReached;
}

function isLikelyTransientWeekRebound(state, rawWeekPercent, now) {
  const raw = Number(rawWeekPercent);
  const baseline = Number(state?.baselineWeekPercent);
  const previousRaw = Number(state?.rawWeekPercent);
  const elapsedHours = getBudgetMs(Number(state?.baselineAt || now), now) / (60 * 60 * 1000);
  return Number.isFinite(raw)
    && Number.isFinite(baseline)
    && Number.isFinite(previousRaw)
    && raw - baseline >= 20
    && previousRaw <= 1
    && elapsedHours > 0
    && elapsedHours < 6;
}

function rebaselineAlertState(state, rawWeekPercent, rawShortPercent, now, resetAt) {
  state.baselineAt = now;
  state.baselineWeekPercent = rawWeekPercent;
  state.resetAt = Number.isFinite(Number(resetAt)) ? Number(resetAt) : state.resetAt;
  state.remainingBudgetDaysAtBaseline = getRemainingBudgetDays(now, resetAt);
  state.remainingWeekPercentAtBaseline = Math.max(0, 100 - rawWeekPercent);
  state.safeRatePercentPerHour = state.remainingBudgetDaysAtBaseline
    ? state.remainingWeekPercentAtBaseline / (state.remainingBudgetDaysAtBaseline * 24)
    : DAILY_USAGE_LIMIT_PERCENT / 24;
  state.notifiedAt = null;
  state.notifiedRateMultiple = 0;
  state.lastSeenWeekPercent = rawWeekPercent;
  state.rawWeekPercent = rawWeekPercent;
  state.rawWeekPercentChangedAt = now;
  state.raw5hPercent = Number.isFinite(Number(rawShortPercent)) ? rawShortPercent : state.raw5hPercent ?? null;
  state.raw5hPercentChangedAt = now;
  state.calibrationWeekPercent = rawWeekPercent;
  state.calibration5hPercent = Number.isFinite(Number(rawShortPercent)) ? rawShortPercent : state.raw5hPercent ?? null;
  state.estimatedWeekPercentFrom5h = rawWeekPercent;
}

function getCodexUsageAlertMetrics(slot, account) {
  const weekWindow = getWeekWindow(account);
  const shortWindow = getShortWindow(account);
  if (!weekWindow || !Number.isFinite(Number(weekWindow.usedPercent))) return null;

  const now = Date.now();
  const alerts = loadAlerts();
  const state = alerts.slots?.[slot] || null;
  const rawWeekPercent = Number(weekWindow.usedPercent);
  const rawShortPercent = Number(shortWindow?.usedPercent);
  const displayWeekPercent = isLikelyTransientWeekZero(state, rawWeekPercent)
    ? Number(state?.lastSeenWeekPercent ?? state?.rawWeekPercent ?? rawWeekPercent)
    : rawWeekPercent;
  const currentWeekPercent = getEstimatedWeekPercent(displayWeekPercent, rawShortPercent, state);
  const resetAt = Number(weekWindow.resetAt || 0) || null;
  const remainingWeekPercent = Math.max(0, 100 - currentWeekPercent);
  const remainingBudgetHours = getBudgetMs(now, resetAt) / (60 * 60 * 1000);
  const totalBudgetHours = getBudgetMs(getCurrentWeekCycleStart(resetAt), resetAt) / (60 * 60 * 1000);
  const remainingTimePercent = calculateRemainingTimePercent(remainingBudgetHours, totalBudgetHours);
  const safeRatePercentPerHour = remainingBudgetHours > 0
    ? remainingWeekPercent / remainingBudgetHours
    : Number(state?.safeRatePercentPerHour || DAILY_USAGE_LIMIT_PERCENT / 24);
  const baselineAt = Number(state?.baselineAt || now);
  const baselineWeekPercent = Number(state?.baselineWeekPercent ?? currentWeekPercent);
  const elapsedHours = Math.max(0, getBudgetMs(baselineAt, now) / (60 * 60 * 1000));
  const spentSinceBaselinePercent = Math.max(0, currentWeekPercent - baselineWeekPercent);
  const storedSamples = Array.isArray(state?.paceSamples) && state.paceSamples.length
    ? state.paceSamples
    : [{ at: baselineAt, weekPercent: baselineWeekPercent }];
  const paceSamples = [...storedSamples];
  const latestSample = paceSamples.at(-1);
  if (!latestSample || Number(latestSample.at) < now) paceSamples.push({ at: now, weekPercent: currentWeekPercent });
  const wallClockHours = (from, to) => Math.max(0, Number(to) - Number(from)) / (60 * 60 * 1000);
  const recentPace = calculateUsageRate({
    samples: paceSamples,
    now,
    currentWeekPercent,
    targetHours: RECENT_PACE_HOURS,
    elapsedHours: wallClockHours,
  });
  const { dateKey: currentDateKey } = getLocalDateParts(new Date(now));
  const todaySamples = paceSamples.filter(sample => getLocalDateParts(new Date(Number(sample.at))).dateKey === currentDateKey);
  const todayPace = calculateUsageRate({
    samples: todaySamples,
    now,
    currentWeekPercent,
    targetHours: Number.MAX_SAFE_INTEGER,
    elapsedHours: wallClockHours,
  });
  const recentRateAvailable = isUsageRateAvailable(recentPace.elapsedHours, MIN_PACE_ELAPSED_HOURS);
  const actualRatePercentPerHour = recentRateAvailable ? recentPace.ratePercentPerHour : null;
  const rateMultiple = actualRatePercentPerHour !== null && safeRatePercentPerHour > 0 ? actualRatePercentPerHour / safeRatePercentPerHour : null;
  const projectedExhaustionHours = projectExhaustionHours({
    now,
    remainingPercent: remainingWeekPercent,
    ratePercentPerBudgetHour: actualRatePercentPerHour,
    budgetWeightAt: getUsageTimeWeight,
  });
  const fast = actualRatePercentPerHour !== null
    && actualRatePercentPerHour >= safeRatePercentPerHour * USAGE_ALERT_BURN_RATE_MULTIPLIER
    && actualRatePercentPerHour - safeRatePercentPerHour >= USAGE_ALERT_MIN_RATE_OVER_PERCENT_PER_HOUR;
  const slow = actualRatePercentPerHour !== null
    && actualRatePercentPerHour < safeRatePercentPerHour * USAGE_ALERT_SLOW_RATE_MULTIPLIER;
  const status = fast ? 'fast' : slow ? 'slow' : 'ok';

  let shortWindowMetrics = null;
  if (shortWindow && Number.isFinite(rawShortPercent)) {
    const shortResetAt = Number(shortWindow.resetAt || 0) || null;
    const shortRemainingPercent = Math.max(0, 100 - rawShortPercent);
    const shortRemainingHours = shortResetAt
      ? Math.max(0, (shortResetAt - now) / (60 * 60 * 1000))
      : 0;
    const shortDurationHours = Number.parseFloat(String(shortWindow.label || '').match(/^(\d+(?:\.\d+)?)h$/i)?.[1] || '5');
    const shortRemainingTimePercent = calculateRemainingTimePercent(shortRemainingHours, shortDurationHours);
    const shortSamples = getHistoryShortSamples(slot, shortWindow, now);
    const shortLatest = shortSamples.at(-1);
    if (!shortLatest || Number(shortLatest.at) < now) {
      shortSamples.push({ at: now, weekPercent: rawShortPercent });
    }
    const currentShortSamples = getLatestMonotonicSegment(shortSamples);
    const shortPace = calculateUsageRate({
      samples: currentShortSamples,
      now,
      currentWeekPercent: rawShortPercent,
      targetHours: SHORT_WINDOW_PACE_HOURS,
      elapsedHours: (from, to) => Math.max(0, to - from) / (60 * 60 * 1000),
    });
    const shortRateAvailable = isUsageRateAvailable(shortPace.elapsedHours, MIN_PACE_ELAPSED_HOURS);
    const shortActualRate = shortRateAvailable ? shortPace.ratePercentPerHour : null;
    const shortSafeRate = shortRemainingHours > 0
      ? shortRemainingPercent / shortRemainingHours
      : 0;
    const shortRateMultiple = shortActualRate !== null && shortSafeRate > 0
      ? shortActualRate / shortSafeRate
      : null;
    const shortProjectedExhaustionHours = shortActualRate !== null && shortActualRate > 0
      ? shortRemainingPercent / shortActualRate
      : null;
    const shortWillExhaust = shortProjectedExhaustionHours !== null
      && shortRemainingHours > 0
      && shortProjectedExhaustionHours < shortRemainingHours;
    const shortStatus = shortWillExhaust
      ? 'bad'
      : rawShortPercent >= 80 || (shortRateMultiple !== null && shortRateMultiple >= 0.8)
        ? 'warn'
        : 'good';

    shortWindowMetrics = {
      label: shortWindow.label,
      resetAt: shortResetAt,
      usedPercent: rawShortPercent,
      remainingPercent: shortRemainingPercent,
      remainingHours: shortRemainingHours,
      remainingTimePercent: shortRemainingTimePercent,
      recentWindowTargetHours: SHORT_WINDOW_PACE_HOURS,
      recentWindowHours: shortPace.elapsedHours,
      recentWarmingUp: shortPace.warmingUp,
      recentRateAvailable: shortRateAvailable,
      actualRatePercentPerHour: shortActualRate,
      safeRatePercentPerHour: shortSafeRate,
      rateMultiple: shortRateMultiple,
      projectedExhaustionHours: shortProjectedExhaustionHours,
      willExhaustBeforeReset: shortWillExhaust,
      status: shortStatus,
    };
  }

  return {
    resetAt,
    currentWeekPercent,
    rawWeekPercent,
    rawShortPercent: Number.isFinite(rawShortPercent) ? rawShortPercent : null,
    empirical5hToWeekRatio: Number.isFinite(Number(state?.empirical5hToWeekRatio)) ? Number(state.empirical5hToWeekRatio) : null,
    estimated: USAGE_ALERT_ESTIMATE_FRACTIONS && Math.abs(currentWeekPercent - rawWeekPercent) >= 0.01,
    remainingWeekPercent,
    remainingBudgetHours,
    remainingTimePercent,
    baselineAt,
    baselineWeekPercent,
    elapsedHours,
    spentSinceBaselinePercent,
    recentWindowTargetHours: RECENT_PACE_HOURS,
    recentWindowHours: recentPace.elapsedHours,
    recentWarmingUp: recentPace.warmingUp,
    recentRateAvailable,
    todayRatePercentPerHour: todayPace.ratePercentPerHour,
    todayElapsedHours: todayPace.elapsedHours,
    safeRatePercentPerHour,
    actualRatePercentPerHour,
    rateMultiple,
    projectedExhaustionHours,
    alertMultiplier: USAGE_ALERT_BURN_RATE_MULTIPLIER,
    slowMultiplier: USAGE_ALERT_SLOW_RATE_MULTIPLIER,
    activeHours: USAGE_ALERT_ACTIVE_HOURS,
    weekendWeight: USAGE_ALERT_WEEKDAYS_ONLY ? 0 : USAGE_ALERT_WEEKEND_WEIGHT,
    status,
    shortWindow: shortWindowMetrics,
  };
}

async function maybeSendCodexDailyUsageAlert(slot, account) {
  const weekWindow = getWeekWindow(account);
  const shortWindow = getShortWindow(account);
  if (!weekWindow || !Number.isFinite(Number(weekWindow.usedPercent))) return;

  const now = Date.now();
  const { dateKey } = getLocalDateParts(new Date(now));
  const alerts = loadAlerts();
  alerts.slots ||= {};
  let state = alerts.slots[slot];
  const rawWeekPercent = Number(weekWindow.usedPercent);
  const rawShortPercent = Number(shortWindow?.usedPercent);
  const resetAt = Number(weekWindow.resetAt || 0) || null;

  const previousBaselinePercent = Number(state?.baselineWeekPercent ?? state?.baseWeekPercent ?? NaN);
  const resetMoved = Boolean(resetAt && state?.resetAt && Math.abs(resetAt - Number(state.resetAt)) > 60 * 60 * 1000);
  if (state && isLikelyTransientWeekZero(state, rawWeekPercent)) {
    state.transientWeekZeroSeenAt ||= now;
    alerts.slots[slot] = state;
    saveAlerts(alerts);
    return;
  }
  if (state && rawWeekPercent > 1 && state.transientWeekZeroSeenAt) {
    delete state.transientWeekZeroSeenAt;
  }
  if (
    !state
    || (rawWeekPercent < previousBaselinePercent && resetMoved)
  ) {
    state = buildUsageAlertState({ dateKey, now, currentWeekPercent: rawWeekPercent, resetAt });
    alerts.slots[slot] = state;
    saveAlerts(alerts);
    return;
  }

  if (
    !Number.isFinite(Number(state.baselineAt))
    || !Number.isFinite(Number(state.baselineWeekPercent))
    || !Number.isFinite(Number(state.safeRatePercentPerHour))
    || (resetAt && !state.resetAt)
  ) {
    const migrated = buildUsageAlertState({
      dateKey,
      now,
      currentWeekPercent: Number(state.baseWeekPercent ?? state.baselineWeekPercent ?? rawWeekPercent),
      resetAt,
    });
    state = {
      ...state,
      ...migrated,
      notifiedAt: state.notifiedAt || null,
      notifiedRateMultiple: state.notifiedRateMultiple || 0,
      lastSeenWeekPercent: currentWeekPercent,
    };
    alerts.slots[slot] = state;
  }

  state.dateKey = dateKey;
  if (isLikelyTransientWeekRebound(state, rawWeekPercent, now)) {
    rebaselineAlertState(state, rawWeekPercent, rawShortPercent, now, resetAt);
    alerts.slots[slot] = state;
    saveAlerts(alerts);
    return;
  }
  const previousRawWeekPercent = Number(state.rawWeekPercent ?? state.lastSeenWeekPercent ?? rawWeekPercent);
  updateEmpiricalWeekEstimateState(state, rawWeekPercent, rawShortPercent, now);
  const currentWeekPercent = getEstimatedWeekPercent(rawWeekPercent, rawShortPercent, state);
  updatePaceSamples(state, slot, currentWeekPercent, resetAt, now, {
    previousRawPercent: previousRawWeekPercent,
    currentRawPercent: rawWeekPercent,
  });
  state.lastSeenWeekPercent = currentWeekPercent;
  const baselineAt = Number(state.baselineAt || now);
  const elapsedHours = Math.max(0, getBudgetMs(baselineAt, now) / (60 * 60 * 1000));
  const spentSinceBaselinePercent = Math.max(0, currentWeekPercent - Number(state.baselineWeekPercent || 0));
  const remainingWeekPercent = Math.max(0, 100 - currentWeekPercent);
  const remainingBudgetHours = getBudgetMs(now, resetAt) / (60 * 60 * 1000);
  const safeRatePercentPerHour = remainingBudgetHours > 0
    ? remainingWeekPercent / remainingBudgetHours
    : Number(state.safeRatePercentPerHour || DAILY_USAGE_LIMIT_PERCENT / 24);
  state.safeRatePercentPerHour = safeRatePercentPerHour;

  if (elapsedHours <= 0 || spentSinceBaselinePercent < USAGE_ALERT_MIN_SPENT_PERCENT) {
    saveAlerts(alerts);
    return;
  }

  const actualRatePercentPerHour = spentSinceBaselinePercent / elapsedHours;
  const rateOverPercentPerHour = actualRatePercentPerHour - safeRatePercentPerHour;
  const rateMultiple = safeRatePercentPerHour > 0 ? actualRatePercentPerHour / safeRatePercentPerHour : Infinity;
  const nextRateMultiple = getNextAlertMultiple(state.notifiedRateMultiple);
  const rateExceeded = actualRatePercentPerHour >= safeRatePercentPerHour * USAGE_ALERT_BURN_RATE_MULTIPLIER
    && rateOverPercentPerHour >= USAGE_ALERT_MIN_RATE_OVER_PERCENT_PER_HOUR
    && rateMultiple >= nextRateMultiple;

  if (!isUsageAlertBusinessTime(now) || !rateExceeded) {
    saveAlerts(alerts);
    return;
  }

  const projectedExhaustionHours = actualRatePercentPerHour > 0
    ? remainingWeekPercent / actualRatePercentPerHour
    : null;
  const resetHours = remainingBudgetHours || null;
  const email = account.email ? ` (${account.email})` : '';
  const text = [
    `⚠️ Codex${email}: burn rate is too high.`,
    `${formatPercent(remainingWeekPercent)} left until reset at ${formatResetAt(resetAt)} (${resetHours ? formatHours(resetHours) : 'time unknown'}).`,
    `Safe: ${formatRate(safeRatePercentPerHour)}; current: ${formatRate(actualRatePercentPerHour)} (${rateMultiple.toFixed(1)}×).`,
    projectedExhaustionHours !== null
      ? `At this pace the limit will run out in ${formatHours(projectedExhaustionHours)}.`
      : `Exhaustion projection is unavailable because current spend is zero.`,
    `Kesa hisses: reduce the burn rate, human.`,
  ].join('\n');
  await sendTelegramUsageAlert(text);
  state.notifiedAt = now;
  state.notifiedSpentSinceBaselinePercent = spentSinceBaselinePercent;
  state.notifiedRateMultiple = nextRateMultiple;
  saveAlerts(alerts);
}

function loadClaudeCodeState() {
  try {
    if (fs.existsSync(CLAUDE_STATE_PATH)) {
      return JSON.parse(fs.readFileSync(CLAUDE_STATE_PATH, 'utf8'));
    }
  } catch {}
  return null;
}

function saveClaudeCodeState(state) {
  ensureStore();
  fs.writeFileSync(CLAUDE_STATE_PATH, JSON.stringify(state, null, 2) + '\n', 'utf8');
}

function loadOpenCodeGoState() {
  try {
    if (fs.existsSync(OPENCODE_GO_STATE_PATH)) {
      return JSON.parse(fs.readFileSync(OPENCODE_GO_STATE_PATH, 'utf8'));
    }
  } catch {}
  return null;
}

function saveOpenCodeGoState(state) {
  ensureStore();
  fs.writeFileSync(OPENCODE_GO_STATE_PATH, JSON.stringify(state, null, 2) + '\n', 'utf8');
}

const DEFAULT_CURSOR_STATE = {
  configured: false,
  plan: 'Cursor',
  monthlyCost: null,
  currency: 'USD',
  renewalDate: null,
  usage: null,
  usageHistory: [],
  lastCheckedAt: null,
  lastError: null,
};

function loadCursorSubscriptionState() {
  try {
    if (fs.existsSync(CURSOR_STATE_PATH)) {
      const parsed = JSON.parse(fs.readFileSync(CURSOR_STATE_PATH, 'utf8'));
      return { ...DEFAULT_CURSOR_STATE, ...parsed };
    }
  } catch {}
  return { ...DEFAULT_CURSOR_STATE };
}

function saveCursorSubscriptionState(state) {
  ensureStore();
  fs.writeFileSync(CURSOR_STATE_PATH, JSON.stringify(state, null, 2) + '\n', 'utf8');
}

function sanitizeCursorSubscription(state = loadCursorSubscriptionState()) {
  if (!state?.configured) return null;
  const usage = state.usage
    ? {
        ...state.usage,
        pace: state.usage.pace || buildCursorUsagePace({
          usage: state.usage,
          samples: state.usageHistory,
          now: Date.now(),
        }),
      }
    : null;
  return {
    configured: true,
    plan: state.plan || 'Cursor',
    monthlyCost: Number.isFinite(Number(state.monthlyCost)) ? Number(state.monthlyCost) : null,
    currency: state.currency || 'USD',
    renewalDate: state.renewalDate || null,
    usage,
    lastCheckedAt: state.lastCheckedAt || null,
    lastError: state.lastError || null,
  };
}

function readCursorAccessToken() {
  if (CURSOR_ACCESS_TOKEN) return CURSOR_ACCESS_TOKEN;
  try {
    if (!CURSOR_AUTH_PATH || !fs.existsSync(CURSOR_AUTH_PATH)) return null;
    const auth = JSON.parse(fs.readFileSync(CURSOR_AUTH_PATH, 'utf8'));
    return typeof auth?.accessToken === 'string' && auth.accessToken.trim()
      ? auth.accessToken.trim()
      : null;
  } catch {
    return null;
  }
}

function appendSnapshot() {
  const history = loadHistory();
  const now = Date.now();

  // Don't store more than one snapshot per 5 minutes
  const lastTs = history.snapshots.length > 0
    ? history.snapshots[history.snapshots.length - 1].timestamp
    : 0;
  if (now - lastTs < 5 * 60 * 1000) return;

  const store = loadStore();
  const accounts = {};
  for (const [slot, account] of Object.entries(store.accounts)) {
    if (!account || !account.usage) continue;
    accounts[slot] = {
      email: account.email || null,
      windows: (account.usage.windows || []).map(w => ({
        label: w.label,
        usedPercent: w.usedPercent,
      })),
    };
  }
  const claude = loadClaudeCodeState();
  if (claude?.usage) {
    accounts[CLAUDE_SLOT] = {
      email: claude.email || 'Claude Code',
      windows: (claude.usage.windows || []).map(w => ({
        label: w.label,
        usedPercent: w.usedPercent,
      })),
    };
  }
  const opencodeGo = loadOpenCodeGoState();
  if (opencodeGo?.usage) {
    accounts[OPENCODE_GO_SLOT] = {
      email: opencodeGo.email || 'OpenCode Go',
      windows: (opencodeGo.usage.windows || []).map(w => ({
        label: w.label,
        usedPercent: w.usedPercent,
      })),
    };
  }

  if (Object.keys(accounts).length > 0) {
    history.snapshots.push({ timestamp: now, accounts });
  }

  // Prune entries older than 30 days
  const cutoff = now - MAX_HISTORY_AGE_MS;
  history.snapshots = history.snapshots.filter(s => s.timestamp > cutoff);

  saveHistory(history);
}

function json(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

function sendHtml(res, status, html) {
  res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
}

function maskEmail(email) {
  if (!email || !email.includes('@')) return null;
  const [name, domain] = email.split('@');
  if (!name || !domain) return email;
  if (name.length <= 3) return `${name}*@${domain}`;
  return `${name.slice(0, 4)}***@${domain}`;
}

function base64urlEncode(buffer) {
  return buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

async function generatePKCE() {
  const verifier = base64urlEncode(crypto.randomBytes(32));
  const challenge = base64urlEncode(crypto.createHash('sha256').update(verifier).digest());
  return { verifier, challenge };
}

function createState() {
  return crypto.randomBytes(16).toString('hex');
}

function decodeJwt(token) {
  try {
    const parts = String(token || '').split('.');
    if (parts.length !== 3) return null;
    const payload = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = payload + '='.repeat((4 - (payload.length % 4 || 4)) % 4);
    return JSON.parse(Buffer.from(padded, 'base64').toString('utf8'));
  } catch {
    return null;
  }
}

function getCursorCliVersion() {
  try {
    const output = execFileSync('cursor-agent', ['--version'], {
      encoding: 'utf8',
      timeout: 3000,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    const match = output.match(/([0-9]+\.[0-9]+\.[0-9]+(?:-[^\s]+)?)/);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

function getClaudeCliVersion() {
  try {
    const output = execFileSync('claude', ['--version'], {
      encoding: 'utf8',
      timeout: 3000,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    const match = output.match(/^([^\s]+)/);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

function readClaudeCredentialsFile() {
  try {
    if (!CLAUDE_CREDENTIALS_PATH || !fs.existsSync(CLAUDE_CREDENTIALS_PATH)) return null;
    const raw = JSON.parse(fs.readFileSync(CLAUDE_CREDENTIALS_PATH, 'utf8'));
    const creds = raw?.claudeAiOauth;
    if (!creds || typeof creds !== 'object') return null;
    return { raw, creds };
  } catch {
    return null;
  }
}

function writeClaudeCredentialsFile(raw) {
  fs.writeFileSync(CLAUDE_CREDENTIALS_PATH, JSON.stringify(raw, null, 2) + '\n', 'utf8');
}

function getClaudeAuthStatus() {
  try {
    const output = execFileSync('claude', ['auth', 'status', '--json'], {
      encoding: 'utf8',
      timeout: 5000,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return JSON.parse(output);
  } catch (err) {
    return { loggedIn: false, error: String(err?.message || err) };
  }
}

async function refreshClaudeCredentialsIfNeeded(credsInfo) {
  if (!credsInfo?.creds?.refreshToken) return credsInfo?.creds || null;
  const creds = credsInfo.creds;
  const expiresAt = Number(creds.expiresAt || 0);
  if (creds.accessToken && expiresAt && Date.now() < expiresAt - 60_000) return creds;

  const response = await fetchOpenAI(CLAUDE_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': CLAUDE_USER_AGENT,
    },
    body: JSON.stringify({
      grant_type: 'refresh_token',
      refresh_token: creds.refreshToken,
      client_id: CLAUDE_CLIENT_ID,
      scope: Array.isArray(creds.scopes) ? creds.scopes.join(' ') : undefined,
    }),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Claude token refresh failed: ${response.status} ${text}`.trim());
  }

  const json = await response.json();
  if (!json.access_token || typeof json.expires_in !== 'number') {
    throw new Error('Claude token refresh response missing fields');
  }

  const updated = {
    ...creds,
    accessToken: json.access_token,
    refreshToken: json.refresh_token || creds.refreshToken,
    expiresAt: Date.now() + json.expires_in * 1000,
    scopes: json.scope ? String(json.scope).split(/\s+/).filter(Boolean) : creds.scopes,
  };
  credsInfo.raw.claudeAiOauth = updated;
  writeClaudeCredentialsFile(credsInfo.raw);
  return updated;
}

function numberFromAny(...values) {
  for (const value of values) {
    if (value === null || value === undefined || value === '') continue;
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function normalizeClaudeUsageWindow(label, data) {
  if (!data || typeof data !== 'object') return null;
  const usedPercent = numberFromAny(data.used_percentage, data.usedPercent, data.used_percent, data.utilization);
  const resetValue = data.resets_at ?? data.reset_at ?? data.resetsAt ?? data.resetAt;
  const resetSeconds = numberFromAny(resetValue);
  const resetAt = resetSeconds
    ? resetSeconds * 1000
    : typeof resetValue === 'string'
      ? Date.parse(resetValue)
      : null;
  if (usedPercent === null) return null;
  return {
    label,
    usedPercent,
    resetAt: Number.isFinite(resetAt) ? resetAt : null,
  };
}

function toClaudeUsageSnapshot(data, plan) {
  const rateLimits = data?.rate_limits || data?.rateLimits || data?.usage?.rate_limits || data?.usage?.rateLimits || data || {};
  const windows = [
    normalizeClaudeUsageWindow('5h', rateLimits.five_hour || rateLimits.fiveHour || rateLimits['5h']),
    normalizeClaudeUsageWindow('Week', rateLimits.seven_day || rateLimits.sevenDay || rateLimits.weekly || rateLimits.week),
  ].filter(Boolean);
  return { plan, windows, raw: data };
}

async function fetchClaudeUsage(creds, plan) {
  if (!creds?.accessToken) return { plan, windows: [] };
  const response = await fetchOpenAI(CLAUDE_USAGE_URL, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${creds.accessToken}`,
      'Content-Type': 'application/json',
      'anthropic-beta': CLAUDE_BETA,
      'User-Agent': CLAUDE_USER_AGENT,
      Accept: 'application/json',
    },
  });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    const err = new Error(`Claude usage request failed: ${response.status} ${text}`.trim());
    err.status = response.status;
    const retryAfter = Number(response.headers.get('retry-after') || 0);
    if (Number.isFinite(retryAfter) && retryAfter > 0) {
      err.retryAfterMs = retryAfter * 1000;
    }
    throw err;
  }
  return toClaudeUsageSnapshot(await response.json(), plan);
}

async function fetchClaudeProfile(creds) {
  if (!creds?.accessToken) return null;
  const response = await fetchOpenAI(CLAUDE_PROFILE_URL, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${creds.accessToken}`,
      'Content-Type': 'application/json',
      'anthropic-beta': CLAUDE_BETA,
      'User-Agent': CLAUDE_USER_AGENT,
      Accept: 'application/json',
    },
  });
  if (!response.ok) return null;
  return response.json();
}

function getOpenCodeGoApiKey(state = loadOpenCodeGoState()) {
  return OPENCODE_GO_API_KEY || state?.apiKey || '';
}

function hasOpenCodeGoConsoleCredentials(state = loadOpenCodeGoState()) {
  return Boolean(
    (state?.workspaceId || process.env.OPENCODE_GO_WORKSPACE_ID) &&
    (state?.authToken || process.env.OPENCODE_GO_AUTH_TOKEN),
  );
}

function getOpenCodeModelCost(modelID, providerID) {
  const normalizedModelID = String(modelID || '').replace(/^opencode-go\//, '');
  const configured = OPENCODE_GO_MODEL_COSTS[normalizedModelID];
  if (configured) return configured;

  try {
    if (!OPENCODE_MODELS_PATH || !fs.existsSync(OPENCODE_MODELS_PATH)) return null;
    const models = JSON.parse(fs.readFileSync(OPENCODE_MODELS_PATH, 'utf8'));
    return models?.[providerID]?.models?.[normalizedModelID]?.cost || null;
  } catch {
    return null;
  }
}

function calculateOpenCodeGoMessageCost(data) {
  const directCost = Number(data?.cost);
  if (Number.isFinite(directCost) && directCost > 0) return directCost;

  const providerID = String(data?.providerID || data?.model?.providerID || OPENCODE_GO_SLOT);
  const rawModel = String(data?.modelID || data?.model?.modelID || '');
  const cost = getOpenCodeModelCost(rawModel, providerID);
  if (!cost) return 0;

  const tokens = data?.tokens || {};
  const cache = tokens.cache || {};
  const input = Number(tokens.input || 0);
  const output = Number(tokens.output || 0);
  const cacheRead = Number(cache.read || tokens.cacheRead || 0);
  const cacheWrite = Number(cache.write || tokens.cacheWrite || 0);

  return (
    (input * (cost.input || 0)) +
    (output * (cost.output || 0)) +
    (cacheRead * (cost.cache_read || 0)) +
    (cacheWrite * (cost.cache_write || 0))
  ) / 1_000_000;
}

function readOpenCodeGoEvents() {
  if (!OPENCODE_GO_DB_PATH || !fs.existsSync(OPENCODE_GO_DB_PATH)) return [];
  let rows;
  try {
    const output = execFileSync('sqlite3', [
      '-json',
      OPENCODE_GO_DB_PATH,
      "select time_created, data from message where json_extract(data,'$.role')='assistant' and (json_extract(data,'$.providerID') in ('opencode','opencode-go') or json_extract(data,'$.model.providerID') in ('opencode','opencode-go'))",
    ], {
      encoding: 'utf8',
      timeout: 5000,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    rows = JSON.parse(output || '[]');
  } catch {
    return [];
  }

  return rows.map(row => {
    try {
      const data = JSON.parse(row.data || '{}');
      const tokens = data?.tokens || {};
      const cache = tokens.cache || {};
      const cost = calculateOpenCodeGoMessageCost(data);
      return {
        timestamp: Number(row.time_created || data?.time?.completed || data?.time?.created || 0),
        providerID: String(data?.providerID || data?.model?.providerID || ''),
        modelID: String(data?.modelID || data?.model?.modelID || ''),
        inputTokens: Number(tokens.input || 0),
        outputTokens: Number(tokens.output || 0),
        cacheReadTokens: Number(cache.read || tokens.cacheRead || 0),
        cost,
      };
    } catch {
      return null;
    }
  }).filter(event => event && Number.isFinite(event.timestamp) && event.timestamp > 0 && OPENCODE_PROVIDER_IDS.has(event.providerID));
}

function buildOpenCodeGoUsage() {
  const events = readOpenCodeGoEvents();
  const billableEvents = events.filter(event => event.cost > 0);
  const inputTokens = events.reduce((sum, event) => sum + event.inputTokens, 0);
  const outputTokens = events.reduce((sum, event) => sum + event.outputTokens, 0);
  const cacheReadTokens = events.reduce((sum, event) => sum + event.cacheReadTokens, 0);
  const totalCost = events.reduce((sum, event) => sum + event.cost, 0);
  const summary = {
    eventCount: events.length,
    billableEventCount: billableEvents.length,
    inputTokens,
    outputTokens,
    cacheReadTokens,
    totalTokens: inputTokens + outputTokens + cacheReadTokens,
    totalCost,
  };
  return { usage: { plan: 'Go (API key only)', windows: [], summary }, eventCount: events.length };
}

function decodeHtmlEntities(value) {
  return String(value || '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function htmlToText(value) {
  return decodeHtmlEntities(
    String(value || '')
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, '')
      .replace(/\s+/g, ' ')
      .trim(),
  );
}

function parseResetTextToMs(resetText) {
  const text = String(resetText || '').toLowerCase();
  const units = [
    { re: /(\d+(?:\.\d+)?)\s*(?:d|day|days)\b/g, ms: 24 * 60 * 60 * 1000 },
    { re: /(\d+(?:\.\d+)?)\s*(?:h|hr|hrs|hour|hours)\b/g, ms: 60 * 60 * 1000 },
    { re: /(\d+(?:\.\d+)?)\s*(?:m|min|mins|minute|minutes)\b/g, ms: 60 * 1000 },
    { re: /(\d+(?:\.\d+)?)\s*(?:s|sec|secs|second|seconds)\b/g, ms: 1000 },
  ];
  let total = 0;
  for (const unit of units) {
    let match;
    while ((match = unit.re.exec(text))) total += Number(match[1]) * unit.ms;
  }
  return total > 0 ? total : null;
}

function parseOpenCodeGoUsageItems(html) {
  const usageMatch = String(html || '').match(/<div[^>]*data-slot=["']usage["'][^>]*>([\s\S]*?)<\/div>\s*<\/section>/i);
  if (!usageMatch) return [];

  const windows = [];
  const itemPattern = /<div[^>]*data-slot=["']usage-item["'][^>]*>([\s\S]*?)(?=<div[^>]*data-slot=["']usage-item["']|<\/div>\s*<\/div>\s*<form|$)/gi;
  let itemMatch;
  while ((itemMatch = itemPattern.exec(usageMatch[1]))) {
    const itemHtml = itemMatch[1];
    const labelText = htmlToText((itemHtml.match(/<span[^>]*data-slot=["']usage-label["'][^>]*>([\s\S]*?)<\/span>/i) || [])[1]);
    const valueText = htmlToText((itemHtml.match(/<span[^>]*data-slot=["']usage-value["'][^>]*>([\s\S]*?)<\/span>/i) || [])[1]);
    const resetFullText = htmlToText((itemHtml.match(/<span[^>]*data-slot=["']reset-time["'][^>]*>([\s\S]*?)<\/span>/i) || [])[1]);
    const percent = numberFromAny(String(valueText).replace('%', ''));
    if (!labelText || percent === null) continue;

    const resetText = resetFullText.replace(/^resets\s+in\s+/i, '').trim();
    const resetMs = parseResetTextToMs(resetText);
    const normalizedLabel = /rolling/i.test(labelText)
      ? '5h'
      : /week/i.test(labelText)
        ? 'Week'
        : /month/i.test(labelText)
          ? 'Month'
          : labelText;

    windows.push({
      label: normalizedLabel,
      usedPercent: percent,
      resetAt: resetMs ? Date.now() + resetMs : null,
      resetText: resetText || null,
      source: 'console',
    });
  }
  return windows;
}

function parseOpenCodeGoConsoleUsage(html) {
  const itemWindows = parseOpenCodeGoUsageItems(html);
  if (itemWindows.length) return { plan: 'Go', windows: itemWindows };

  const usageMatch = String(html || '').match(/<div[^>]*data-slot=["']usage["'][^>]*>([\s\S]*?)<\/div>\s*<\/section>/i);
  if (!usageMatch) return null;
  const text = htmlToText(usageMatch[1]);
  const pattern = /(Rolling|Weekly|Monthly)\s+Usage\s+(\d+(?:\.\d+)?)%\s+Resets in\s+(.*?)(?=Rolling\s+Usage|Weekly\s+Usage|Monthly\s+Usage|$)/gi;
  const windows = [];
  let match;
  while ((match = pattern.exec(text))) {
    const [, kind, percent, resetText] = match;
    const resetMs = parseResetTextToMs(resetText);
    windows.push({
      label: kind === 'Rolling' ? '5h' : kind === 'Weekly' ? 'Week' : 'Month',
      usedPercent: Number(percent),
      resetAt: resetMs ? Date.now() + resetMs : null,
      resetText: resetText.trim(),
      source: 'console',
    });
  }
  return windows.length ? { plan: 'Go', windows } : null;
}

async function fetchOpenCodeGoConsoleUsage(state) {
  const workspaceId = String(state?.workspaceId || process.env.OPENCODE_GO_WORKSPACE_ID || '').trim();
  const authToken = String(state?.authToken || process.env.OPENCODE_GO_AUTH_TOKEN || '').trim();
  if (!workspaceId || !authToken) return null;

  const response = await fetchOpenAI(`https://opencode.ai/workspace/${encodeURIComponent(workspaceId)}/go`, {
    method: 'GET',
    headers: {
      Cookie: `auth=${authToken}; oc_locale=en`,
      Accept: 'text/html',
      'User-Agent': 'CodexUsageDashboard',
    },
  });
  if (!response.ok) {
    const err = new Error(`OpenCode Go console request failed: ${response.status}`);
    err.status = response.status;
    throw err;
  }
  const html = await response.text();
  const usage = parseOpenCodeGoConsoleUsage(html);
  if (!usage) throw new Error('OpenCode Go console usage not found');
  return usage;
}

async function refreshOpenCodeGoState() {
  const previous = loadOpenCodeGoState() || {};
  const apiKey = getOpenCodeGoApiKey(previous);
  const hasConsoleCredentials = hasOpenCodeGoConsoleCredentials(previous);
  if (!apiKey && !hasConsoleCredentials) {
    const state = {
      ...previous,
      provider: OPENCODE_GO_SLOT,
      email: 'OpenCode Go',
      usage: null,
      lastCheckedAt: Date.now(),
      lastError: 'OpenCode Go API key is not configured',
    };
    saveOpenCodeGoState(state);
    return { ok: false, error: state.lastError, account: sanitizeOpenCodeGoAccount(state) };
  }

  const state = {
    ...previous,
    provider: OPENCODE_GO_SLOT,
    email: 'OpenCode Go',
    planTypeFromJwt: 'go',
    updatedAt: Date.now(),
    lastCheckedAt: Date.now(),
    entitlement: { active: true, plan: 'go', activeUntil: null, autoRenew: true },
  };
  if (!OPENCODE_GO_API_KEY && previous.apiKey) state.apiKey = previous.apiKey;

  const consoleUsage = await fetchOpenCodeGoConsoleUsage(previous).catch(err => {
    if (hasConsoleCredentials) state.lastError = String(err?.message || err);
    return null;
  });
  if (consoleUsage) {
    state.usage = consoleUsage;
    state.orgName = 'Console usage';
    state.lastError = null;
  } else {
    const usageResult = buildOpenCodeGoUsage();
    state.usage = usageResult.usage;
    state.orgName = hasConsoleCredentials
      ? 'Console usage unavailable'
      : apiKey
        ? 'Local OpenCode usage estimate'
        : 'Add OpenCode Go API key';
    state.lastError ||= hasConsoleCredentials || apiKey
      ? null
      : 'OpenCode Go API key is required';
  }
  saveOpenCodeGoState(state);
  return { ok: true, account: sanitizeOpenCodeGoAccount(state) };
}

function getAccountId(accessToken) {
  const payload = decodeJwt(accessToken);
  const auth = payload?.[JWT_CLAIM_PATH];
  const accountId = auth?.chatgpt_account_id;
  return typeof accountId === 'string' && accountId ? accountId : null;
}

function getTokenProfile(accessToken) {
  const payload = decodeJwt(accessToken) || {};
  const auth = payload[JWT_CLAIM_PATH] || {};
  const profile = payload['https://api.openai.com/profile'] || {};
  return {
    email: typeof profile.email === 'string' ? profile.email : null,
    planTypeFromJwt: typeof auth.chatgpt_plan_type === 'string' ? auth.chatgpt_plan_type : null,
    accountId: typeof auth.chatgpt_account_id === 'string' ? auth.chatgpt_account_id : null,
  };
}

function extractEntitlementFromIdToken(idToken) {
  if (!idToken) return null;
  try {
    const payload = decodeJwt(idToken);
    const auth = payload?.[JWT_CLAIM_PATH] || {};
    const plan = auth.chatgpt_plan_type || null;
    const activeUntil = auth.chatgpt_subscription_active_until || null;
    const activeUntilMs = activeUntil ? Date.parse(activeUntil) : null;
    const active = plan && plan !== 'free' && Number.isFinite(activeUntilMs) && activeUntilMs > Date.now();
    if (activeUntil && !active) return null;
    return { active, plan, activeUntil };
  } catch {
    return null;
  }
}

function extractClaudeEntitlement(profile) {
  const org = profile?.organization;
  if (!org) return null;
  const plan = org.organization_type
    ? String(org.organization_type).replace(/^claude_/, '')
    : null;
  const status = org.subscription_status || null;
  const since = org.subscription_created_at || null;
  const rateLimitTier = org.rate_limit_tier
    ? String(org.rate_limit_tier).replace(/^default_claude_[a-z]+_/, '')
    : null;
  const autoRenew = org.billing_type === 'stripe_subscription';
  const trialEndsAt = org.claude_code_trial_ends_at || null;
  const active = status === 'active' || (trialEndsAt && new Date(trialEndsAt).getTime() > Date.now());
  return { active, plan, activeUntil: trialEndsAt, since, rateLimitTier, autoRenew };
}

function normalizeWindowLabel(windowHours) {
  if (windowHours >= 168) return 'Week';
  if (windowHours >= 24) return 'Day';
  return `${windowHours}h`;
}

function resolveSecondaryWindowLabel({ windowHours, secondaryResetAt, primaryResetAt }) {
  const WEEKLY_RESET_GAP_SECONDS = 3 * 24 * 60 * 60;
  if (
    typeof secondaryResetAt === 'number' &&
    typeof primaryResetAt === 'number' &&
    secondaryResetAt - primaryResetAt >= WEEKLY_RESET_GAP_SECONDS
  ) {
    return 'Week';
  }
  return normalizeWindowLabel(windowHours);
}

function toUsagePercent(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function toUsageSnapshot(data) {
  const windows = [];
  if (data?.rate_limit?.primary_window) {
    const pw = data.rate_limit.primary_window;
    const usedPercent = toUsagePercent(pw.used_percent);
    const windowHours = Math.round((pw.limit_window_seconds || 10800) / 3600);
    if (usedPercent !== null) {
      windows.push({
        label: normalizeWindowLabel(windowHours),
        usedPercent,
        resetAt: pw.reset_at ? pw.reset_at * 1000 : null,
      });
    }
  }
  if (data?.rate_limit?.secondary_window) {
    const sw = data.rate_limit.secondary_window;
    const usedPercent = toUsagePercent(sw.used_percent);
    const windowHours = Math.round((sw.limit_window_seconds || 86400) / 3600);
    if (usedPercent !== null) {
      windows.push({
        label: resolveSecondaryWindowLabel({
          windowHours,
          primaryResetAt: data?.rate_limit?.primary_window?.reset_at,
          secondaryResetAt: sw.reset_at,
        }),
        usedPercent,
        resetAt: sw.reset_at ? sw.reset_at * 1000 : null,
      });
    }
  }
  let plan = data?.plan_type || null;
  if (data?.credits?.balance !== undefined && data?.credits?.balance !== null) {
    const balance = typeof data.credits.balance === 'number' ? data.credits.balance : Number(data.credits.balance || 0);
    if (balance > 0) plan = plan ? `${plan} ($${balance.toFixed(2)})` : `$${balance.toFixed(2)}`;
  }
  return { plan, windows, raw: data };
}

function isPaidUsagePlan(plan) {
  if (typeof plan !== 'string' || !plan.trim()) return false;
  const normalized = plan.trim().toLowerCase();
  return !['free', 'none', 'unknown'].includes(normalized);
}

function getEntitlementActiveUntilMs(entitlement) {
  if (!entitlement?.activeUntil) return null;
  const activeUntilMs = Date.parse(entitlement.activeUntil);
  return Number.isFinite(activeUntilMs) ? activeUntilMs : null;
}

function hasExpiredEntitlement(entitlement) {
  const activeUntilMs = getEntitlementActiveUntilMs(entitlement);
  return activeUntilMs !== null && activeUntilMs <= Date.now();
}

function normalizeEntitlementForAccount(account) {
  const entitlement = account?.entitlement || null;
  if (!entitlement) return null;

  if (hasExpiredEntitlement(entitlement) && isPaidUsagePlan(account?.usage?.plan)) {
    return null;
  }

  return entitlement;
}

async function exchangeAuthorizationCode(code, verifier) {
  const response = await fetchOpenAI(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: CLIENT_ID,
      code,
      code_verifier: verifier,
      redirect_uri: REDIRECT_URI,
    }),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Token exchange failed: ${response.status} ${text}`.trim());
  }

  const json = await response.json();
  if (!json.access_token || !json.refresh_token || typeof json.expires_in !== 'number') {
    throw new Error('Token response missing fields');
  }

  const accountId = getAccountId(json.access_token);
  if (!accountId) throw new Error('Failed to extract accountId from token');

  const entitlement = extractEntitlementFromIdToken(json.id_token);
  return {
    access: json.access_token,
    refresh: json.refresh_token,
    expires: Date.now() + json.expires_in * 1000,
    accountId,
    entitlement,
  };
}

async function refreshAccount(account) {
  const response = await fetchOpenAI(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: account.refresh,
      client_id: CLIENT_ID,
    }),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Refresh failed: ${response.status} ${text}`.trim());
  }

  const json = await response.json();
  if (!json.access_token || !json.refresh_token || typeof json.expires_in !== 'number') {
    throw new Error('Refresh response missing fields');
  }

  const accountId = getAccountId(json.access_token);
  if (!accountId) throw new Error('Failed to extract accountId from refreshed token');

  const profile = getTokenProfile(json.access_token);
  const entitlement = extractEntitlementFromIdToken(json.id_token);
  const previousEntitlement = hasExpiredEntitlement(account.entitlement) ? null : account.entitlement;
  return {
    ...account,
    access: json.access_token,
    refresh: json.refresh_token,
    expires: Date.now() + json.expires_in * 1000,
    accountId,
    email: profile.email || account.email || null,
    planTypeFromJwt: profile.planTypeFromJwt || account.planTypeFromJwt || null,
    entitlement: entitlement || previousEntitlement || null,
    updatedAt: Date.now(),
  };
}

async function fetchUsage(account) {
  const headers = {
    Authorization: `Bearer ${account.access}`,
    'User-Agent': 'CodexUsageDashboard',
    Accept: 'application/json',
  };
  if (account.accountId) headers['ChatGPT-Account-Id'] = account.accountId;

  const response = await fetchOpenAI(USAGE_URL, { method: 'GET', headers });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    const err = new Error(`Usage request failed: ${response.status} ${text}`.trim());
    err.status = response.status;
    throw err;
  }
  return toUsageSnapshot(await response.json());
}

// Cursor exposes this through the same Connect RPC call used by its agent client.
// It is not a stable public API, so failures stay visible on the card instead of
// being treated as zero usage.
async function fetchCursorUsage() {
  const accessToken = readCursorAccessToken();
  if (!accessToken) {
    throw new Error('Cursor Agent is not logged in. Run cursor-agent login or set CURSOR_ACCESS_TOKEN.');
  }

  const response = await fetchOpenAI(
    CURSOR_API_URL.replace(/\/+$/, '') + '/aiserver.v1.DashboardService/GetCurrentPeriodUsage',
    {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + accessToken,
        'Connect-Protocol-Version': '1',
        'x-cursor-client-type': 'cli',
        'x-cursor-client-version': CURSOR_CLIENT_VERSION,
        'x-ghost-mode': 'true',
        'x-request-id': crypto.randomUUID(),
      },
      body: '{}',
    },
  );
  if (!response.ok) {
    await response.text().catch(() => '');
    const err = new Error('Cursor usage request failed: ' + response.status);
    err.status = response.status;
    throw err;
  }

  return normalizeCursorUsage(await response.json());
}

async function refreshCursorSubscription() {
  const previous = loadCursorSubscriptionState();
  if (!previous.configured) {
    return { ok: false, error: 'Cursor subscription is not configured', cursor: null };
  }

  const now = Date.now();
  const working = { ...previous, lastCheckedAt: now };
  try {
    const usage = await fetchCursorUsage();
    const sampleNow = Number(usage.updatedAt || now);
    working.usageHistory = reconcileCursorPaceSamples({
      storedSamples: working.usageHistory,
      current: usage.planUsage,
      cycleStart: usage.billingCycleStart,
      now: sampleNow,
    });
    working.usage = {
      ...usage,
      pace: buildCursorUsagePace({ usage, samples: working.usageHistory, now: sampleNow }),
    };
    working.lastError = null;
    saveCursorSubscriptionState(working);
    return { ok: true, cursor: sanitizeCursorSubscription(working) };
  } catch (err) {
    working.lastError = String(err?.message || err);
    saveCursorSubscriptionState(working);
    return { ok: false, error: working.lastError, cursor: sanitizeCursorSubscription(working) };
  }
}


async function refreshUsageForSlot(slot) {
  if (slot === CLAUDE_SLOT) {
    return refreshClaudeCode();
  }
  if (slot === OPENCODE_GO_SLOT) {
    return refreshOpenCodeGoState();
  }

  const store = loadStore();
  const account = store.accounts[slot];
  if (!account) {
    return { ok: false, error: 'Slot is empty' };
  }

  let working = { ...account };
  try {
    const needsTokenRefresh = !working.access
      || Date.now() >= Number(working.expires || 0)
      || (working.entitlement && !('activeUntil' in working.entitlement))
      || hasExpiredEntitlement(working.entitlement);
    if (needsTokenRefresh) {
      working = await refreshAccount(working);
    }

    let usage;
    try {
      usage = await fetchUsage(working);
    } catch (err) {
      if (err?.status === 401 || err?.status === 403) {
        working = await refreshAccount(working);
        usage = await fetchUsage(working);
      } else {
        throw err;
      }
    }

    if (isLikelyTransientUsageGlitch(account.usage, usage)) {
      console.warn(`Ignoring transient Codex usage glitch for ${slot}: Week ${getWeekWindowFromUsage(account.usage)?.usedPercent} -> ${getWeekWindowFromUsage(usage)?.usedPercent}`);
      working.usageGlitchAt = Date.now();
    }
    usage = preserveTransientWindowRegressions(account.usage, usage);

    working.usage = usage;

    working.lastCheckedAt = Date.now();
    working.lastError = null;
    // Reload store to avoid overwriting parallel slot updates
    const freshStore = loadStore();
    freshStore.accounts[slot] = working;
    saveStore(freshStore);
    await maybeSendCodexDailyUsageAlert(slot, working).catch(err => console.error(String(err?.message || err)));
    return { ok: true, account: sanitizeAccount(slot, working) };
  } catch (err) {
    working.lastError = String(err?.message || err);
    working.lastCheckedAt = Date.now();
    const freshStore = loadStore();
    freshStore.accounts[slot] = working;
    saveStore(freshStore);
    return { ok: false, error: working.lastError, account: sanitizeAccount(slot, working) };
  }
}

async function refreshClaudeCode() {
  const authStatus = getClaudeAuthStatus();
  const credsInfo = readClaudeCredentialsFile();
  const previous = loadClaudeCodeState() || {};
  const now = Date.now();
  const nextRefreshAfter = Number(previous.nextRefreshAfter || 0);
  if (previous.usage && nextRefreshAfter && now < nextRefreshAfter) {
    return { ok: true, account: sanitizeClaudeAccount(previous), skipped: true };
  }
  if (
    previous.usage &&
    previous.lastCheckedAt &&
    now - Number(previous.lastCheckedAt) < CLAUDE_MIN_REFRESH_INTERVAL_MS
  ) {
    return { ok: true, account: sanitizeClaudeAccount(previous), skipped: true };
  }

  const plan = authStatus.subscriptionType || credsInfo?.creds?.subscriptionType || previous.planTypeFromJwt || null;
  let working = {
    provider: 'claude-code',
    email: authStatus.email || previous.email || 'Claude Code',
    accountId: authStatus.orgId || previous.accountId || null,
    orgName: authStatus.orgName || previous.orgName || null,
    planTypeFromJwt: plan,
    usage: previous.usage || { plan, windows: [] },
    expires: credsInfo?.creds?.expiresAt || previous.expires || null,
    updatedAt: previous.updatedAt || null,
    lastCheckedAt: now,
    lastError: null,
    nextRefreshAfter: null,
    entitlement: previous.entitlement || null,
  };

  try {
    if (!authStatus.loggedIn && !credsInfo?.creds?.accessToken) {
      throw new Error(authStatus.error || 'Claude Code is not logged in');
    }
    const creds = await refreshClaudeCredentialsIfNeeded(credsInfo);
    working.expires = creds?.expiresAt || working.expires;
    const profile = await fetchClaudeProfile(creds);
    if (profile?.account?.email) working.email = profile.account.email;
    if (profile?.organization?.uuid) working.accountId = profile.organization.uuid;
    if (profile?.organization?.name) working.orgName = profile.organization.name;
    if (profile?.organization?.organization_type) {
      working.planTypeFromJwt = String(profile.organization.organization_type).replace(/^claude_/, '');
    }
    const entitlement = extractClaudeEntitlement(profile);
    if (entitlement) working.entitlement = entitlement;
    working.usage = await fetchClaudeUsage(creds, plan);
    working.updatedAt = now;
    working.lastCheckedAt = now;
    working.lastError = null;
    working.nextRefreshAfter = now + CLAUDE_MIN_REFRESH_INTERVAL_MS;
    saveClaudeCodeState(working);
    return { ok: true, account: sanitizeClaudeAccount(working) };
  } catch (err) {
    if (err?.status === 429 && previous.usage) {
      const retryAfterMs = Number(err.retryAfterMs || 0);
      working.usage = previous.usage;
      working.lastError = null;
      working.updatedAt = previous.updatedAt || working.updatedAt;
      working.nextRefreshAfter = now + (retryAfterMs > 0 ? retryAfterMs : CLAUDE_RATE_LIMIT_COOLDOWN_MS);
      saveClaudeCodeState(working);
      return { ok: true, account: sanitizeClaudeAccount(working), rateLimited: true };
    }
    working.lastError = String(err?.message || err);
    working.lastCheckedAt = now;
    working.nextRefreshAfter = err?.status === 429
      ? now + Number(err.retryAfterMs || CLAUDE_RATE_LIMIT_COOLDOWN_MS)
      : now + CLAUDE_MIN_REFRESH_INTERVAL_MS;
    saveClaudeCodeState(working);
    return { ok: false, error: working.lastError, account: sanitizeClaudeAccount(working) };
  }
}

function getStableUsageForView(slot, account) {
  const usage = account?.usage || null;
  if (!usage?.windows?.length) return usage;
  const weekWindow = getWeekWindow(account);
  const alerts = loadAlerts();
  const state = alerts.slots?.[slot] || null;
  if (!weekWindow || !isLikelyTransientWeekZero(state, Number(weekWindow.usedPercent))) return usage;
  const stableWeekPercent = Number(state.lastSeenWeekPercent ?? state.rawWeekPercent);
  if (!Number.isFinite(stableWeekPercent)) return usage;
  return {
    ...usage,
    windows: usage.windows.map(window => window?.label === 'Week'
      ? { ...window, usedPercent: stableWeekPercent, estimated: true }
      : window),
  };
}

function sanitizeAccount(slot, account) {
  if (!account) {
    return { slot, connected: false };
  }
  const stableUsage = getStableUsageForView(slot, account);
  return {
    slot,
    connected: true,
    email: account.email || null,
    accountId: account.accountId || null,
    planTypeFromJwt: account.planTypeFromJwt || null,
    usage: stableUsage,
    alertMetrics: getCodexUsageAlertMetrics(slot, { ...account, usage: stableUsage }),
    expires: account.expires || null,
    updatedAt: account.updatedAt || null,
    lastCheckedAt: account.lastCheckedAt || null,
    lastError: account.lastError || null,
    entitlement: normalizeEntitlementForAccount(account),
  };
}

function sanitizeClaudeAccount(state = loadClaudeCodeState()) {
  const authStatus = state ? null : getClaudeAuthStatus();
  const credsInfo = state ? null : readClaudeCredentialsFile();
  const source = state || {
    email: authStatus?.email || 'Claude Code',
    accountId: authStatus?.orgId || null,
    orgName: authStatus?.orgName || null,
    planTypeFromJwt: authStatus?.subscriptionType || credsInfo?.creds?.subscriptionType || null,
    usage: null,
    expires: credsInfo?.creds?.expiresAt || null,
    updatedAt: null,
    lastCheckedAt: null,
    lastError: authStatus?.loggedIn || credsInfo?.creds?.accessToken ? null : 'Claude Code is not logged in',
  };
  const connected = Boolean(source.email || source.accountId || source.usage || source.expires);
  const lastError = source.usage && String(source.lastError || '').includes('429')
    ? null
    : source.lastError || null;
  return {
    slot: CLAUDE_SLOT,
    provider: 'claude-code',
    connected: true,
    readOnly: true,
    email: source.email || (connected ? 'Claude Code' : null),
    accountId: source.accountId || null,
    orgName: source.orgName || null,
    planTypeFromJwt: source.planTypeFromJwt || null,
    usage: source.usage || null,
    expires: source.expires || null,
    updatedAt: source.updatedAt || null,
    lastCheckedAt: source.lastCheckedAt || null,
    lastError,
    entitlement: source.entitlement || null,
  };
}

function sanitizeOpenCodeGoAccount(state = loadOpenCodeGoState()) {
  const hasApiKey = Boolean(getOpenCodeGoApiKey(state));
  const hasConsoleCredentials = hasOpenCodeGoConsoleCredentials(state);
  const connected = hasApiKey || hasConsoleCredentials || Boolean(state?.usage);
  return {
    slot: OPENCODE_GO_SLOT,
    provider: OPENCODE_GO_SLOT,
    connected,
    readOnly: Boolean(OPENCODE_GO_API_KEY),
    email: 'OpenCode Go',
    accountId: null,
    orgName: state?.orgName || null,
    planTypeFromJwt: state?.planTypeFromJwt || (connected ? 'go' : null),
    usage: state?.usage || null,
    expires: null,
    updatedAt: state?.updatedAt || null,
    lastCheckedAt: state?.lastCheckedAt || null,
    lastError: state?.lastError || null,
    entitlement: state?.entitlement || (connected ? { active: true, plan: 'go', activeUntil: null, autoRenew: true } : null),
  };
}

function getAccountsView() {
  const store = loadStore();
  const openAiAccounts = Object.keys(store.accounts).sort().map((slot) => sanitizeAccount(slot, store.accounts[slot]));
  const accounts = [...openAiAccounts];
  if (SHOW_CLAUDE_CARD) accounts.push(sanitizeClaudeAccount());
  if (SHOW_OPENCODE_GO_CARD) accounts.push(sanitizeOpenCodeGoAccount());
  return accounts;
}

function findDuplicateSlot(store, accountId, email, excludeSlot) {
  for (const [slot, acct] of Object.entries(store.accounts)) {
    if (slot === excludeSlot || !acct) continue;
    if (accountId && acct.accountId === accountId) return { slot, email: acct.email };
    if (email && acct.email === email) return { slot, email: acct.email };
  }
  return null;
}

async function parseBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const text = Buffer.concat(chunks).toString('utf8');
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

function parseCursorRenewalDate(value) {
  const text = String(value || '').trim();
  if (!text) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return undefined;
  const parsed = Date.parse(text + 'T00:00:00.000Z');
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString().slice(0, 10) !== text) return undefined;
  return text;
}

async function handleApi(req, res, url) {
  if (req.method === 'GET' && url.pathname === '/api/accounts') {
    return json(res, 200, { accounts: getAccountsView() });
  }

  if (req.method === 'GET' && url.pathname === '/api/cursor') {
    return json(res, 200, { cursor: sanitizeCursorSubscription() });
  }

  if (req.method === 'POST' && url.pathname === '/api/cursor/config') {
    const body = (await parseBody(req)) || {};
    const current = loadCursorSubscriptionState();
    const plan = String(body.plan ?? current.plan ?? 'Cursor').trim();
    const monthlyCostInput = body.monthlyCost;
    const monthlyCost = monthlyCostInput === '' || monthlyCostInput == null
      ? null
      : Number(monthlyCostInput);
    const currency = String(body.currency ?? current.currency ?? 'USD').trim().toUpperCase();
    const renewalDate = parseCursorRenewalDate(body.renewalDate);

    if (!plan || plan.length > 80) {
      return json(res, 400, { ok: false, error: 'Cursor plan name must be 1-80 characters' });
    }
    if (monthlyCost !== null && (!Number.isFinite(monthlyCost) || monthlyCost < 0 || monthlyCost > 100000)) {
      return json(res, 400, { ok: false, error: 'Cursor monthly cost must be a number between 0 and 100000' });
    }
    if (!/^[A-Z]{3}$/.test(currency)) {
      return json(res, 400, { ok: false, error: 'Cursor currency must be a three-letter code' });
    }
    if (renewalDate === undefined) {
      return json(res, 400, { ok: false, error: 'Cursor renewal date must be a valid date' });
    }

    saveCursorSubscriptionState({
      ...current,
      configured: true,
      plan,
      monthlyCost,
      currency,
      renewalDate,
      lastError: null,
    });
    const result = await refreshCursorSubscription();
    return json(res, 200, { ok: true, refreshOk: result.ok, cursor: result.cursor });
  }

  if (req.method === 'POST' && url.pathname === '/api/cursor/refresh') {
    const result = await refreshCursorSubscription();
    return json(res, result.ok ? 200 : 502, result);
  }

  if (req.method === 'POST' && url.pathname === '/api/cursor/delete') {
    saveCursorSubscriptionState({ ...DEFAULT_CURSOR_STATE });
    return json(res, 200, { ok: true, cursor: null });
  }

  if (req.method === 'POST' && url.pathname === '/api/refresh-all') {
    const store = loadStore();
    const slots = Object.keys(store.accounts);
    const extraSlots = [
      ...(SHOW_CLAUDE_CARD ? [CLAUDE_SLOT] : []),
      ...(SHOW_OPENCODE_GO_CARD ? [OPENCODE_GO_SLOT] : []),
    ];
    const refreshJobs = [...slots, ...extraSlots].map((slot) => refreshUsageForSlot(slot));
    if (loadCursorSubscriptionState().configured) refreshJobs.push(refreshCursorSubscription());
    const results = await Promise.all(refreshJobs);
    appendSnapshot();
    return json(res, 200, { ok: true, results, accounts: getAccountsView() });
  }

  if (req.method === 'POST' && url.pathname === '/api/opencode-go/connect') {
    const body = await parseBody(req);
    const apiKey = String(body.apiKey || '').trim();
    const workspaceId = String(body.workspaceId || '').trim();
    const authToken = String(body.authToken || '').trim();
    if (!apiKey && (!workspaceId || !authToken)) {
      return json(res, 400, { ok: false, error: 'OpenCode Go API key or console credentials are required' });
    }
    const previous = loadOpenCodeGoState() || {};
    saveOpenCodeGoState({
      ...previous,
      apiKey: apiKey || previous.apiKey || undefined,
      workspaceId: workspaceId || previous.workspaceId || undefined,
      authToken: authToken || previous.authToken || undefined,
      provider: OPENCODE_GO_SLOT,
      email: 'OpenCode Go',
      updatedAt: Date.now(),
      lastError: null,
    });
    const result = await refreshOpenCodeGoState();
    appendSnapshot();
    return json(res, 200, { ok: true, account: result.account, accounts: getAccountsView() });
  }

  if (req.method === 'POST' && url.pathname === '/api/accounts/create') {
    const store = loadStore();
    const existing = Object.keys(store.accounts)
      .map(s => parseInt(s.replace('slot', ''), 10))
      .filter(n => !isNaN(n));
    const next = existing.length ? Math.max(...existing) + 1 : 1;
    const slotName = `slot${next}`;
    store.accounts[slotName] = null;
    saveStore(store);
    return json(res, 200, { ok: true, slot: slotName, accounts: getAccountsView() });
  }

  if (url.pathname === '/api/settings') {
    if (req.method === 'GET') {
      return json(res, 200, loadSettings());
    }
    if (req.method === 'PUT') {
      const body = await parseBody(req);
      const current = loadSettings();
      const updated = { ...current };
      if ('liveInterval' in body) {
        const v = Number(body.liveInterval);
        if (isNaN(v) || v < 0) return json(res, 400, { ok: false, error: 'Invalid liveInterval' });
        updated.liveInterval = v;
      }
      if ('backgroundInterval' in body) {
        const v = Number(body.backgroundInterval);
        if (isNaN(v) || v < 60) return json(res, 400, { ok: false, error: 'backgroundInterval must be >= 60' });
        updated.backgroundInterval = v;
      }
      // Migrate legacy field
      if ('refreshInterval' in body && !('liveInterval' in body) && !('backgroundInterval' in body)) {
        updated.liveInterval = Number(body.refreshInterval) || 30;
      }
      saveSettings(updated);
      startAutoRefresh();
      return json(res, 200, { ok: true, ...updated });
    }
  }

  if (req.method === 'GET' && url.pathname === '/api/history') {
    const range = url.searchParams.get('range') || '24h';
    const rangeMs = { '24h': 86400000, '7d': 604800000, '30d': 2592000000 }[range] || 86400000;
    const cutoff = Date.now() - rangeMs;
    const history = loadHistory();
    const filtered = history.snapshots.filter(s => s.timestamp > cutoff);
    return json(res, 200, { snapshots: filtered });
  }

  const slotMatch = url.pathname.match(/^\/api\/accounts\/(slot\d+|claude-code|opencode-go)\/(login|refresh|logout|delete|exchange)$/);
  if (!slotMatch) return false;

  const [, slot, action] = slotMatch;

  if (slot === CLAUDE_SLOT && action !== 'refresh') {
    json(res, 400, { ok: false, error: 'Claude Code is read-only in this dashboard. Use `claude auth` to manage login.' });
    return true;
  }
  if (slot === OPENCODE_GO_SLOT && !['refresh', 'logout'].includes(action)) {
    json(res, 400, { ok: false, error: 'OpenCode Go supports refresh and logout here. Add it with the OpenCode Go card.' });
    return true;
  }

  if (action !== 'login' && action !== 'exchange') {
    const store = loadStore();
    if (![CLAUDE_SLOT, OPENCODE_GO_SLOT].includes(slot) && !(slot in store.accounts)) {
      json(res, 404, { ok: false, error: 'Unknown slot' });
      return true;
    }
  }

  if (req.method !== 'POST') {
    json(res, 405, { ok: false, error: 'Method not allowed' });
    return true;
  }

  if (action === 'login') {
    const { verifier, challenge } = await generatePKCE();
    const state = createState();
    const startedAt = Date.now();
    pendingLogins.set(state, { slot, verifier, startedAt });

    for (const [key, pending] of pendingLogins.entries()) {
      if (startedAt - pending.startedAt > 15 * 60 * 1000) pendingLogins.delete(key);
    }

    const authUrl = new URL(AUTHORIZE_URL);
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('client_id', CLIENT_ID);
    authUrl.searchParams.set('redirect_uri', REDIRECT_URI);
    authUrl.searchParams.set('scope', SCOPE);
    authUrl.searchParams.set('code_challenge', challenge);
    authUrl.searchParams.set('code_challenge_method', 'S256');
    authUrl.searchParams.set('state', state);
    authUrl.searchParams.set('id_token_add_organizations', 'true');
    authUrl.searchParams.set('codex_cli_simplified_flow', 'true');
    authUrl.searchParams.set('originator', 'codex-usage-dashboard');

    json(res, 200, { ok: true, authUrl: authUrl.toString(), slot });
    return true;
  }

  if (action === 'refresh') {
    const result = await refreshUsageForSlot(slot);
    json(res, result.ok ? 200 : 500, result);
    return true;
  }

  if (action === 'logout') {
    if (slot === OPENCODE_GO_SLOT) {
      saveOpenCodeGoState({
        provider: OPENCODE_GO_SLOT,
        email: 'OpenCode Go',
        usage: null,
        updatedAt: Date.now(),
        lastCheckedAt: Date.now(),
        lastError: null,
      });
      json(res, 200, { ok: true, slot, account: sanitizeOpenCodeGoAccount() });
      return true;
    }
    const store = loadStore();
    store.accounts[slot] = null;
    saveStore(store);
    json(res, 200, { ok: true, slot, account: sanitizeAccount(slot, null) });
    return true;
  }

  if (action === 'delete') {
    const store = loadStore();
    if (store.accounts[slot]) {
      json(res, 400, { ok: false, error: 'Disconnect the account first' });
      return true;
    }
    delete store.accounts[slot];
    saveStore(store);
    json(res, 200, { ok: true, slot, accounts: getAccountsView() });
    return true;
  }

  if (action === 'exchange') {
    const body = await parseBody(req);
    const callbackUrl = String(body.url || '');
    let parsed;
    try {
      parsed = new URL(callbackUrl);
    } catch {
      json(res, 400, { ok: false, error: 'Invalid URL' });
      return true;
    }
    const code = parsed.searchParams.get('code');
    const state = parsed.searchParams.get('state');
    if (!code || !state) {
      json(res, 400, { ok: false, error: 'URL does not contain code or state' });
      return true;
    }
    const pending = pendingLogins.get(state);
    if (!pending) {
      json(res, 400, { ok: false, error: 'Unknown or expired state' });
      return true;
    }
    try {
      const creds = await exchangeAuthorizationCode(code, pending.verifier);
      const profile = getTokenProfile(creds.access);
      const store = loadStore();
      const dup = findDuplicateSlot(store, creds.accountId, profile.email, pending.slot);
      if (dup) {
        pendingLogins.delete(state);
        json(res, 409, { ok: false, error: `This account is already connected (${dup.email || dup.slot})` });
        return true;
      }
      store.accounts[pending.slot] = {
        slot: pending.slot,
        access: creds.access,
        refresh: creds.refresh,
        expires: creds.expires,
        accountId: creds.accountId,
        email: profile.email,
        planTypeFromJwt: profile.planTypeFromJwt,
        usage: null,
        updatedAt: Date.now(),
        lastCheckedAt: null,
        lastError: null,
      };
      saveStore(store);
      pendingLogins.delete(state);
      await refreshUsageForSlot(pending.slot);
      json(res, 200, { ok: true, slot: pending.slot, accounts: getAccountsView() });
    } catch (err) {
      console.error(`Exchange failed for ${pending.slot}:`, err?.message || err);
      pendingLogins.delete(state);
      json(res, 500, { ok: false, error: String(err?.message || err) });
    }
    return true;
  }

  return false;
}

async function handleAuthCallback(req, res, url) {
  const state = url.searchParams.get('state');
  const code = url.searchParams.get('code');
  if (!state || !code) {
    return sendHtml(res, 400, '<h1>OAuth error</h1><p>Missing state or code.</p>');
  }

  const pending = pendingLogins.get(state);
  if (!pending) {
    return sendHtml(res, 400, '<h1>OAuth error</h1><p>Unknown or expired login state.</p>');
  }

  try {
    const creds = await exchangeAuthorizationCode(code, pending.verifier);
    const profile = getTokenProfile(creds.access);
    const store = loadStore();
    const dup = findDuplicateSlot(store, creds.accountId, profile.email, pending.slot);
    if (dup) {
      pendingLogins.delete(state);
      return sendHtml(res, 409, `<!doctype html><html><head><meta charset="utf-8"><title>Duplicate</title><style>body{font-family:system-ui;margin:40px;background:#0b1020;color:#e6edf3}a{color:#8ab4ff}</style></head><body><h1>Account already connected</h1><p>This account is already used (${dup.email || dup.slot}).</p><p><a href="/">Back to dashboard</a></p></body></html>`);
    }
    store.accounts[pending.slot] = {
      slot: pending.slot,
      access: creds.access,
      refresh: creds.refresh,
      expires: creds.expires,
      accountId: creds.accountId,
      email: profile.email,
      planTypeFromJwt: profile.planTypeFromJwt,
      usage: null,
      updatedAt: Date.now(),
      lastCheckedAt: null,
      lastError: null,
    };
    saveStore(store);
    pendingLogins.delete(state);

    await refreshUsageForSlot(pending.slot);

    return sendHtml(
      res,
      200,
      `<!doctype html><html><head><meta charset="utf-8"><title>OAuth complete</title><style>body{font-family:system-ui;margin:40px;background:#0b1020;color:#e6edf3}a{color:#8ab4ff}</style></head><body><h1>Account connected</h1><p>Slot: <b>${pending.slot}</b></p><p>You can close this tab and return to the <a href="/">dashboard</a>.</p><script>try{window.opener&&window.opener.postMessage({type:'codex-login-complete',slot:${JSON.stringify(pending.slot)}},'*')}catch(e){}</script></body></html>`,
    );
  } catch (err) {
    pendingLogins.delete(state);
    return sendHtml(
      res,
      500,
      `<!doctype html><html><head><meta charset="utf-8"><title>OAuth failed</title></head><body><h1>OAuth failed</h1><pre>${String(err?.message || err)}</pre><p><a href="/">Back</a></p></body></html>`,
    );
  }
}

function serveStatic(req, res, url) {
  let filePath = path.join(PUBLIC_DIR, url.pathname === '/' ? 'index.html' : url.pathname);
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    res.writeHead(404);
    res.end('Not found');
    return;
  }
  const ext = path.extname(filePath).toLowerCase();
  res.writeHead(200, { 'Content-Type': CONTENT_TYPES[ext] || 'application/octet-stream' });
  fs.createReadStream(filePath).pipe(res);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

  try {
    if (url.pathname === '/auth/callback') {
      await handleAuthCallback(req, res, url);
      return;
    }

    const handledApi = await handleApi(req, res, url);
    if (handledApi !== false) return;

    if (req.method === 'GET') {
      serveStatic(req, res, url);
      return;
    }

    res.writeHead(404);
    res.end('Not found');
  } catch (err) {
    json(res, 500, { ok: false, error: String(err?.message || err) });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Codex Usage Dashboard: http://${HOST}:${PORT}`);
});

async function autoRefreshAll() {
  const store = loadStore();
  const connected = [
    ...Object.keys(store.accounts).filter(s => store.accounts[s]?.refresh),
    ...(SHOW_CLAUDE_CARD ? [CLAUDE_SLOT] : []),
    ...((SHOW_OPENCODE_GO_CARD && (getOpenCodeGoApiKey() || hasOpenCodeGoConsoleCredentials())) ? [OPENCODE_GO_SLOT] : []),
  ];
  const cursorConfigured = loadCursorSubscriptionState().configured;
  if (!connected.length && !cursorConfigured) return;
  console.log('Auto-refresh: ' + (connected.length + (cursorConfigured ? 1 : 0)) + ' source(s)');
  const refreshJobs = connected.map(s => refreshUsageForSlot(s));
  if (cursorConfigured) refreshJobs.push(refreshCursorSubscription());
  const results = await Promise.all(refreshJobs);
  const ok = results.filter(r => r.ok).length;
  const fail = results.filter(r => !r.ok).length;
  console.log(`Auto-refresh done: ${ok} ok, ${fail} failed`);
}

let autoRefreshTimer = null;

function startAutoRefresh() {
  if (autoRefreshTimer) clearInterval(autoRefreshTimer);
  autoRefreshTimer = null;
  const settings = loadSettings();
  const interval = (settings.backgroundInterval || 300) * 1000;
  if (interval <= 0) {
    console.log('Background refresh: disabled');
    return;
  }
  console.log(`Background refresh: every ${settings.backgroundInterval || 300}s`);
  autoRefreshTimer = setInterval(async () => {
    await autoRefreshAll();
    appendSnapshot();
  }, interval);
}

// Initial refresh 10s after startup
setTimeout(async () => {
  await autoRefreshAll();
  appendSnapshot();
}, 10_000);

startAutoRefresh();
