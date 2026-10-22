// FDA Recall Bot on Telegram: conversation, settings and report building.
// Pure functions only. The Cloudflare Worker (worker.js) and the browser simulator (sim.html) supply
// storage, Telegram's API and the recall data, so this file behaves the same in both.
//
// Messages are plain objects the Worker turns into Telegram calls:
//   { type: 'text', html, buttons?: [label], placeholder?, link?: { label, url, app? } }   buttons = reply keyboard, link = inline button
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
  // 'daily' is the stored value for "New recalls only" (checked every morning), kept so existing subscribers carry over.
  daily: ['new recalls only', 'new recalls', 'new only', 'new', 'daily', 'day', 'every day', '1'],
  weekly: ['weekly summary', 'summary', 'weekly', 'week', 'every week', '2'],
  done: ['done', 'finish', 'finished', 'ok', 'save'],
  all: ['everything', 'all'],
  past: ['past reports', 'past', 'history', 'browse', 'archive', 'older'],
  search: ['search', 'find', 'look up', 'lookup'],
  byWeek: ['by week', 'weeks'],
  byMonth: ['by month', 'months'],
  back: ['back'],
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
// With the main menu showing, the message box hints that typing anything searches.
const SEARCH_HINT = 'Type a food or brand to check for recalls';
const html = (h, buttons, link) => ({ type: 'text', html: h.slice(0, 4096), ...(buttons ? { buttons } : {}), ...(buttons === MAIN ? { placeholder: SEARCH_HINT } : {}), ...(link ? { link } : {}) });
const text = (t, buttons) => html(esc(t), buttons);
const MAIN = ['Latest report', 'Past reports', 'Search', 'Settings', 'Help', 'Stop'];

const FREQ = ['New recalls only', 'Weekly summary'];
function askFrequency(intro) {
  return text(`${intro ? intro + '\n\n' : ''}How should I keep you posted?\n\nNew recalls only: a message only when FDA posts a new recall in your picks (I check every morning). Quiet days, no message.\nWeekly summary: every Monday, last week's recalls, even if it was quiet.`, FREQ);
}
function askGroups(user, intro) {
  const picked = user.groups.length ? `Picked so far: ${groupNames(user)}.` : 'Nothing picked yet.';
  const labels = GROUPS.map((g) => (user.groups.includes(g.id) ? '✓ ' : '') + g.label);
  return text(`${intro ? intro + '\n\n' : ''}Which recalls do you care about? Tap to pick or unpick, then tap Done.\n\n${picked}`, [...labels, 'Everything', 'Done']);
}
const howOften = (u) => (u.freq === 'daily' ? 'a message whenever FDA posts a new recall in your picks (checked every morning, 10 am Eastern)' : 'a summary every Monday');
const HELP = `I send short reports of new FDA recalls, with the product photos FDA publishes. Facts come straight from FDA.gov.

Type any food or brand (like "broccoli") to see its recalls from the past year.

Latest report: the last 7 days
Past reports: any week or month in the past year
Settings: change how often and which recalls
Stop: unsubscribe and delete your settings

Always check the lot codes and dates on the FDA notice before throwing anything out.`;

// ---------- conversation ----------
// Returns { user, messages }: user === null means delete the record.
// Signup: pick categories -> a welcome report of the past 30 days -> New recalls only or Weekly summary.
// Settings later runs the same steps without the welcome report.
export function onFollow(now) {
  const user = { step: 'groups', freq: null, groups: [], created: now, lastSent: null };
  return { user, messages: [askGroups(user, "Hi! I'm FDA Recall Bot. I send FDA recalls, with the product photos, straight from FDA.gov.\n\nI only keep your Telegram chat ID and the settings you pick here. Send Stop anytime to delete them.")] };
}

