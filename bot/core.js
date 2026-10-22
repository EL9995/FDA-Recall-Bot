// FDA Recall Bot on Telegram: conversation, settings and report building.
// Pure functions only. The Cloudflare Worker (worker.js) and the browser simulator (sim.html) supply
// storage, Telegram's API and the recall data, so this file behaves the same in both.
//
// Messages are plain objects the Worker turns into Telegram calls:
//   { type: 'text', html, buttons?: [label], link?: { label, url, app? } }   buttons = reply keyboard, link = inline button
//                                                                     (app: opens the page inside Telegram as a Mini App)
//   { type: 'album', items: [{ photo, thumb, caption }] }              2-10 photos, or 1 sent as a single photo
//
// Report facts always come straight from data/recalls.json (FDA.gov). Nothing here writes or rewords them.

export const SITE = 'https://el9995.github.io/FDA-Recall-Bot/';

// Friendly groups people pick from, mapped onto FDA's own product types.
// "Groceries" is every FDA type not claimed by another group.
export const GROUPS = [
  { id: 'grocery', label: 'Groceries', types: null },
  { id: 'pet', label: 'Pet food', types: ['Pet Food', 'Animal & Veterinary', 'Animal Feed'] },
  { id: 'supp', label: 'Supplements', types: ['Dietary Supplements'] },
  { id: 'baby', label: 'Baby food', types: ['Infant Formula & Foods'] },
  { id: 'cosmetics', label: 'Cosmetics', types: ['Cosmetics'] },
  { id: 'drugs', label: 'Drugs & devices', types: ['Drugs', 'Medical Devices', 'Biologics'] },
];
const CLAIMED = new Set(GROUPS.flatMap((g) => g.types || []));

