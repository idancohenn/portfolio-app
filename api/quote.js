export default async function handler(req, res) {
  // Enable CORS for the frontend
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const { tickers } = req.query;

  if (!tickers) {
    return res.status(400).json({ error: 'Missing tickers parameter' });
  }

  const tickerList = tickers.split(',').map(t => t.trim().toUpperCase()).filter(Boolean);

  if (tickerList.length === 0) {
    return res.status(400).json({ error: 'No valid tickers provided' });
  }

  const results = await Promise.all(tickerList.map(fetchTickerPrice));

  return res.status(200).json({ results });
}

async function fetchTickerPrice(ticker) {
  const cleanTicker = ticker.replace('.TA', '');
  const isNumeric = /^\d+$/.test(cleanTicker);
  const isILS = ticker.endsWith('.TA') || isNumeric;

  let currentPrice = null;
  let prevClose = null;
  let source = null;

  // Numeric Israeli funds — scrape Bizportal page
  if (isNumeric) {
    try {
      const bizData = await fetchBizportal(cleanTicker);
      if (bizData) {
        currentPrice = bizData.currentPrice;
        prevClose = bizData.prevClose;
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

async function fetchBizportal(paperId) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);

  try {
    const response = await fetch(
      `https://www.bizportal.co.il/capitalmarket/quote/generalview/${paperId}`,
      {
        signal: controller.signal,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html',
        }
      }
    );
    clearTimeout(timeout);
    if (!response.ok) return null;

    const html = await response.text();

    // All class="num" values on the page, in order
    const nums = [...html.matchAll(/class="num"[^>]*>([\d,.]+)/g)].map(m =>
      parseFloat(m[1].replace(/,/g, ''))
    );
    if (nums.length === 0) return null;

    const currentRate = nums[0];

    // Base rate sits right after the label "שער בסיס"
    let baseRate = null;
    const baseMatch = html.match(/שער בסיס[\s\S]*?class="num"[^>]*>([\d,.]+)/);
    if (baseMatch) baseRate = parseFloat(baseMatch[1].replace(/,/g, ''));

    if (currentRate > 0) {
      return {
        currentPrice: currentRate / 100,
        prevClose: baseRate ? baseRate / 100 : null,
      };
    }
    return null;
  } catch (e) {
    clearTimeout(timeout);
    throw e;
  }
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
          prevClose: meta.chartPreviousClose / divisor
        };
      }
    } catch (e) {
      clearTimeout(timeout);
      if (host === hosts[hosts.length - 1]) throw e;
    }
  }

  return null;
}