export function onText(user, input, ctx) {
  const t = clean(input);
  if (is(t, 'stop')) return { user: null, messages: [text("You're unsubscribed and your settings are deleted. Send /start anytime to sign up again.", [])] };
  if (!user) return onFollow(ctx.now);
  if (is(t, 'start')) {
    const u = { ...user, step: 'groups', welcomed: true };
    return { user: u, messages: [askGroups(u, 'Settings. Your picks are ticked below.')] };
  }
  if (is(t, 'help')) return { user, messages: [text(HELP, user.step === 'done' ? MAIN : null)] };

  if (user.step === 'groups') {
    if (is(t, 'all')) {
      const u = { ...user, groups: GROUPS.map((g) => g.id) };
      return { user: u, messages: [askGroups(u)] };
    }
    if (is(t, 'done')) {
      if (!user.groups.length) return { user, messages: [askGroups(user)] };
      const u = { ...user, step: 'freq', welcomed: true };
      if (user.welcomed) return { user: u, messages: [askFrequency(`Your picks: ${groupNames(u)}.`)] };
      // First signup: show what they'd have missed, then ask how to keep them posted.
      const end = day(ctx.now);
      const welcome = buildReport(ctx.data, u, { from: addDays(end, -29), to: end, title: 'Welcome! FDA recalls in your picks, past 30 days' });
      return { user: u, messages: [...welcome.messages, askFrequency(null)] };
    }
    const g = GROUPS.find((x) => clean(x.label) === t);
    if (g) {
      const groups = user.groups.includes(g.id) ? user.groups.filter((x) => x !== g.id) : [...user.groups, g.id];
      const u = { ...user, groups };
      return { user: u, messages: [askGroups(u)] };
    }
    return { user, messages: [askGroups(user)] };
  }

  if (user.step === 'freq') {
    if (!user.groups.length) { const u = { ...user, step: 'groups' }; return { user: u, messages: [askGroups(u)] }; }
    if (is(t, 'daily') || is(t, 'weekly')) {
      // New recalls count from now on (signup), so nobody gets the welcome report again.
      const u = { ...user, freq: is(t, 'daily') ? 'daily' : 'weekly', step: 'done', lastSent: user.lastSent || ctx.now };
      return { user: u, messages: [text(`All set. You'll get ${howOften(u)}.\n\nYour picks: ${groupNames(u)}.\n\nTip: type any food or brand, like "broccoli" or "Gelatelli", to see its FDA recalls from the past year.`, MAIN)] };
    }
    return { user, messages: [askFrequency('Tap one of these:')] };
  }

  // step === 'done'
  if (is(t, 'report')) {
    const end = day(ctx.now);
    const r = buildReport(ctx.data, user, { from: addDays(end, -6), to: end, title: 'FDA recalls, last 7 days' });
    return { user, messages: r.messages };
  }
  if (is(t, 'past')) return { user, messages: [text('Browse past reports by week or by month?', ['By week', 'By month', 'Back'])] };
  if (is(t, 'byWeek')) return { user, messages: [text('Which week? Your picks apply.', [...weeks(ctx).map((w) => w.label), 'By month', 'Back'])] };
  if (is(t, 'byMonth')) return { user, messages: [text('Which month? Your picks apply.', [...months(ctx).map((m) => m.label), 'By week', 'Back'])] };
  if (is(t, 'back')) return { user, messages: [text('What next?', MAIN)] };
  if (is(t, 'search')) return { user, messages: [text('Type a brand, product or company, like "Gelatelli" or "peanut butter". I\'ll look through every FDA recall from the past year, in every category.', MAIN)] };
  const period = [...weeks(ctx), ...months(ctx)].find((x) => clean(x.label) === t);
  if (period) return { user, messages: buildReport(ctx.data, user, { from: period.from, to: period.to, title: `FDA recalls, ${period.title}`, range: period.range }).messages };
  // Anything else with letters in it is a search.
  if (/[a-z]{2}/.test(t)) return { user, messages: buildReport(ctx.data, user, { title: `Recalls matching "${input.trim().slice(0, 60)}"`, search: t }).messages };
  return { user, messages: [text("I didn't catch that. Tap one of these, or type a brand or product to search:", MAIN)] };
}

