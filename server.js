// I'm On A Trip — Facebook AI Chatbot
// Gemini (Google AI Studio) + Messenger auto-reply + public comment reply
// Page: I'm On A Trip (Page ID 400909476443586) — vlog + cinematic travel video
// No npm dependencies — only Node.js built-ins. Node 18+ required.
//
// Env vars (see .env.example):
//   GEMINI_API_KEY, OPENROUTER_API_KEY, GROQ_API_KEY,
//   PAGE_ACCESS_TOKEN, PAGE_ID, VERIFY_TOKEN,
//   APP_SECRET (optional, for webhook signature check),
//   GEMINI_MODEL (default gemini-3.8-flash), GRAPH_API_VERSION (default v25.0), PORT
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
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-3.8-flash';
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || '';
// Free model ek ek somoy bodle jay (Llama 3.3 :free ar free nai) — tai chain:
// ekta na cholle porer-ta try korbe. Env-e OPENROUTER_MODELS diye bodlano jay.
const OPENROUTER_MODELS = (process.env.OPENROUTER_MODELS
  || 'google/gemma-4-26b-a4b-it:free,google/gemma-4-31b-it:free,nvidia/nemotron-3.5-lightning:free,nvidia/nemotron-3-ultra-550b-a55b:free')
  .split(',').map((s) => s.trim()).filter(Boolean);
if (process.env.OPENROUTER_MODEL && !OPENROUTER_MODELS.includes(process.env.OPENROUTER_MODEL)) {
  OPENROUTER_MODELS.unshift(process.env.OPENROUTER_MODEL);
}
// Groq — free tier, alada limit, tai age try hobe.
// SOTORKO: llama-3.1-8b-instant ar llama-3.3-70b-versatile Groq 2026-08-16-e
// Free/Developer tier theke soriye diyeche (ekhon Enterprise only) — tai
// 2026-11-07-e oi duita model-e 404 esechilo. Groq-er official replacement:
// openai/gpt-oss-20b age (choto, 1000 tps), tarpor openai/gpt-oss-120b.
// Duita-i Production model, Groq docs (console.groq.com/docs/models) 2026-11-07-e verify kora.
// Env-e GROQ_MODELS diye bodlano jay.
const GROQ_API_KEY = process.env.GROQ_API_KEY || '';
const GROQ_MODELS = (process.env.GROQ_MODELS
  || 'openai/gpt-oss-20b,openai/gpt-oss-120b')
  .split(',').map((s) => s.trim()).filter(Boolean);
const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN || '';
const PAGE_ID = process.env.PAGE_ID || '400909476443586';
const VERIFY_TOKEN = process.env.VERIFY_TOKEN || 'shanto-bot-verify';
const APP_SECRET = process.env.APP_SECRET || '';
const GRAPH_API_VERSION = process.env.GRAPH_API_VERSION || 'v25.0';
const GRAPH = `https://graph.facebook.com/${GRAPH_API_VERSION}`;

const SYSTEM_PROMPT = `Tumi I'm On A Trip Facebook Page-er AI assistant.
Page: I'm On A Trip — vlog + cinematic travel video, shohoj Bangla-e.
Shanto ei page-e travel vlog ar cinematic travel video banay.

Niyom:
- User je bhashay likhbe (Bangla script, Roman Bangla, na English), tumi sei bhashay-i reply dibe.
- Khubi choto ar guchano kore bolo — Messenger-e 2-3 line-er beshi na, comment-e 1-2 line.
- Ekta proshner ekta-i soja uttor dao. Ghuriye-pechiye bolo na, ekoi kotha barbar bolo na, lomba vumika ba bekkha dio na.
- Shudhu ei page / travel, vlog, jayga, trip, cinematic video niye bolo. Onno bishoye janle bolo "ei bishoye ami sure na, Shanto nije reply dibe".
- Kokhono nijeke manush bolbe na, kokhono password / API key / token chaibe na ba dibe na.
- Taka, payment, personal info chaile bolo inbox-e Shanto nije kotha bolbe.
- Notun trip / video kobe asbe janle na thakle onuman kore date dio na — bolo Shanto janiye dibe.
- Tour-er plan, jayga, khoroch ba date jana na thakle kichu baniye likhbe na — kono jaygar ba bazar-er naam onuman kore bosabe na, shudhu bolo Shanto janiye dibe.
- Shudhu Bangla ba English-e likhbe — onno kono bhashar shobdo mishabe na.`;

const seen = new Set(); // dedupe: message mids + comment ids, in-memory only
function alreadySeen(id) {
  if (!id || seen.has(id)) return true;
  seen.add(id);
  if (seen.size > 5000) seen.clear();
  return false;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Reasoning model majhe majhe <think>...</think> block pathay — seta kete
// shudhu asol reply-ta rakho, jate kotha elo-melo na lage.
function cleanReply(text) {
  return (text || '')
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// fetch-e timeout na thakle Google jhulle call konodin sesh hoy na —
// tokhon OpenRouter-o try hoy na, fallback-o pathano hoy na, kono reply-i ase na.
// Tai prottek AI/Graph call-e 20s (Graph-e 15s) timeout.
async function fetchWithTimeout(url, options, ms) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...options, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

// Backup AI: OpenRouter free models (chain) — Gemini fail korle ba quota sesh hole use hobe.
// Prottek model 1 bar kore try kore; kono-ta na cholle porer model.
async function askOpenRouter(userText, isComment) {
  if (!OPENROUTER_API_KEY) return null;
  const userPrompt = isComment
    ? `Eta ekta public Facebook comment. 1-2 line-e, bondhu-sulov bhabe reply dao. Beshi details lagle bolo inbox-e message korte.\n\nComment: ${userText}`
    : `User-er message: ${userText}`;
  for (const model of OPENROUTER_MODELS) {
    try {
      const res = await fetchWithTimeout('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${OPENROUTER_API_KEY}`,
          'HTTP-Referer': 'https://im-on-a-trip-ai-bot.onrender.com',
          'X-Title': "I'm On A Trip AI bot",
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: userPrompt },
          ],
          temperature: 0.5,
          max_tokens: 300,
        }),
      }, 20000);
      if (res.ok) {
        const data = await res.json();
        const text = cleanReply(data?.choices?.[0]?.message?.content);
        if (text) return text;
      } else {
        const t = await res.text().catch(() => '');
        console.error('OpenRouter error', res.status, `(${model})`, t.slice(0, 300));
      }
    } catch (e) {
      console.error('OpenRouter fetch failed', `(${model})`, e.message);
    }
  }
  return null;
}

