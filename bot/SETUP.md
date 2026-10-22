# Telegram bot setup

The bot lets anyone open it in Telegram, pick how often and which recalls, and get reports with FDA's photos. It runs free on Cloudflare Workers and reads the recall data the site already publishes.

Try it first with no accounts: open the [simulator](https://el9995.github.io/FDA-Recall-Bot/bot/sim.html), or `bot/sim.html` through a local web server (`python3 -m http.server` in the repo, then http://localhost:8000/bot/sim.html).

## What it stores

Only each person's Telegram chat ID, how often they want reports, and their picks. Sending **/stop**, or blocking the bot, deletes it. Names, usernames and phone numbers are never stored.

## One-time setup (about 15 minutes)

Menus move around, so if a step doesn't match what you see, follow Telegram's or Cloudflare's current help pages.

### 1. Telegram (you do this; it needs your Telegram account)

1. In Telegram, open a chat with **@BotFather** (the official one, with the blue check) and send `/newbot`.
2. Give it a display name (for example `FDA Recall Bot`) and a username ending in `bot` (for example `FDARecallBot`).
3. BotFather replies with a **token** (looks like `123456789:AA...`). That's the bot's password: keep it out of chats, commits and files.
4. Optional: `/setuserpic` in BotFather to give it a picture.

### 2. Cloudflare (you do this; it needs your account)

1. Create a free Cloudflare account.
2. **Storage & Databases → KV → Create** a namespace. Its **ID** (not a secret) goes in `bot/wrangler.toml`.
3. **My Profile → API Tokens → Create Token** with the "Edit Cloudflare Workers" template. Copy the token.
4. Copy your **Account ID** (shown on the Workers & Pages overview).

### 3. GitHub secrets (you do this)

Run each of these and paste the value when asked (it isn't shown or saved anywhere else):

```bash
gh secret set TELEGRAM_BOT_TOKEN -R EL9995/FDA-Recall-Bot
gh secret set CLOUDFLARE_API_TOKEN -R EL9995/FDA-Recall-Bot
gh secret set CLOUDFLARE_ACCOUNT_ID -R EL9995/FDA-Recall-Bot
```

Or add them in the repo on GitHub: **Settings → Secrets and variables → Actions → New repository secret**.

### 4. Deploy

Run the **Deploy Telegram bot** workflow (Actions tab → Deploy Telegram bot → Run workflow), or push any change under `bot/`. It:

1. publishes the Worker to Cloudflare (address like `https://fda-recall-bot.<your-subdomain>.workers.dev`),
2. points Telegram's webhook at it, with a secret derived from the bot token so only Telegram can call it,
3. sets the bot's command menu and description.

Then open `https://t.me/<your bot's username>` and tap **Start**.

## How it behaves

- **Start:** asks Daily or Weekly, then which recalls (Groceries, Pet food, Supplements, Baby food, Cosmetics, Drugs & devices, or Everything).
- **Weekly:** every Monday around 10 am Eastern (9 am in winter; the schedule runs on UTC), the previous Monday–Sunday, even if quiet.
- **Daily:** around 10 am Eastern, only when FDA posted something new in their picks.
- **Each report** is three messages, however many recalls there are: a summary with every recall linked to its FDA notice, an album of up to 10 product photos, and an **Open slides** button that opens the full slide deck inside Telegram (a Mini App), with every recall and photo.
- **Any time:** the menu buttons, or /report, /start (settings), /help, /stop.
- Report facts come straight from FDA.gov data. The bot never writes or rewords them.
