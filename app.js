// Static meal-plan viewer. Plans come from data/plans/YYYY-MM.json, with data/seed.json as a fallback.

const SLOT_LABEL = { breakfast: "Nashta", lunch: "Dopahar ka khana", dinner: "Raat ka khana" };
const WEEKDAYS = ["Ravivar", "Somvar", "Mangalvar", "Budhvar", "Guruvar", "Shukravar", "Shanivar"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const $ = (id) => document.getElementById(id);

// ---- small helpers ------------------------------------------------------

function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === "class") node.className = v;
    else if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
    else node[k] = v;
  }
  node.append(...children.filter((c) => c != null));
  return node;
}

const store = {
  get(key) {
    try { return localStorage.getItem(key); } catch { return null; }
  },
  set(key, value) {
    try { localStorage.setItem(key, value); } catch { /* storage may be blocked; the page still works */ }
  },
  remove(key) {
    try { localStorage.removeItem(key); } catch { /* ignore */ }
  },
};

const pad = (n) => String(n).padStart(2, "0");
const toIso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const fromIso = (s) => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
const shift = (iso, n) => { const d = fromIso(iso); d.setDate(d.getDate() + n); return toIso(d); };
const label = (iso) => { const d = fromIso(iso); return `${WEEKDAYS[d.getDay()]}, ${d.getDate()} ${MONTHS[d.getMonth()]}`; };

// ---- data loading -------------------------------------------------------

const monthCache = new Map();
let seed = null;

async function fetchJson(path) {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`${path}: ${res.status}`);
  return res.json();
}

async function loadMonth(ym) {
  if (!monthCache.has(ym)) {
    monthCache.set(ym, fetchJson(`data/plans/${ym}.json`).catch(() => null));
  }
  return monthCache.get(ym);
}

async function loadSeed() {
  seed ??= await fetchJson("data/seed.json").catch(() => ({ days: [] }));
  return seed;
}

// Returns { day, fallback } or null when nothing is available at all
async function getDay(iso) {
  const month = await loadMonth(iso.slice(0, 7));
  const day = month?.days?.[iso];
  if (day) return { day, fallback: false };

  const { days } = await loadSeed();
  if (!days.length) return null;
  const dayNumber = Math.floor(fromIso(iso).getTime() / 86400000);
  return { day: days[((dayNumber % days.length) + days.length) % days.length], fallback: true };
}

// ---- state --------------------------------------------------------------

let current = toIso(new Date());

const revealKey = (iso) => `revealed:${iso}`;
const isRevealed = (iso) => store.get(revealKey(iso)) === "1";

// ---- rendering ----------------------------------------------------------

async function render() {
  $("date-label").textContent = label(current) + (current === toIso(new Date()) ? " (Aaj)" : "");
  const result = await getDay(current);
  const mealsBox = $("meals");
  mealsBox.replaceChildren();

  const note = $("day-note");
  const fallbackNote = $("fallback-note");

  if (!result) {
    note.hidden = true;
    fallbackNote.hidden = true;
    mealsBox.append(el("p", { class: "note warn" }, "Plan load nahi ho paya. Internet check karke dobara koshish karein."));
    return;
  }

  const { day, fallback } = result;
  const text = [day.festival, day.note].filter(Boolean).join(": ");
  note.hidden = !text;
  note.textContent = text;
  fallbackNote.hidden = !fallback;

  for (const meal of day.meals) mealsBox.append(mealCard(meal, current));
}