// ---------- past periods (UTC dates; weeks run Monday to Sunday) ----------
const oldest = (data) => (data.recalls.length ? data.recalls.map((r) => r.fda_publish_date).sort()[0] : day(Date.now()));
function weeks(ctx) {
  const today = day(ctx.now);
  const monday = addDays(today, -((new Date(today + 'T12:00:00Z').getUTCDay() + 6) % 7));
  const out = [];
  for (let i = 0; i < 8; i++) {
    const from = addDays(monday, -7 * i);
    if (addDays(from, 6) < oldest(ctx.data)) break;
    out.push({ label: i === 0 ? 'This week' : i === 1 ? 'Last week' : `Week of ${nice(from)}`, title: `week of ${nice(from)}`, from, to: addDays(from, 6), range: 'week' });
  }
  return out;
}
function months(ctx) {
  const today = day(ctx.now);
  const out = [];
  let y = +today.slice(0, 4), m = +today.slice(5, 7);
  for (let i = 0; i < 12; i++) {
    const from = `${y}-${String(m).padStart(2, '0')}-01`;
    const next = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`;
    const to = addDays(next, -1);
    if (to < oldest(ctx.data)) break;
    const label = new Date(from + 'T12:00:00Z').toLocaleDateString('en-US', { timeZone: 'UTC', month: 'long', year: 'numeric' });
    out.push({ label, title: label, from, to, range: 'month' });
    if (--m === 0) { m = 12; y--; }
  }
  return out;
}

// ---------- search: every word must appear in the brand, product, company or reason ----------
export function searchRecalls(data, query) {
  const words = clean(query).split(/\s+/).filter((w) => w.length > 1);
  if (!words.length) return [];
  return data.recalls.filter((r) => {
    const hay = [r.brands, r.product, r.company, r.reason].join(' ').toLowerCase();
    return words.every((w) => hay.includes(w));
  });
}

// ---------- reports ----------
const caption = (r) => `${r.brands || r.company}: ${r.product}\n${r.reason}\nFDA · ${nice(r.fda_publish_date)}`.slice(0, 1024);

export function reportLink(user, data, from, to, range) {
  const p = new URLSearchParams({ range: range || (from === to ? 'day' : 'week'), end: to, slides: '1' });
  const cats = typesFor(user, data);
  if (cats) p.set('cats', cats.join(','));
  return `${SITE}?${p}`;
}

// recalls: the list to report; or pick by FDA publish date between from and to (range: day, week or month).
// search: report every recall matching the words instead, in every category, newest first.
export function buildReport(data, user, { from, to, title, recalls, range, search }) {
  const list = search
    ? searchRecalls(data, search)
    : (recalls || data.recalls.filter((r) => r.fda_publish_date >= from && r.fda_publish_date <= to)).filter((r) => matches(user, r));
  if (recalls && list.length) from = list.map((r) => r.fda_publish_date).sort()[0];
  const link = search ? `${SITE}?${new URLSearchParams({ q: search, slides: '1' })}` : reportLink(user, data, from, to, range);
  const when = search ? 'past year' : from === to ? nice(to) : `${nice(from)} – ${nice(to)}`;
  if (!list.length) {
    const why = search
      ? 'No FDA recall in the past year matched that. FDA notices use the names printed on the package, so try one distinctive word, like the brand.'
      : `No FDA recall notices in your picks (${groupNames(user)}).\n\nWe check FDA.gov every few hours. Not every recall is posted there.`;
    return { count: 0, messages: [text(`${title} (${when})\n\n${why}`, MAIN)] };
  }
  const shown = list.slice(0, 10);
  const dated = search || (from !== to);
  const lines = shown.map((r) => `• ${dated ? `${esc(nice(r.fda_publish_date))} · ` : ''}<a href="${esc(r.url)}">${esc(r.brands || r.company)}</a>: ${esc(r.reason)}${r.terminated ? ' <i>(closed by FDA)</i>' : ''}`).join('\n');
  const more = list.length > 10 ? `\n…and ${list.length - 10} more in the slides` : '';
  const found = search ? `${list.length} match${list.length === 1 ? '' : 'es'}` : `${list.length} recall${list.length === 1 ? '' : 's'} in your picks`;
  const closedNote = shown.some((r) => r.terminated) ? '\n\n"Closed by FDA" means the company finished its recall. A product already in your home can still be affected.' : '';
  const summary = html(`<b>${esc(title)}</b> (${esc(when)})\n\n${found}:\n${lines}${more}\n\nTap a name for the FDA notice. Check the lot codes there before throwing anything out.${closedNote}`, MAIN);
  const items = shown.filter((r) => r.photos && r.photos[0]).map((r) => ({ photo: r.photos[0].src, thumb: r.photos[0].thumb, caption: caption(r) }));
  const messages = [summary];
  if (items.length) messages.push({ type: 'album', items });
  messages.push(html('Swipe through every recall and all its photos:', null, { label: 'Open slides', url: `${link}&tg=1`, app: true }));
  return { count: list.length, messages };
}

// Scheduled run. Returns the pushes to send and each user's updated record.
// Weekly users: Mondays. New-recalls-only users (stored as 'daily'): only when something new in their picks appeared since the last report.
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
