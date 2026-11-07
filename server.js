// I'm On A Trip — Facebook AI Chatbot
// Gemini (Google AI Studio) + Messenger auto-reply + public comment reply
// Page: I'm On A Trip (Page ID 61564997620244) — vlog + cinematic travel video
// No npm dependencies — only Node.js built-ins. Node 18+ required.
//
// Env vars (see .env.example):
//   GEMINI_API_KEY, PAGE_ACCESS_TOKEN, PAGE_ID, VERIFY_TOKEN,
//   APP_SECRET (optional, for webhook signature check),
//   GEMINI_MODEL (default gemini-2.5-flash), GRAPH_API_VERSION (default v25.0), PORT
//
// Endpoints:
//   GET  /          -> health check
//   GET  /webhook   -> Meta webhook verification (hub.challenge)
//   POST /webhook   -> Messenger messages + Page feed comments
//
// IMPORTANT: never paste GEMINI_API_KEY or PAGE_ACCESS_TOKEN in chat.
// Put them only in the hosting dashboard (Render / Railway) env vars.

const http = require('node:http');
const crypto = require('node:crypto');
const { URL } = require('node:url');

const PORT = Number(process.env.PORT || 3000);
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN || '';
const PAGE_ID = process.env.PAGE_ID || '61564997620244';
const VERIFY_TOKEN = process.env.VERIFY_TOKEN || 'shanto-bot-verify';
const APP_SECRET = process.env.APP_SECRET || '';
const GRAPH_API_VERSION = process.env.GRAPH_API_VERSION || 'v25.0';
const GRAPH = `https://graph.facebook.com/${GRAPH_API_VERSION}`;

const SYSTEM_PROMPT = `Tumi I'm On A Trip Facebook Page-er AI assistant.
Page: I'm On A Trip — vlog + cinematic travel video, shohoj Bangla-e.
Shanto ei page-e travel vlog ar cinematic travel video banay.

Niyom:
- User je bhashay likhbe (Bangla script, Roman Bangla, na English), tumi sei bhashay-i reply dibe.
- Choto ar shohoj kore bolo — Messenger-e 2-4 line, comment-e 1-2 line.
- Shudhu ei page / travel, vlog, jayga, trip, cinematic video niye bolo. Onno bishoye janle bolo "ei bishoye ami sure na, Shanto nije reply dibe".
- Kokhono nijeke manush bolbe na, kokhono password / API key / token chaibe na ba dibe na.
- Taka, payment, personal info chaile bolo inbox-e Shanto nije kotha bolbe.
- Notun trip / video kobe asbe janle na thakle onuman kore date dio na — bolo Shanto janiye dibe.`;

const seen = new Set(); // dedupe: message mids + comment ids, in-memory only
function alreadySeen(id) {
  if (!id || seen.has(id)) return true;
  seen.add(id);
  if (seen.size > 5000) seen.clear();
  return false;
}

async function askGemini(userText, isComment) {
  if (!GEMINI_API_KEY) return null;
  const prompt = isComment
    ? `${SYSTEM_PROMPT}\n\nEta ekta public Facebook comment. 1-2 line-e, bondhu-sulov bhabe reply dao. Beshi details lagle bolo inbox-e message korte.\n\nComment: ${userText}`
    : `${SYSTEM_PROMPT}\n\nUser-er message: ${userText}`;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${encodeURIComponent(GEMINI_API_KEY)}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.7, maxOutputTokens: 400 },
    }),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    console.error('Gemini error', res.status, t.slice(0, 500));
    // 429 = free-tier limit sesh — user-ke polite fallback dao
    if (res.status === 429) return 'LIMIT';
    return null;
  }
  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('').trim();
  return text || null;
}

