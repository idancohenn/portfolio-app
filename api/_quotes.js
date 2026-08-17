// Shared price-fetching logic used by /api/quote (browser) and /api/summary (widget).
// Files prefixed with "_" are not exposed as routes by Vercel.
import https from 'https';

export async function fetchQuotes(tickerList) {
  return Promise.all(tickerList.map(fetchTickerPrice));
}

export async function fetchTickerPrice(ticker) {
  const cleanTicker = ticker.replace('.TA', '');
  const isNumeric = /^\d+$/.test(cleanTicker);
  const isILS = ticker.endsWith('.TA') || isNumeric;

  let currentPrice = null;
  let prevClose = null;
  let source = null;
  let marketTime = null; // ms timestamp of the last actual trade/quote

  // Numeric Israeli funds — scrape Bizportal page
  if (isNumeric) {
    try {
      const bizData = await fetchBizportal(cleanTicker);
      if (bizData) {
        currentPrice = bizData.currentPrice;
        prevClose = bizData.prevClose;
        marketTime = bizData.marketTime;
        source = 'bizportal';
      }
    } catch (e) {
      console.error(`Bizportal failed for ${ticker}:`, e.message);
    }
  }

  // Non-numeric stocks — fetch via Yahoo Finance
  if (currentPrice === null && !isNumeric) {
    try {
      const yahooTicker = isILS && !ticker.includes('.') ? `${ticker}.TA` : ticker;
      const yahooData = await fetchYahoo(yahooTicker);
      if (yahooData) {
        currentPrice = yahooData.currentPrice;
        prevClose = yahooData.prevClose;
        marketTime = yahooData.marketTime;
        source = 'yahoo';
      }
    } catch (e) {
      console.error(`Yahoo failed for ${ticker}:`, e.message);
    }
  }

  if (currentPrice !== null && !isNaN(currentPrice) && currentPrice > 0) {
    const dailyChangePct = prevClose && prevClose > 0
      ? ((currentPrice - prevClose) / prevClose) * 100
      : 0;

    return {
      symbol: ticker,
      currentPrice,
      prevClose,
      dailyChangePct,
      marketTime,
      source,
      success: true
    };
  }

  return {
    symbol: ticker,
    success: false,
    error: 'Could not fetch price'
  };
}

function bizportalGet(path) {
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'www.bizportal.co.il', path, method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html',
        'Accept-Encoding': 'identity',
      },
      rejectUnauthorized: false,
      timeout: 10000,
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        resolve(bizportalGet(new URL(res.headers.location).pathname));
        return;
      }
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    req.end();
  });
}

async function fetchBizportal(paperId) {
  const { status, body } = await bizportalGet(`/capitalmarket/quote/generalview/${paperId}`);
  if (status !== 200 || body.length === 0) return null;

  const nums = [...body.matchAll(/class="num"[^>]*>([\d,.]+)/g)].map(m =>
    parseFloat(m[1].replace(/,/g, ''))
  );
  if (nums.length === 0) return null;

  const currentRate = nums[0];

  // Previous close is the "שער בסיס" value in the <dt>/<dd> data list:
  //   <dt>שער בסיס</dt><dd>236,610</dd>
  // (NOT the next class="num", which is an unrelated figure elsewhere on the page.)
  let baseRate = null;
  const baseMatch = body.match(/שער בסיס<\/dt>\s*<dd>([\d,.]+)/);
  if (baseMatch) baseRate = parseFloat(baseMatch[1].replace(/,/g, ''));

  // Last trade date — e.g. <div id="last-deal-time">נכון ל: 10/06/2026 </div>
  let marketTime = null;
  const dateMatch = body.match(/last-deal-time[^>]*>[^\d]*(\d{2})\/(\d{2})\/(\d{4})/);
  if (dateMatch) {
    const [, dd, mm, yyyy] = dateMatch;
    // Noon UTC avoids any midnight rollover when compared in Israel local time
    marketTime = Date.UTC(Number(yyyy), Number(mm) - 1, Number(dd), 12, 0, 0);
  }

  if (currentRate > 0) {
    return {
      currentPrice: currentRate / 100,
      prevClose: baseRate ? baseRate / 100 : null,
      marketTime,
    };
  }
  return null;
}

async function fetchYahoo(ticker) {
  const YAHOO_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'application/json, text/plain, */*',
    'Accept-Language': 'en-US,en;q=0.9',
    'Referer': 'https://finance.yahoo.com',
    'Origin': 'https://finance.yahoo.com',
  };

  const hosts = ['query2.finance.yahoo.com', 'query1.finance.yahoo.com'];

  for (const host of hosts) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);

    try {
      const response = await fetch(
        `https://${host}/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1d`,
        { signal: controller.signal, headers: YAHOO_HEADERS }
      );
      clearTimeout(timeout);

      if (!response.ok) continue;

      const data = await response.json();
      const result = data?.chart?.result?.[0];

      if (result?.meta) {
        const meta = result.meta;
        // Yahoo returns ILA (Israeli Agora) for all TASE stocks — divide by 100 to get ILS
        const divisor = meta.currency === 'ILA' ? 100 : 1;
        return {
          currentPrice: meta.regularMarketPrice / divisor,
          prevClose: meta.chartPreviousClose / divisor,
          marketTime: meta.regularMarketTime ? meta.regularMarketTime * 1000 : null,
        };
      }
    } catch (e) {
      clearTimeout(timeout);
      if (host === hosts[hosts.length - 1]) throw e;
    }
  }

  return null;
}
