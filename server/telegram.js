require('dotenv').config();
const https = require('https');

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;

function sendTelegram(text) {
  if (!TOKEN || !CHAT_ID) return Promise.resolve();

  const body = JSON.stringify({ chat_id: CHAT_ID, text, parse_mode: 'Markdown' });
  const opts = {
    hostname: 'api.telegram.org',
    path: `/bot${TOKEN}/sendMessage`,
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
  };

  return new Promise((resolve) => {
    const req = https.request(opts, (res) => {
      let data = '';
      res.on('data', d => (data += d));
      res.on('end', () => resolve(JSON.parse(data)));
    });
    req.on('error', (e) => {
      console.error('[Telegram] Error:', e.message);
      resolve(null);
    });
    req.write(body);
    req.end();
  });
}

function formatEvent(event, world) {
  const seasonEmoji = { Lato: '☀️', Jesień: '🍂', Zima: '❄️', Wiosna: '🌸' };
  const typeEmoji = {
    discovery: '💡', disaster: '💥', war: '⚔️', peace: '🕊️',
    era_change: '🌍', death: '💀', birth: '👶', default: '📜'
  };

  const emoji = typeEmoji[event.type] || typeEmoji.default;
  const season = seasonEmoji[world.season] || '';

  let msg = `${emoji} *DZIEŃ ${world.day} — ${event.title.toUpperCase()}*\n\n`;
  msg += `${event.description}\n\n`;

  if (event.architectComment) {
    msg += `🏛️ *Architekt Postępu*:\n_"${event.architectComment}"_\n\n`;
  }
  if (event.natureComment) {
    msg += `⚡ *Siła Natury*:\n_"${event.natureComment}"_\n\n`;
  }

  msg += `${season} Era: *${world.era}* | Populacja: *${world.population}* | Temp: *${world.temperature}°C*`;
  return msg;
}

async function testTelegram() {
  console.log('[Telegram] Wysyłam wiadomość testową...');
  const result = await sendTelegram(
    '🌍 *LIFE SIMULATION — START*\n\nSymulacja cywilizacji uruchomiona\\!\n\nDwa pierwsze Thronglety wkroczyły na świat\\. Historia się zaczyna\\.\n\n_"Niech wszystko się zacznie\\."_'
      .replace(/\\/g, '')
  );
  if (result && result.ok) {
    console.log('[Telegram] ✅ Wiadomość testowa wysłana pomyślnie!');
  } else {
    console.error('[Telegram] ❌ Błąd:', result);
  }
  return result;
}

module.exports = { sendTelegram, formatEvent, testTelegram };