function mealCard(meal, iso) {
  const hidden = meal.surprise && !isRevealed(iso);
  const card = el("button", { class: `card${meal.surprise ? " surprise" : ""}`, type: "button" });

  if (hidden) {
    card.append(
      el("span", { class: "slot" }, SLOT_LABEL[meal.slot]),
      el("span", { class: "name" }, "🎁 Aaj ka surprise!"),
      el("span", { class: "hint" }, "Dekhne ke liye dabayein"),
    );
    card.addEventListener("click", () => {
      store.set(revealKey(iso), "1");
      render();
    });
  } else {
    card.append(
      el("span", { class: "slot" }, SLOT_LABEL[meal.slot] + (meal.surprise ? " · surprise 🎁" : "")),
      el("span", { class: "name" }, meal.name),
      el("span", { class: "desc" }, meal.desc),
      el("span", { class: "hint" }, "Recipe dekhne ke liye dabayein"),
    );
    card.addEventListener("click", () => openRecipe(meal));
  }
  return card;
}

function openRecipe(meal) {
  $("recipe-title").textContent = meal.name;
  $("recipe-desc").textContent = meal.desc;
  $("recipe-ingredients").replaceChildren(...meal.ingredients.map((i) => el("li", {}, `${i.item}: ${formatQty(i.qty, i.unit)}`)));
  $("recipe-steps").replaceChildren(...meal.steps.map((s) => el("li", {}, s)));
  $("recipe-dialog").showModal();
}

function formatQty(qty, unit) {
  const rounded = Math.round(qty * 100) / 100;
  return `${rounded} ${unit}`;
}

// ---- week view ----------------------------------------------------------

async function openWeek() {
  const list = $("week-list");
  list.replaceChildren();
  for (let i = 0; i < 7; i++) {
    const iso = shift(current, i);
    const result = await getDay(iso);
    const meals = result
      ? result.day.meals.map((m) =>
          el("span", {}, `${SLOT_LABEL[m.slot]}: ${m.surprise && !(iso === current && isRevealed(iso)) ? "🎁 Surprise" : m.name}`),
        )
      : [el("span", {}, "Plan abhi nahi hai")];
    const festival = result?.day.festival;
    list.append(
      el("div", { class: "week-row" },
        el("div", { class: "d" }, label(iso)),
        el("div", { class: "m" }, festival ? el("span", { class: "fest" }, festival) : null, ...meals),
      ),
    );
  }
  $("week-dialog").showModal();
}

// ---- shopping list ------------------------------------------------------

const shopKey = (start, days, id) => `shop:${start}:${days}:${id}`;

async function renderShopping() {
  const days = Number($("shop-range").value);
  const totals = new Map();

  for (let i = 0; i < days; i++) {
    const result = await getDay(shift(current, i));
    if (!result) continue;
    for (const meal of result.day.meals) {
      for (const ing of meal.ingredients) {
        const id = `${ing.item.toLowerCase().trim()}|${ing.unit}`;
        const entry = totals.get(id) ?? { item: ing.item.toLowerCase().trim(), unit: ing.unit, qty: 0 };
        entry.qty += ing.qty;
        totals.set(id, entry);
      }
    }
  }

  const items = [...totals.entries()].sort((a, b) => a[1].item.localeCompare(b[1].item));
  $("shop-empty").hidden = items.length > 0;
  $("shop-list").replaceChildren(
    ...items.map(([id, { item, unit, qty }]) => {
      const key = shopKey(current, days, id);
      const box = el("input", {
        type: "checkbox",
        checked: store.get(key) === "1",
        onchange: (e) => (e.target.checked ? store.set(key, "1") : store.remove(key)),
      });
      return el("li", {}, el("label", {}, box, el("span", {}, item), el("span", { class: "q" }, formatQty(qty, unit))));
    }),
  );
}

async function openShopping() {
  await renderShopping();
  $("shop-dialog").showModal();
}

// ---- wiring -------------------------------------------------------------

$("prev").addEventListener("click", () => { current = shift(current, -1); render(); });
$("next").addEventListener("click", () => { current = shift(current, 1); render(); });
$("today").addEventListener("click", () => { current = toIso(new Date()); render(); });
$("open-week").addEventListener("click", openWeek);
$("open-shop").addEventListener("click", openShopping);
$("shop-range").addEventListener("change", renderShopping);

render();
