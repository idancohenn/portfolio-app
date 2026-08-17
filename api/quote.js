import { fetchQuotes } from './_quotes.js';

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

  const results = await fetchQuotes(tickerList);

  return res.status(200).json({ results });
}