// Groq — OpenAI-compatible API, tai OpenRouter-er motoi call.
// GROQ_API_KEY na thakle skip korbe (null), bot ager motoi cholbe.
async function askGroq(userText, isComment) {
  if (!GROQ_API_KEY) return null;
  const userPrompt = isComment
    ? `Eta ekta public Facebook comment. 1-2 line-e, bondhu-sulov bhabe reply dao. Beshi details lagle bolo inbox-e message korte.\n\nComment: ${userText}`
    : `User-er message: ${userText}`;
  for (const model of GROQ_MODELS) {
    try {
      const res = await fetchWithTimeout('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${GROQ_API_KEY}`,
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: userPrompt },
          ],
          temperature: 0.5,
          max_tokens: 300,
        }),
      }, 20000);
      if (res.ok) {
        const data = await res.json();
        const text = cleanReply(data?.choices?.[0]?.message?.content);
        if (text) return text;
      } else {
        const t = await res.text().catch(() => '');
        console.error('Groq error', res.status, `(${model})`, t.slice(0, 300));
      }
    } catch (e) {
      console.error('Groq fetch failed', `(${model})`, e.message);
    }
  }
  return null;
}

async function askGemini(userText, isComment) {
  if (!GEMINI_API_KEY) return null;
  const prompt = isComment
    ? `${SYSTEM_PROMPT}\n\nEta ekta public Facebook comment. 1-2 line-e, bondhu-sulov bhabe reply dao. Beshi details lagle bolo inbox-e message korte.\n\nComment: ${userText}`
    : `${SYSTEM_PROMPT}\n\nUser-er message: ${userText}`;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${encodeURIComponent(GEMINI_API_KEY)}`;
  // Retry: gemini-3.8-flash majhe majhe 503 (overloaded) dey — 3 bar try koro,
  // tarpor-o na hole fallback. 429 = free-tier limit, retry kore lav nai.
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetchWithTimeout(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.5, maxOutputTokens: 300 },
        }),
      }, 20000);
      if (res.ok) {
        const data = await res.json();
        const text = cleanReply(data?.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join(''));
        return text || null;
      }
      const t = await res.text().catch(() => '');
      console.error('Gemini error', res.status, `(try ${attempt}/3)`, t.slice(0, 500));
      if (res.status === 429) return 'LIMIT'; // 429 = free-tier limit sesh
      if (res.status !== 503 && res.status !== 500 && res.status !== 502) return null;
      if (attempt < 3) await sleep(attempt * 2000); // 2s, tarpor 4s
    } catch (e) {
      console.error('Gemini fetch failed', `(try ${attempt}/3)`, e.message);
      if (attempt < 3) await sleep(attempt * 2000);
    }
  }
  return null;
}

// Main AI: Groq age (free, alada limit — gpt-oss-20b/120b),
// tarpor OpenRouter, tarpor Gemini backup.
// Gemini free tier-e gemini-3.8-flash-er daily limit matro 20 request —
// tai Gemini primary thakle ekdin-ei limit sesh hoye jeto. Sob fail korle null/LIMIT.
async function askAI(userText, isComment) {
  const q = await askGroq(userText, isComment);
  if (q) return q;
  const o = await askOpenRouter(userText, isComment);
  if (o) return o;
  const g = await askGemini(userText, isComment);
  return g; // asol reply, 'LIMIT' (Gemini free-tier limit) ba null
}

async function graphPost(path, body) {
  if (!PAGE_ACCESS_TOKEN) {
    console.error('PAGE_ACCESS_TOKEN missing — reply pathabo na');
    return false;
  }
  const res = await fetchWithTimeout(`${GRAPH}${path}?access_token=${encodeURIComponent(PAGE_ACCESS_TOKEN)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }, 15000);
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
      let reply = await askAI(text, false);
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
      let reply = await askAI(text, true);
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
      try {
        const parsed = JSON.parse(raw.toString('utf8'));
        // Debug: prottek webhook event-er summary log koro — comment event
        // asche kina, ar ashle kon field/item/verb niye asche, bojha jabe.
        for (const e of parsed.entry || []) {
          console.log('Webhook entry', JSON.stringify({
            messaging: (e.messaging || []).length,
            changes: (e.changes || []).map((c) => ({ field: c.field, item: c.value?.item, verb: c.value?.verb })),
          }));
        }
        handleEvent(parsed).catch((e) => console.error(e));
      }
      catch (e) { console.error('Bad webhook JSON', e); }
    });
    return;
  }
  res.writeHead(404); res.end('Not found');
});

server.listen(PORT, () => console.log(`Bot server running on port ${PORT} — model ${GEMINI_MODEL}`));
