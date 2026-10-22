// Cloudflare Worker for FDA Recall Bot on Telegram.
//   POST /telegram   Telegram webhook: messages, and blocks of the bot.
//   cron             Daily run: sends reports to subscribers.
// Storage: Workers KV, one key per subscriber ("u:<Telegram chat ID>") holding only their settings.
// Secret (set in Cloudflare by the deploy workflow, never in this repo): TELEGRAM_BOT_TOKEN.
// The webhook secret Telegram sends back is derived from the token (webhookSecret below), so there's
// only one secret to manage. The deploy workflow registers the webhook with the same value.
import { onFollow, onText, scheduled, SITE } from './core.js';

const DATA_URL = SITE + 'data/recalls.json';

async function webhookSecret(token) {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('webhook:' + token));
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function sameText(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function tg(env, method, payload) {
  const res = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) console.error(`Telegram ${method} ${res.status}: ${await res.text()}`);
  return res.ok;
}

// Reply keyboard, two buttons per row, kept on screen so the main menu is always one tap away.
// An empty list removes the keyboard (after Stop).
function keyboard(labels, placeholder) {
  if (!labels.length) return { remove_keyboard: true };
  const rows = [];
  for (let i = 0; i < labels.length; i += 2) rows.push(labels.slice(i, i + 2).map((text) => ({ text })));
  return { keyboard: rows, resize_keyboard: true, is_persistent: true, ...(placeholder ? { input_field_placeholder: placeholder } : {}) };
}

// Sends one core.js message. Returns false if Telegram refused it.
async function send(env, chat_id, m) {
  if (m.type === 'text') {
    const button = m.link && (m.link.app ? { text: m.link.label, web_app: { url: m.link.url } } : { text: m.link.label, url: m.link.url });
    const reply_markup = button ? { inline_keyboard: [[button]] } : m.buttons ? keyboard(m.buttons, m.placeholder) : undefined;
    return tg(env, 'sendMessage', { chat_id, text: m.html, parse_mode: 'HTML', link_preview_options: { is_disabled: true }, reply_markup });
  }
  if (m.type === 'album') {
    // FDA's full-size photos can be over Telegram's 5 MB limit for linked files; fall back to FDA's thumbnails.
    for (const key of ['photo', 'thumb']) {
      const items = m.items.filter((i) => i[key]);
      if (!items.length) continue;
      const ok = items.length === 1
        ? await tg(env, 'sendPhoto', { chat_id, photo: items[0][key], caption: items[0].caption })
        : await tg(env, 'sendMediaGroup', { chat_id, media: items.map((i) => ({ type: 'photo', media: i[key], caption: i.caption })) });
      if (ok) return true;
    }
    return true; // photos are extra: the summary already lists every recall with its FDA link
  }
  return true;
}

async function sendAll(env, chat_id, messages) {
  for (const m of messages) if (!(await send(env, chat_id, m))) return false;
  return true;
}

async function loadData() {
  const res = await fetch(DATA_URL, { cf: { cacheTtl: 600 } });
  if (!res.ok) throw new Error(`recall data ${res.status}`);
  return res.json();
}

const getUser = async (env, id) => JSON.parse((await env.SUBSCRIBERS.get(`u:${id}`)) || 'null');
const saveUser = (env, id, user) => (user ? env.SUBSCRIBERS.put(`u:${id}`, JSON.stringify(user)) : env.SUBSCRIBERS.delete(`u:${id}`));

async function handle(env, update) {
  // Blocking the bot deletes the person's settings.
  const member = update.my_chat_member;
  if (member) {
    if (member.chat.type === 'private' && member.new_chat_member.status === 'kicked') await saveUser(env, member.chat.id, null);
    return;
  }
  const msg = update.message;
  if (!msg || msg.chat.type !== 'private' || typeof msg.text !== 'string') return; // ignore groups and non-text
  const id = msg.chat.id;
  const now = new Date().toISOString();
  const user = await getUser(env, id);
  const result = !user && /^\/start\b/.test(msg.text)
    ? onFollow(now)
    : onText(user, msg.text, { now, data: user?.step === 'done' ? await loadData() : null });
  // Browsing and searching don't change anything, so only write when the settings did (KV writes are the tightest free limit).
  if (JSON.stringify(result.user) !== JSON.stringify(user)) await saveUser(env, id, result.user);
  await sendAll(env, id, result.messages);
}

async function runReports(env) {
  const data = await loadData();
  const users = [];
  let cursor;
  do {
    const page = await env.SUBSCRIBERS.list({ prefix: 'u:', cursor });
    for (const k of page.keys) users.push([k.name.slice(2), JSON.parse(await env.SUBSCRIBERS.get(k.name))]);
    cursor = page.list_complete ? null : page.cursor;
  } while (cursor);
  const sends = scheduled(users.filter(([, u]) => u), data, new Date().toISOString());
  for (const s of sends) {
    if (await sendAll(env, s.id, s.messages)) await saveUser(env, s.id, s.user);
  }
  console.log(`report run: ${users.length} subscribers, ${sends.length} reports sent`);
}

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    if (req.method === 'GET' && url.pathname === '/') return new Response('FDA Recall Bot is running.');
    if (req.method !== 'POST' || url.pathname !== '/telegram') return new Response('Not found', { status: 404 });
    const expected = await webhookSecret(env.TELEGRAM_BOT_TOKEN);
    if (!sameText(req.headers.get('x-telegram-bot-api-secret-token'), expected)) return new Response('Bad secret', { status: 401 });
    const update = await req.json();
    ctx.waitUntil(handle(env, update).catch((e) => console.error('update failed', e)));
    return new Response('OK');
  },
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runReports(env));
  },
};
