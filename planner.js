// Picks each day's meals from the dish library. Deterministic: the same date always gives the same plan
// on every device, with no server and no stored state. Days are built in order from START so that the
// "no repeat within 14 days" rule holds across the whole sequence.

const START = "2026-01-01";
const END_YEARS = 20;
const GAP_DAYS = 14;
const SLOTS = ["breakfast", "lunch", "dinner"];
const SALT = "rasoi-v1";

const SEASON_NOTE = {
  winter: "Winter is here: gajar, matar, methi and palak are in season.",
  summer: "It's hot, so lighter and cooling meals today.",
  monsoon: "Monsoon weather: warm, light meals today.",
  autumn: "Pleasant weather and the start of the festive season.",
};

const monthSeason = (m) => (m === 11 || m === 12 || m <= 2 ? "winter" : m === 3 || m === 10 ? "autumn" : m <= 6 ? "summer" : "monsoon");

const dayNumber = (iso) => Math.floor(new Date(`${iso}T00:00:00Z`).getTime() / 86400000);
const isoOf = (n) => new Date(n * 86400000).toISOString().slice(0, 10);

function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619);
  return h >>> 0;
}

function mulberry32(seed) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function createPlanner(dishes, rhythm) {
  const bySlot = Object.fromEntries(SLOTS.map((s) => [s, dishes.filter((d) => d.slot === s)]));
  const reservedTags = new Set(rhythm.anchors.map((a) => a.tag));

  const startNum = dayNumber(START);
  const endNum = startNum + 365 * END_YEARS;
  const cache = new Map();
  const lastUsed = new Map();
  let built = startNum - 1; // last day number generated into the shared sequence

  function planDay(num, history) {
    const date = isoOf(num);
    const month = Number(date.slice(5, 7));
    const weekday = new Date(num * 86400000).getUTCDay();
    const rng = mulberry32(hash(date + SALT));
    const anchors = rhythm.anchors.filter((a) => a.weekday === weekday);
    const chosen = {};

    // Anchored slots first, so the special dish isn't squeezed out by the others
    const order = [...SLOTS].sort((a, b) => Number(anchors.some((x) => x.slot === b)) - Number(anchors.some((x) => x.slot === a)));

    for (const slot of order) {
      const anchor = anchors.find((a) => a.slot === slot);
      const inSeason = (d) => !d.months || d.months.includes(month);
      const fitsAnchor = (d) => (anchor ? d.tags.includes(anchor.tag) : !d.tags.some((t) => reservedTags.has(t)));
      const pool = bySlot[slot].filter((d) => inSeason(d) && fitsAnchor(d));

      const picked = Object.values(chosen);
      const hasEgg = picked.some((d) => d.tags.includes("egg"));
      const hasHeavy = picked.some((d) => d.tags.includes("heavy"));
      const ok = (d) => !(hasEgg && d.tags.includes("egg")) && !(hasHeavy && d.tags.includes("heavy"));

      // Try the full gap first, then relax if the library is too small for that slot
      let candidates = [];
      for (const gap of [GAP_DAYS, 10, 7, 3, 0]) {
        candidates = pool.filter((d) => ok(d) && num - (history.get(d.name) ?? -Infinity) >= gap);
        if (candidates.length) break;
      }
      if (!candidates.length) candidates = pool.length ? pool : bySlot[slot];

      // Dishes not made for longer get a higher chance; egg dishes are a little rarer
      const weights = candidates.map((d) => {
        const age = Math.min(num - (history.get(d.name) ?? num - 60), 60);
        return (1 + age / 10) * (d.tags.includes("egg") ? 0.5 : 1);
      });
      let r = rng() * weights.reduce((a, b) => a + b, 0);
      let idx = 0;
      while (idx < candidates.length - 1 && (r -= weights[idx]) > 0) idx++;
      chosen[slot] = candidates[idx];
    }

    const surpriseSlot = SLOTS[Math.floor(rng() * SLOTS.length)];
    const anchorNote = anchors.map((a) => a.note).filter(Boolean)[0];

    return {
      note: anchorNote ?? SEASON_NOTE[monthSeason(month)],
      festival: null,
      meals: SLOTS.map((slot) => {
        const d = chosen[slot];
        history.set(d.name, num);
        return { slot, name: d.name, desc: d.desc, surprise: slot === surpriseSlot, ingredients: d.ingredients, steps: d.steps };
      }),
    };
  }

  function getDay(iso) {
    if (cache.has(iso)) return cache.get(iso);
    const num = dayNumber(iso);

    // Outside the shared sequence: a standalone plan with no history
    if (num < startNum || num > endNum) {
      const day = planDay(num, new Map());
      cache.set(iso, day);
      return day;
    }

    for (let n = built + 1; n <= num; n++) cache.set(isoOf(n), planDay(n, lastUsed));
    built = Math.max(built, num);
    return cache.get(iso);
  }

  return { getDay };
}
