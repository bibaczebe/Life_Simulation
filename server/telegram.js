require('dotenv').config();
const https = require('https');

const TOKEN  = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;

function sendTelegram(text) {
  if (!TOKEN || !CHAT_ID) return Promise.resolve();
  const safe = text.replace(/([_*[\]()~`>#+\-=|{}.!])/g, '\\$1').replace(/\\\*/g,'*').replace(/\\_/g,'_');
  const body = JSON.stringify({ chat_id: CHAT_ID, text: safe, parse_mode: 'MarkdownV2' });
  const opts = {
    hostname: 'api.telegram.org',
    path: `/bot${TOKEN}/sendMessage`,
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
  };
  return new Promise((resolve) => {
    const req = https.request(opts, (res) => {
      let d = ''; res.on('data', c => d+=c);
      res.on('end', () => resolve(JSON.parse(d)));
    });
    req.on('error', (e) => { console.error('[Telegram] Error:', e.message); resolve(null); });
    req.write(body); req.end();
  });
}

function formatEvent(event, world) {
  const seasonEmoji = { Lato:'☀️', Jesień:'🍂', Zima:'❄️', Wiosna:'🌸' };
  const typeEmoji   = { discovery:'💡', disaster:'💥', war:'⚔️', peace:'🕊️', era_change:'🌍', birth:'👶', death:'💀', default:'📜' };
  const emoji = typeEmoji[event.type] || '📜';
  const season = seasonEmoji[world.season] || '';

  let msg = `${emoji} *DZIEŃ ${world.day} — ${event.title.toUpperCase()}*\n\n`;
  msg += `${event.description}\n\n`;
  if (event.architectComment) msg += `🏛️ *Architekt*: _${event.architectComment}_\n\n`;
  if (event.natureComment)    msg += `⚡ *Natura*: _${event.natureComment}_\n\n`;
  msg += `${season} Era: *${world.era}* | Pop: *${world.population}* | ${world.temperature}°C`;
  return msg;
}

async function testTelegram() {
  console.log('[Telegram] Wysyłam wiadomość testową...');
  const result = await sendTelegram(
    '🌍 *LIFE SIMULATION — START*\n\nSymulacja cywilizacji uruchomiona!\nAdam i Ewa wyruszają w nieznane.\n\n_Historia się zaczyna._'
  );
  if (result?.ok) {
    console.log('[Telegram] ✅ Wysłano pomyślnie!');
  } else {
    console.error('[Telegram] ❌ Błąd:', JSON.stringify(result));
  }
  return result;
}

module.exports = { sendTelegram, formatEvent, testTelegram };
