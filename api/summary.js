// Portfolio KPI summary for the iPhone widget.
//
// Returns the same two headline numbers shown at the top of the app (total return
// and daily change), computed server-side so the widget shows fresh prices even
// when the app hasn't been opened. Mirrors the `stats` calculation in src/App.jsx.
//
// Required env vars (Vercel → Settings → Environment Variables):
//   WIDGET_TOKEN              — shared secret; requests must pass ?key=<token>
//   FIREBASE_SERVICE_ACCOUNT  — service account JSON (single line) from the Firebase console
//   PORTFOLIO_UID             — the Firebase Auth uid whose portfolio to report
//   PORTFOLIO_APP_ID          — optional; defaults to the app's own default appId
import crypto from 'crypto';
import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { fetchQuotes } from './_quotes.js';

const DEFAULT_APP_ID = 'portfolio-tracker-pro-v3';
const IL_TZ = 'Asia/Jerusalem';
const FALLBACK_USD_RATE = 3.75;

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  const expectedToken = process.env.WIDGET_TOKEN;
  if (!expectedToken) {
    return res.status(500).json({ error: 'WIDGET_TOKEN is not configured' });
  }

  const provided = req.query.key || (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!secretsMatch(provided, expectedToken)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const uid = process.env.PORTFOLIO_UID;
  if (!uid) {
    return res.status(500).json({ error: 'PORTFOLIO_UID is not configured' });
  }

  try {
    const db = getDb();
    const userDoc = db
      .collection('artifacts').doc(process.env.PORTFOLIO_APP_ID || DEFAULT_APP_ID)
      .collection('users').doc(uid);

    const [holdingsSnap, cacheSnap, usdRate] = await Promise.all([
      userDoc.collection('holdings').get(),
      userDoc.collection('cache').doc('marketData').get(),
      fetchUsdRate(),
    ]);

    const holdings = holdingsSnap.docs.map(d => d.data());
    const cached = cacheSnap.exists ? cacheSnap.data() : {};

    const { marketData, failures } = await loadPrices(holdings, cached);
    const stats = computeStats(holdings, marketData, usdRate);

    // Short edge cache keeps repeated taps from re-scraping the upstream price
    // sources. max-age=0 keeps it out of the phone's own URL cache — without it
    // the response has no client freshness lifetime, so iOS is free to cache it
    // heuristically and hand the widget numbers older than the refresh itself.
    res.setHeader('Cache-Control', 's-maxage=60, max-age=0, must-revalidate');

    return res.status(200).json({
      ...stats,
      usdRate,
      holdingsCount: holdings.length,
      priceFailures: failures,
      asOf: new Date().toISOString(),
    });
  } catch (e) {
    console.error('summary failed:', e);
    return res.status(500).json({ error: e.message });
  }
}

function secretsMatch(provided, expected) {
  const a = Buffer.from(String(provided));
  const b = Buffer.from(String(expected));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// firebase-admin v13+ only exposes the modular API under ESM — the legacy
// `admin.apps` / `admin.credential` namespace is undefined here.
function getDb() {
  if (!getApps().length) {
    const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
    if (!raw) throw new Error('FIREBASE_SERVICE_ACCOUNT is not configured');
    const serviceAccount = JSON.parse(raw);
    // Env vars often carry the PEM newlines escaped
    if (serviceAccount.private_key) {
      serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, '\n');
    }
    initializeApp({ credential: cert(serviceAccount) });
  }
  return getFirestore();
}

async function fetchUsdRate() {
  try {
    const res = await fetch('https://open.er-api.com/v6/latest/USD', {
      signal: AbortSignal.timeout(5000),
    });
    const data = await res.json();
    if (data?.rates?.ILS > 0) return data.rates.ILS;
  } catch (e) {
    console.warn('Could not fetch live USD rate, using default:', e.message);
  }
  return FALLBACK_USD_RATE;
}