async function graphPost(path, body) {
  if (!PAGE_ACCESS_TOKEN) {
    console.error('PAGE_ACCESS_TOKEN missing — reply pathabo na');
    return false;
  }
  const res = await fetch(`${GRAPH}${path}?access_token=${encodeURIComponent(PAGE_ACCESS_TOKEN)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) console.error('Graph error', res.status, (await res.text()).slice(0, 500));
  return res.ok;
}

async function replyMessenger(senderId, text) {
  return graphPost('/me/messages', {
    recipient: { id: senderId },
    messaging_type: 'RESPONSE',
    message: { text },
  });
}

async function replyComment(commentId, text) {
  return graphPost(`/${commentId}/comments`, { message: text });
}

function verifySignature(rawBody, signature) {
  if (!APP_SECRET) return true; // optional — set APP_SECRET in prod for safety
  if (!signature) return false;
  const expected = 'sha256=' + crypto.createHmac('sha256', APP_SECRET).update(rawBody).digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
  } catch { return false; }
}

async function handleEvent(body) {
  if (body.object !== 'page') return;
  for (const entry of body.entry || []) {
    // --- Messenger ---
    for (const ev of entry.messaging || []) {
      const senderId = ev.sender?.id;
      const msg = ev.message;
      if (!senderId || senderId === PAGE_ID || !msg || msg.is_echo) continue;
      if (msg.text && alreadySeen(msg.mid)) continue;
      const text = (msg.text || '').trim();
      if (!text) continue;
      console.log('Messenger from', senderId, ':', text.slice(0, 120));
      let reply = await askGemini(text, false);
      if (reply === 'LIMIT') reply = 'Ekhon onek message ashtese, ektu pore abar likho — ami reply dibo. Dhonnobad!';
      if (!reply) reply = 'Dhonnobad message korar jonno! Tomar proshno-ta peyechi, Shanto nijeo dekhe reply dibe.';
      await replyMessenger(senderId, reply.slice(0, 1900));
    }
    // --- Page feed comments ---
    for (const change of entry.changes || []) {
      if (change.field !== 'feed') continue;
      const v = change.value || {};
      if (v.item !== 'comment' || v.verb !== 'add') continue;
      if (!v.comment_id || v.from?.id === PAGE_ID || alreadySeen(v.comment_id)) continue;
      const text = (v.message || '').trim();
      if (!text) continue;
      console.log('Comment', v.comment_id, ':', text.slice(0, 120));
      let reply = await askGemini(text, true);
      if (reply === 'LIMIT') reply = 'Dhonnobad! Ekhon onek comment ashtese, inbox-e message korle details-e reply dibo.';
      if (!reply) reply = 'Dhonnobad comment korar jonno! Details jante inbox-e message koro.';
      await replyComment(v.comment_id, reply.slice(0, 600));
    }
  }
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (req.method === 'GET' && url.pathname === '/') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, bot: "I'm On A Trip AI bot", model: GEMINI_MODEL }));
    return;
  }
  if (req.method === 'GET' && url.pathname === '/webhook') {
    const mode = url.searchParams.get('hub.mode');
    const token = url.searchParams.get('hub.verify_token');
    const challenge = url.searchParams.get('hub.challenge');
    if (mode === 'subscribe' && token === VERIFY_TOKEN) {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end(challenge || '');
    } else {
      res.writeHead(403); res.end('Forbidden');
    }
    return;
  }
  if (req.method === 'POST' && url.pathname === '/webhook') {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const raw = Buffer.concat(chunks);
      if (!verifySignature(raw, req.headers['x-hub-signature-256'])) {
        res.writeHead(401); res.end('Bad signature'); return;
      }
      res.writeHead(200); res.end('EVENT_RECEIVED'); // Meta-ke 5 sec-er moddhe 200 dite hoy
      try { handleEvent(JSON.parse(raw.toString('utf8'))).catch((e) => console.error(e)); }
      catch (e) { console.error('Bad webhook JSON', e); }
    });
    return;
  }
  res.writeHead(404); res.end('Not found');
});

server.listen(PORT, () => console.log(`Bot server running on port ${PORT} — model ${GEMINI_MODEL}`));
