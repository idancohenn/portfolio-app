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

  const { botToken } = req.body || {};
  const token = botToken || process.env.TELEGRAM_BOT_TOKEN;

  if (!token) {
    return res.status(400).json({ error: 'Missing bot token' });
  }

  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/getUpdates`);
    const data = await response.json();

    if (!data.ok) {
      return res.status(400).json({ error: data.description || 'Telegram API error' });
    }

    const updates = (data.result || []).filter(u => u.message?.chat?.id);
    if (updates.length === 0) {
      return res.status(404).json({
        error: 'לא נמצא Chat ID. שלח /start לבוט שלך בטלגרם ונסה שוב.',
      });
    }

    const latest = updates[updates.length - 1].message.chat;
    return res.status(200).json({
      chatId: String(latest.id),
      firstName: latest.first_name || '',
      username: latest.username || '',
    });
  } catch (e) {
    return res.status(500).json({ error: e.message || 'Failed to fetch chat ID' });
  }
}