// Fetch one quote per unique symbol. Where a fetch fails, fall back to the
// price the app last cached (which also preserves manual price overrides).
async function loadPrices(holdings, cached) {
  const unique = new Map();
  for (const h of holdings) {
    const ticker = String(h.symbol || '').trim().toUpperCase();
    if (ticker && !unique.has(ticker)) unique.set(ticker, h);
  }

  // Same ticker normalisation the app applies before calling /api/quote
  const targets = [...unique.entries()].map(([ticker, h]) => {
    const isNumeric = /^\d+$/.test(ticker.replace('.TA', ''));
    const needsSuffix = h.currency === 'ILS' && !ticker.includes('.') && !isNumeric;
    return { ticker, fetchTicker: needsSuffix ? `${ticker}.TA` : ticker };
  });

  const results = await fetchQuotes(targets.map(t => t.fetchTicker));

  const marketData = {};
  const failures = [];

  targets.forEach(({ ticker }, i) => {
    const result = results[i];
    if (result?.success) {
      marketData[ticker] = {
        currentPrice: result.currentPrice,
        dailyChangePct: result.dailyChangePct,
        _marketTime: result.marketTime ?? null,
      };
      return;
    }
    const fallback = cached[ticker];
    if (fallback?.currentPrice > 0) {
      marketData[ticker] = {
        currentPrice: fallback.currentPrice,
        dailyChangePct: fallback.dailyChangePct || 0,
        _marketTime: fallback._marketTime ?? null,
      };
    } else {
      failures.push(ticker);
    }
  });

  return { marketData, failures };
}

// Israel-local calendar fields for a given instant
function israelParts(date) {
  const parts = {};
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: IL_TZ, hourCycle: 'h23', weekday: 'short',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  for (const { type, value } of formatter.formatToParts(date)) parts[type] = value;
  return parts;
}

// Port of dailyChangeState() in src/App.jsx, pinned to Israel time (the phone's
// timezone) rather than the server's UTC clock.
// 'weekend' → no change | 'closed' → traded before today's 09:30 reset | 'live' → counts
export function dailyChangeState(mData, now = new Date()) {
  const p = israelParts(now);
  if (p.weekday === 'Sat' || p.weekday === 'Sun') return 'weekend';

  const [y, mo, d] = [Number(p.year), Number(p.month), Number(p.day)];
  const offsetMs =
    Date.UTC(y, mo - 1, d, Number(p.hour), Number(p.minute), Number(p.second)) - now.getTime();

  let resetMs = Date.UTC(y, mo - 1, d, 9, 30, 0) - offsetMs;
  if (now.getTime() < resetMs) resetMs -= 24 * 60 * 60 * 1000; // before 09:30 → yesterday's boundary

  const marketTime = mData?._marketTime;
  return marketTime && marketTime >= resetMs ? 'live' : 'closed';
}

export function computeStats(holdings, marketData, usdRate, now = new Date()) {
  let totalInvestedILS = 0, currentTotalILS = 0, currentTotalUSD = 0, dailyChangeILS = 0;

  holdings.forEach(h => {
    const isILS = h.currency === 'ILS';
    const avgPriceCalc = isILS ? h.avgPrice / 100 : h.avgPrice;
    const investedInCurrency = h.quantity * avgPriceCalc;
    totalInvestedILS += isILS ? investedInCurrency : investedInCurrency * usdRate;

    const mData = marketData[String(h.symbol || '').trim().toUpperCase()]
      || { currentPrice: avgPriceCalc, dailyChangePct: 0 };
    const currentInCurrency = h.quantity * mData.currentPrice;
    const currentILS = isILS ? currentInCurrency : currentInCurrency * usdRate;
    currentTotalILS += currentILS;
    currentTotalUSD += isILS ? currentInCurrency / usdRate : currentInCurrency;

    // Only count today's change if the stock actually traded today
    const effectiveDailyPct = dailyChangeState(mData, now) === 'live' ? mData.dailyChangePct : 0;
    const prevDayValueILS = currentILS / (1 + effectiveDailyPct / 100);
    dailyChangeILS += currentILS - prevDayValueILS;
  });

  const totalChangeILS = currentTotalILS - totalInvestedILS;

  return {
    totalILS: currentTotalILS,
    totalUSD: currentTotalUSD,
    totalChangeILS,
    totalChangePct: totalInvestedILS > 0 ? (totalChangeILS / totalInvestedILS) * 100 : 0,
    dailyChangeILS,
    dailyChangePct: (currentTotalILS - dailyChangeILS) > 0
      ? (dailyChangeILS / (currentTotalILS - dailyChangeILS)) * 100
      : 0,
  };
}
