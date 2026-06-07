export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { chatId, message, botToken } = req.body || {};
  const token = botToken || process.env.TELEGRAM_BOT_TOKEN;

  if (!token) {
    return res.status(400).json({ error: 'Missing bot token' });
  }
  if (!chatId || !message) {
    return res.status(400).json({ error: 'Missing chatId or message' });
  }

  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: message,
      }),
    });

    const data = await response.json();
    if (!data.ok) {
      return res.status(400).json({ error: data.description || 'Telegram API error' });
    }

    return res.status(200).json({ success: true });
  } catch (e) {
    return res.status(500).json({ error: e.message || 'Failed to send message' });
  }
}
