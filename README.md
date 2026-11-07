# Im On A Trip — Facebook AI Chatbot (Gemini, free)

Messenger auto-reply + post-er comment-e public reply — dutotai kore.
AI brain: Google AI Studio (Gemini API), model `gemini-2.5-flash` — free tier-e
din-e ~1,500 request porjonto (Google-er rate limit, guarantee na — AI Studio-te
tomar project-er limit dekhte parbe). Card lage na.

**Page ID:** 61564997620244
**Page naam:** Im On A Trip — vlog + cinematic travel video page.

## Khoroch
- Gemini free tier: 0 tk (limit sesh hole bot polite fallback reply dibe, bill hobe na — karon kono billing link kora nei)
- Hosting: Render free plan-e 0 tk (free plan sleep korte pare — prothom message-e ektu deri hote pare)
- Meta app: free

## Step 1 — Gemini API key nao (5 min, nije korbe)
1. [Google AI Studio](https://aistudio.google.com/app/apikey) kholo, Google account diye login koro
2. **Create API key** > **Create API key in new project** — key-ta copy koro
3. Key-ta **chat-e paste koro na** — pore Render dashboard-e bosabe
4. Jodi key-ta hariye jay / expired dekhay, ekhan thekei notun key banano jay — free

## Step 2 — Server-ta free hosting-e dao (Render)
1. Ei folder-ta (`ai-chat-bot`) GitHub-e upload koro — private repo holeo cholbe
2. [Render](https://dashboard.render.com) > New > Web Service > oi repo select koro
3. Build: `npm install --omit=dev || true`, Start: `node server.js`
4. Environment Variables-e bosao (dashboard-e, chat-e na):
   - `GEMINI_API_KEY` = Step 1-er key
   - `PAGE_ACCESS_TOKEN` = Step 3-er Page token (age Render-e dummy bosiye rakhle pore change kora jay)
   - `PAGE_ID` = `61564997620244`
   - `VERIFY_TOKEN` = nijer ekta secret kotha, jemon `shanto-bot-verify-2026` (mone rakho)
   - `GEMINI_MODEL` = `gemini-2.5-flash`
5. Deploy hole URL pabe, jemon `https://im-on-a-trip-ai-bot.onrender.com`
   - Khule dekhle `{ "ok": true, ... }` dekhabe — mane server cholche

## Step 3 — Meta for Developers app + Page token (nije korbe, Muse guide korbe)
1. [Meta for Developers](https://developers.facebook.com) > My Apps > Create App > **Other** > **Business** type
2. App-e **Messenger** product add koro
3. Messenger > API Settings > **Access Tokens** > Page select koro (61564997620244) — ekhane je **Page Access Token** dibe, seta Step 2-er Render env-e bosao
   - Permission lagbe: `pages_messaging`, `pages_read_engagement`, `pages_manage_posts`, `pages_manage_metadata`, `pages_show_list`
   - Dev mode-e thakle shudhu Page admin / tester-ra test korte parbe — public-er jonno pore App Review lagte pare
4. **Webhooks** > Add Callback URL:
   - Callback URL: `https://<tomar-render-url>/webhook`
   - Verify Token: Step 2-er `VERIFY_TOKEN`-er motoi
   - Verify & Save chaple Meta `hub.challenge` pathabe — server thik thakle green hobe
5. Webhook Fields-e tick dao:
   - `messages`, `messaging_postbacks` (Messenger-er jonno)
   - `feed` (comment-er jonno)
6. Page-ta subscribe koro — Messenger settings theke Page-ta webhook-e add koro

## Step 4 — Test koro
1. Onno ekta Facebook account diye Page-e Messenger-e message pathao — nijer Page theke test korle trigger hobe na
2. Page-er kono post-e onno account diye comment koro — bot 1-2 line-e public reply dibe
3. Reply na ashle Render-er Logs dekho — `Messenger from ...` / `Comment ...` line ashle event ashtese, `Gemini error` thakle key/limit problem

## Bot ki bolbe?
`server.js`-er `SYSTEM_PROMPT`-e lekha ache — Bangla / Roman Bangla / English — user je bhashay likhbe, sei bhashay reply dibe. Travel, vlog, jayga, trip, cinematic video niye bolbe. Taka / personal info chaile Shanto nije reply dibe bole dibe.

## Local-e test
```bash
node server.js
# alada terminal-e:
curl "http://localhost:3000/webhook?hub.mode=subscribe&hub.verify_token=shanto-bot-verify&hub.challenge=12345"
# -> 12345 firle verify thik ache
```

## Limit mone rakho
- Free Gemini: din-e limit ache, sesh hole bot "ektu pore abar likho" bolbe
- Free-tier-er data Google product improve korte use korte pare (Google-er terms)
- Messenger-e Meta-er 24-hour window rule ache — 24 ghonta pore reply dite Human Agent tag lagte pare, ekhonkar code-e seta nei
- Comment reply: bot nijer comment-e ar Page-er nijer comment-e reply dibe na, ek-i comment-e duibar reply dibe na