const WORDS = {
  stop: ['stop', 'unsubscribe', 'cancel', 'quit', 'end'],
  help: ['help', '?', 'info'],
  start: ['start', 'menu', 'settings', 'setting', 'change', 'hi', 'hello', 'hey'],
  report: ['report', 'latest', 'now', 'recalls', 'send', 'latest report'],
  daily: ['daily', 'day', 'every day', '1'],
  weekly: ['weekly', 'week', 'every week', '2'],
  done: ['done', 'finish', 'finished', 'ok', 'save'],
  all: ['everything', 'all'],
};
const is = (t, k) => WORDS[k].includes(t);
const clean = (s) => String(s || '').toLowerCase().replace(/[✓✔️]/g, '').replace(/^\//, '').replace(/@\w+$/, '').trim(); // "/stop@Bot" -> "stop"

// ---------- dates ----------
const day = (d) => new Date(d).toISOString().slice(0, 10);
const addDays = (d, n) => { const t = new Date(d + 'T12:00:00Z'); t.setUTCDate(t.getUTCDate() + n); return day(t); };
const nice = (d) => new Date(d + 'T12:00:00Z').toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric' });

// ---------- groups and matching ----------
export function groupHas(g, types) {
  return g.types ? types.some((t) => g.types.includes(t)) : types.some((t) => !CLAIMED.has(t));
}
export function matches(user, recall) {
  return GROUPS.some((g) => user.groups.includes(g.id) && groupHas(g, recall.types));
}
// FDA types for the site link (?cats=), from the types present in the data.
export function typesFor(user, data) {
  const all = [...new Set(data.recalls.flatMap((r) => r.types))];
  if (user.groups.length === GROUPS.length) return null; // everything: no filter
  return all.filter((t) => GROUPS.some((g) => user.groups.includes(g.id) && groupHas(g, [t])));
}
const groupNames = (user) => GROUPS.filter((g) => user.groups.includes(g.id)).map((g) => g.label).join(', ');

// ---------- message helpers ----------
export const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const html = (h, buttons, link) => ({ type: 'text', html: h.slice(0, 4096), ...(buttons ? { buttons } : {}), ...(link ? { link } : {}) });
const text = (t, buttons) => html(esc(t), buttons);
const MAIN = ['Latest report', 'Settings', 'Help', 'Stop'];

function askFrequency(intro) {
  return text(`${intro ? intro + '\n\n' : ''}How often do you want a recall report?\n\nDaily: only on days with new recalls in your picks.\nWeekly: every Monday, even if it's a quiet week.`, ['Daily', 'Weekly']);
}
function askGroups(user) {
  const picked = user.groups.length ? `Picked so far: ${groupNames(user)}.` : 'Nothing picked yet.';
  const labels = GROUPS.map((g) => (user.groups.includes(g.id) ? '✓ ' : '') + g.label);
  return text(`Which recalls do you care about? Tap to pick or unpick, then tap Done.\n\n${picked}`, [...labels, 'Everything', 'Done']);
}
const HELP = `I send short reports of new FDA recalls, with the product photos FDA publishes. Facts come straight from FDA.gov.

Latest report: get one now
Settings: change how often and which recalls
Stop: unsubscribe and delete your settings

Always check the lot codes and dates on the FDA notice before throwing anything out.`;

// ---------- conversation ----------
// Returns { user, messages }: user === null means delete the record.
export function onFollow(now) {
  const user = { step: 'freq', freq: null, groups: [], created: now, lastSent: null };
  return { user, messages: [askFrequency("Hi! I'm FDA Recall Bot. I send short reports of new FDA recalls, with photos, straight from FDA.gov.\n\nI only keep your Telegram chat ID and the settings you pick here. Send Stop anytime to delete them.")] };
}

export function onText(user, input, ctx) {
  const t = clean(input);
  if (is(t, 'stop')) return { user: null, messages: [text("You're unsubscribed and your settings are deleted. Send /start anytime to sign up again.", [])] };
  if (!user || is(t, 'start')) {
    const fresh = onFollow(ctx.now).user;
    if (user) { fresh.groups = user.groups; fresh.created = user.created; fresh.lastSent = user.lastSent; }
    return { user: fresh, messages: [askFrequency(user ? null : 'Hi! I send short reports of new FDA recalls, with photos, from FDA.gov.')] };
  }
  if (is(t, 'help')) return { user, messages: [text(HELP, user.step === 'done' ? MAIN : null)] };

  if (user.step === 'freq') {
    if (is(t, 'daily') || is(t, 'weekly')) {
      const u = { ...user, freq: is(t, 'daily') ? 'daily' : 'weekly', step: 'groups' };
      return { user: u, messages: [askGroups(u)] };
    }
    return { user, messages: [askFrequency('Tap Daily or Weekly.')] };
  }

  if (user.step === 'groups') {
    if (is(t, 'all')) {
      const u = { ...user, groups: GROUPS.map((g) => g.id) };
      return { user: u, messages: [askGroups(u)] };
    }
    if (is(t, 'done')) {
      if (!user.groups.length) return { user, messages: [askGroups(user)] };
      const u = { ...user, step: 'done', lastSent: user.lastSent || ctx.now };
      const when = u.freq === 'daily' ? 'a report on days with new recalls in your picks' : 'a report every Monday';
      return { user: u, messages: [text(`All set. You'll get ${when}.\n\nYour picks: ${groupNames(u)}.\n\nWant this week's recalls now?`, MAIN)] };
    }
    const g = GROUPS.find((x) => clean(x.label) === t);
    if (g) {
      const groups = user.groups.includes(g.id) ? user.groups.filter((x) => x !== g.id) : [...user.groups, g.id];
      const u = { ...user, groups };
      return { user: u, messages: [askGroups(u)] };
    }
    return { user, messages: [askGroups(user)] };
  }

  // step === 'done'
  if (is(t, 'report')) {
    const end = day(ctx.now);
    const r = buildReport(ctx.data, user, { from: addDays(end, -6), to: end, title: 'FDA recalls, last 7 days' });
    return { user, messages: r.messages };
  }
  return { user, messages: [text("I didn't catch that. Tap one of these:", MAIN)] };
}

// ---------- reports ----------
const caption = (r) => `${r.brands || r.company}: ${r.product}\n${r.reason}\nFDA · ${nice(r.fda_publish_date)}`.slice(0, 1024);

export function reportLink(user, data, from, to) {
  const p = new URLSearchParams({ range: from === to ? 'day' : 'week', end: to, slides: '1' });
  const cats = typesFor(user, data);
  if (cats) p.set('cats', cats.join(','));
  return `${SITE}?${p}`;
}

// recalls: the list to report; or pick by FDA publish date between from and to.
export function buildReport(data, user, { from, to, title, recalls }) {
  const list = (recalls || data.recalls.filter((r) => r.fda_publish_date >= from && r.fda_publish_date <= to)).filter((r) => matches(user, r));
  if (recalls && list.length) from = list.map((r) => r.fda_publish_date).sort()[0];
  const link = reportLink(user, data, from, to);
  const range = from === to ? nice(to) : `${nice(from)} – ${nice(to)}`;
  if (!list.length) {
    return { count: 0, messages: [text(`${title} (${range})\n\nNo FDA recall notices in your picks (${groupNames(user)}).\n\nWe check FDA.gov every few hours. Not every recall is posted there.`, MAIN)] };
  }
  const shown = list.slice(0, 10);
  const lines = shown.map((r) => `• <a href="${esc(r.url)}">${esc(r.brands || r.company)}</a>: ${esc(r.reason)}`).join('\n');
  const more = list.length > 10 ? `\n…and ${list.length - 10} more` : '';
  const summary = html(`<b>${esc(title)}</b> (${esc(range)})\n\n${list.length} recall${list.length === 1 ? '' : 's'} in your picks:\n${lines}${more}\n\nTap a name for the FDA notice. Check the lot codes there before throwing anything out.`, MAIN);
  const items = shown.filter((r) => r.photos && r.photos[0]).map((r) => ({ photo: r.photos[0].src, thumb: r.photos[0].thumb, caption: caption(r) }));
  const messages = [summary];
  if (items.length) messages.push({ type: 'album', items });
  messages.push(html('Swipe through every recall and all its photos:', null, { label: 'Open slides', url: `${link}&tg=1`, app: true }));
  return { count: list.length, messages };
}

// Scheduled run. Returns the pushes to send and each user's updated record.
// Weekly users: Mondays. Daily users: only when something new in their picks appeared since the last report.
export function scheduled(users, data, now) {
  const today = day(now);
  const monday = new Date(now).getUTCDay() === 1;
  const out = [];
  for (const [id, user] of users) {
    if (user.step !== 'done') continue;
    if (user.freq === 'weekly') {
      if (!monday || (user.lastSent && day(user.lastSent) === today)) continue;
      const r = buildReport(data, user, { from: addDays(today, -7), to: addDays(today, -1), title: 'Your weekly FDA recall report' });
      out.push({ id, user: { ...user, lastSent: now }, messages: r.messages });
    } else {
      // New to us since the last report AND recently posted by FDA, so backfilled old notices never go out.
      const since = user.lastSent || user.created;
      const recent = addDays(day(since), -3);
      const fresh = data.recalls.filter((r) => r.first_seen > since && r.fda_publish_date >= recent);
      const r = buildReport(data, user, { from: today, to: today, title: 'New FDA recalls', recalls: fresh });
      if (r.count) out.push({ id, user: { ...user, lastSent: now }, messages: r.messages });
    }
  }
  return out;
}
