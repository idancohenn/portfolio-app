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

  // For numeric ILS (Israeli ETFs/funds), try Bizportal first
  if (isILS && isNumeric) {
    try {
      const bizportalData = await fetchBizportal(cleanTicker);
      if (bizportalData) {
        currentPrice = bizportalData.currentPrice;
        prevClose = bizportalData.prevClose;
        source = 'bizportal';
      }
    } catch (e) {
      console.error(`Bizportal failed for ${ticker}:`, e.message);
    }
  }

  // Fallback to Yahoo Finance for all stocks
  if (currentPrice === null) {
    try {
      const yahooTicker = isILS && !ticker.includes('.') ? `${ticker}.TA` : ticker;
      const yahooData = await fetchYahoo(yahooTicker, isNumeric);
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
  const timeout = setTimeout(() => controller.abort(), 8000);

  try {
    const response = await fetch(
      `https://gw.bizportal.co.il/api/quote/paper/${paperId}`,
      { 
        signal: controller.signal,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      }
    );
    clearTimeout(timeout);

    if (!response.ok) return null;

    const data = await response.json();
    
    if (data?.lastRate > 0) {
      return {
        currentPrice: parseFloat(data.lastRate) / 100,
        prevClose: parseFloat(data.baseRate) / 100
      };
    }
    return null;
  } catch (e) {
    clearTimeout(timeout);
    throw e;
  }
}

async function fetchYahoo(ticker, isNumericILS = false) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);

  try {
    const response = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1d`,
      { 
        signal: controller.signal,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      }
    );
    clearTimeout(timeout);

    if (!response.ok) return null;

    const data = await response.json();
    const result = data?.chart?.result?.[0];
    
    if (result?.meta) {
      const meta = result.meta;
      // Numeric ILS symbols on Yahoo come in agorot, divide by 100
      const divisor = isNumericILS ? 100 : 1;
      
      return {
        currentPrice: meta.regularMarketPrice / divisor,
        prevClose: meta.chartPreviousClose / divisor
      };
    }
    return null;
  } catch (e) {
    clearTimeout(timeout);
    throw e;
  }
}
