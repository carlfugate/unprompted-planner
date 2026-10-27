"use strict";
// [un]prompted planner - vanilla JS, no build step.

const TZ_OFFSET = "-07:00"; // San Francisco, PDT (Oct 27-29, 2026)
const TRACKS = [
  { id: "Stage 1", short: "S1", color: "var(--t-s1)" },
  { id: "Stage 2", short: "S2", color: "var(--t-s2)" },
  { id: "Workshops", short: "WS", color: "var(--t-ws)" },
  { id: "Villages", short: "VL", color: "var(--t-vl)" },
];
const TRACK = Object.fromEntries(TRACKS.map(t => [t.id, t]));
const LS = { stars: "upp.stars.v2", starsV1: "upp.stars", theme: "upp.theme", day: "upp.day", track: "upp.track", view: "upp.view", starOnly: "upp.starOnly" };

// Stars are stored on this device only, as {id, title} so a star survives the
// organisers editing a talk's time/room (which changes its id): on load we
// re-match a missing id by normalised title.
function readStars() {
  try {
    const v2 = JSON.parse(localStorage.getItem(LS.stars) || "null");
    if (Array.isArray(v2)) return v2.filter(s => s && s.id);
    const v1 = JSON.parse(localStorage.getItem(LS.starsV1) || "[]");
    return v1.map(id => ({ id, title: "" }));
  } catch { return []; }
}

const state = {
  data: null,
  talks: [],
  view: ["agenda", "plan", "now"].includes(localStorage.getItem(LS.view)) ? localStorage.getItem(LS.view) : "agenda",
  day: 1,
  track: localStorage.getItem(LS.track) || "All",
  q: "",
  starOnly: localStorage.getItem(LS.starOnly) === "1",
  stars: new Set(),
  starMeta: new Map(), // id -> title, for re-matching
  orphans: [],         // starred titles no longer on the agenda
  now: new Date(),
};

const $ = s => document.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const mins = hhmm => { const [h, m] = hhmm.split(":").map(Number); return h * 60 + m; };
const at = (t, which) => new Date(`${t.date}T${t[which]}:00${TZ_OFFSET}`);
const fmtDay = iso => new Date(`${iso}T12:00:00${TZ_OFFSET}`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "America/Los_Angeles" });
const isPlannable = t => t.kind !== "break";
const clashCounts = t => t.kind === "session" || t.kind === "workshop";

// ---------- data ----------
async function load() {
  const res = await fetch("data/talks.json", { cache: "no-cache" });
  state.data = await res.json();
  state.talks = state.data.talks;
  reconcileStars();
  // Remember the chosen day for the rest of that calendar day; on a new
  // morning during the con, open on today.
  const [savedDay, savedOn] = (localStorage.getItem(LS.day) || "").split("@");
  const n = Number(savedDay);
  const today = state.data.days.indexOf(conDate(new Date())) + 1;
  const validSaved = n >= 1 && n <= state.data.days.length;
  state.day = validSaved && (savedOn === conDate(new Date()) || today === 0) ? n : (today || (validSaved ? n : 1));
  render();
}

function conDate(d) {
  return d.toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" }); // YYYY-MM-DD
}

const norm = s => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

function reconcileStars() {
  const byId = new Map(state.talks.map(t => [t.id, t]));
  const byTitle = new Map();
  for (const t of state.talks) if (isPlannable(t)) {
    const k = norm(t.title);
    byTitle.set(k, [...(byTitle.get(k) || []), t]);
  }
  state.stars = new Set(); state.starMeta = new Map(); state.orphans = [];
  for (const s of readStars()) {
    let t = byId.get(s.id);
    if (!t && s.title) {
      const cands = byTitle.get(norm(s.title)) || [];
      t = cands.find(c => !state.stars.has(c.id));
    }
    if (t) { state.stars.add(t.id); state.starMeta.set(t.id, t.title); }
    else if (s.title) state.orphans.push(s);
  }
  saveStars();
}

function saveStars() {
  const rows = [...state.stars].map(id => ({ id, title: state.talks.find(t => t.id === id)?.title || state.starMeta.get(id) || "" }));
  try {
    localStorage.setItem(LS.stars, JSON.stringify([...rows, ...state.orphans]));
    localStorage.removeItem(LS.starsV1);
  } catch { /* storage full or disabled: keep in memory */ }
}

// Ask the browser not to evict our storage (Safari otherwise may clear it
// after 7 days without a visit unless the app is added to the home screen).
function requestPersistence() {
  if (navigator.storage?.persist) navigator.storage.persist().catch(() => {});
}

// ---------- derived ----------
function overlaps(a, b) {
  return a.date === b.date && mins(a.start) < mins(b.end) && mins(b.start) < mins(a.end);
}

function clashesOf(t) {
  if (!clashCounts(t)) return [];
  return state.talks.filter(o => o.id !== t.id && state.stars.has(o.id) && clashCounts(o) && overlaps(t, o));
}

function matches(t) {
  if (state.track !== "All" && t.track !== state.track) return false;
  if (state.starOnly && !state.stars.has(t.id)) return false;
  if (state.q) {
    const hay = [t.title, t.abstract, t.track, ...t.speakers.flatMap(s => [s.name, s.affiliation])].join(" ").toLowerCase();
    if (!state.q.toLowerCase().split(/\s+/).every(w => hay.includes(w))) return false;
  }
  return true;
}

function status(t) {
  const n = state.now;
  if (n >= at(t, "end")) return "past";
  if (n >= at(t, "start")) return "live";
  return "future";
}

// ---------- render pieces ----------
function speakersLine(t) {
  return t.speakers.map(s => s.name + (s.affiliation ? ` · ${s.affiliation.split(",").pop().trim()}` : "")).join(", ");
}

function starBtn(t) {
  const on = state.stars.has(t.id);
  return `<button class="star" data-star="${t.id}" aria-pressed="${on}" aria-label="${on ? "Remove from" : "Add to"} plan: ${esc(t.title)}">
    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/></svg></button>`;
}

function card(t, { showDay = false } = {}) {
  if (t.kind === "break") {
    return `<div class="brk" style="--tc:${TRACK[t.track]?.color}">${t.start}–${t.end} · ${esc(t.title)}</div>`;
  }
  const st = status(t);
  const clash = state.stars.has(t.id) && clashesOf(t).length > 0;
  const tr = TRACK[t.track] || { short: t.track, color: "var(--line)" };
  return `<div class="card ${st === "past" ? "past" : ""}" style="--tc:${tr.color}" data-open="${t.id}" role="button" tabindex="0">
    <div class="meta">
      <span>${showDay ? fmtDay(t.date) + " · " : ""}${t.start}–${t.end}</span>
      <span class="trk">${esc(t.track)}</span>
      ${st === "live" ? `<span class="badge live">Live</span>` : ""}
      ${clash ? `<span class="badge clash">Clash</span>` : ""}
      ${t.kind === "workshop" ? `<span class="badge reg">Registration</span>` : ""}
    </div>
    <div class="title">${esc(t.title)}</div>
    ${t.speakers.length ? `<div class="who">${esc(speakersLine(t))}</div>` : ""}
    ${starBtn(t)}
  </div>`;
}

function renderChips() {
  $("#days").innerHTML = state.data.days.map((d, i) =>
    `<button class="chip ${state.day === i + 1 ? "on" : ""}" data-day="${i + 1}">Day ${i + 1}<small>${fmtDay(d)}</small></button>`).join("");
  const chips = [{ id: "All", color: "" }, ...TRACKS];
  $("#tracks").innerHTML = chips.map(t =>
    `<button class="chip ${state.track === t.id ? "on" : ""}" data-track="${t.id}">${t.color ? `<span class="dot" style="background:${t.color}"></span>` : ""}${t.id}</button>`).join("");
  $("#days").hidden = state.view === "now";
  $("#tracks").hidden = state.view !== "agenda";
}

function renderAgenda() {
  const dayTalks = state.talks.filter(t => t.day === state.day);
  const shown = dayTalks.filter(matches);
  const filtering = state.q || state.starOnly;
  const visible = filtering ? shown.filter(isPlannable) : shown;
  if (!visible.length) return `<p class="empty">Nothing matches on Day ${state.day}.</p>`;

  // Mobile list, interleaved by start time. Breaks shown once when the track filter is "All".
  const seenBreak = new Set();
  const nowLineAt = conDate(state.now) === state.data.days[state.day - 1] ? state.now : null;
  let nowDrawn = !nowLineAt;
  const items = [];
  for (const t of visible) {
    if (t.kind === "break") {
      const k = t.start + t.title;
      if (seenBreak.has(k)) continue;
      seenBreak.add(k);
    }
    if (!nowDrawn && at(t, "start") > nowLineAt) {
      items.push(`<div class="now-line" id="nowLine">now ${nowLineAt.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "America/Los_Angeles" })}</div>`);
      nowDrawn = true;
    }
    items.push(card(t));
  }
  const list = `<div class="list agenda">${items.join("")}</div>`;
  return list + renderGrid(visible, nowLineAt);
}

function renderGrid(visible, nowAt) {
  const tracks = TRACKS.filter(tr => visible.some(t => t.track === tr.id));
  if (!tracks.length) return "";
  const startMin = Math.min(...visible.map(t => mins(t.start)));
  const endMin = Math.max(...visible.map(t => mins(t.end)));
  const base = Math.floor(startMin / 30) * 30;
  const row = m => Math.round((m - base) / 5) + 3; // 2 header rows, 5-minute rows

  // Lanes: items that overlap inside one track (e.g. 3 parallel workshops) sit side by side.
  const laneOf = new Map();
  const lanes = {};
  for (const tr of tracks) {
    const ends = [];
    const items = visible.filter(t => t.track === tr.id).sort((a, b) => mins(a.start) - mins(b.start));
    for (const t of items) {
      let l = ends.findIndex(e => e <= mins(t.start));
      if (l < 0) { l = ends.length; ends.push(0); }
      ends[l] = mins(t.end);
      laneOf.set(t.id, l);
    }
    lanes[tr.id] = Math.max(1, ends.length);
  }
  // Breaks span every lane of their track.
  const firstCol = {};
  let c = 2;
  for (const tr of tracks) { firstCol[tr.id] = c; c += lanes[tr.id]; }
  const template = tracks.map(tr => lanes[tr.id] > 1
    ? `repeat(${lanes[tr.id]}, minmax(0, .62fr))`   // multi-lane tracks get more total width
    : "minmax(0, 1fr)").join(" ");

  const parts = tracks.map(tr => `<div class="colh" style="grid-column:${firstCol[tr.id]} / span ${lanes[tr.id]};--tc:${tr.color}">${tr.id}</div>`);
  for (let m = base; m < endMin; m += 30) {
    parts.push(`<div class="tick" style="grid-row:${row(m)} / span 6">${hm(m)}</div>`);
  }
  for (const t of visible) {
    const col = t.kind === "break"
      ? `${firstCol[t.track]} / span ${lanes[t.track]}`
      : `${firstCol[t.track] + laneOf.get(t.id)}`;
    const r1 = row(mins(t.start)), r2 = Math.max(row(mins(t.end)), r1 + 3);
    parts.push(`<div class="cell${lanes[t.track] > 1 && t.kind !== "break" ? " lane" : ""}" style="grid-column:${col};grid-row:${r1} / ${r2}">${card(t)}</div>`);
  }
  if (nowAt) {
    const nm = mins(nowAt.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "America/Los_Angeles" }));
    if (nm >= base && nm <= endMin) parts.push(`<div class="now-rule" style="grid-row:${row(nm)}"></div>`);
  }
  return `<div class="grid" style="grid-template-columns:56px ${template}">${parts.join("")}</div>`;
}

function renderPlan() {
  const mine = state.talks.filter(t => state.stars.has(t.id) && t.day === state.day).sort((a, b) => mins(a.start) - mins(b.start));
  const total = state.talks.filter(t => state.stars.has(t.id)).length;
  const orphanNote = state.orphans.length
    ? `<div class="clash-box"><div class="lbl">No longer on the agenda</div>${state.orphans.map((o, i) =>
        `<div class="gap">${esc(o.title)} <button class="btn" data-drop-orphan="${i}" style="min-height:32px;margin-left:6px">Dismiss</button></div>`).join("")}</div>`
    : "";
  const head = orphanNote + `<div class="plan-actions">
      <button class="btn primary" id="icsDay" ${mine.length ? "" : "disabled"}>Export Day ${state.day} (.ics)</button>
      <button class="btn" id="icsAll" ${total ? "" : "disabled"}>Export all ${total} (.ics)</button>
    </div>`;
  if (!mine.length) {
    return head + `<p class="empty">No talks starred for Day ${state.day} yet.<br>Tap the star on any talk in the Agenda to add it here.</p>`;
  }
  // Group overlapping items into clash clusters; show free gaps between clusters.
  const clusters = [];
  for (const t of mine) {
    const last = clusters[clusters.length - 1];
    if (last && clashCounts(t) && last.some(o => clashCounts(o) && overlaps(o, t))) last.push(t);
    else clusters.push([t]);
  }
  const out = [head];
  let cursor = null;
  for (const c of clusters) {
    const s = Math.min(...c.map(t => mins(t.start)));
    if (cursor !== null && s - cursor >= 15) {
      out.push(`<div class="gap">${hm(cursor)}–${hm(s)} free</div>`);
    }
    if (c.length > 1) {
      out.push(`<div class="clash-box"><div class="lbl">Clash: pick one</div>${c.map(t => card(t)).join("")}</div>`);
    } else out.push(card(c[0]));
    const e = Math.max(...c.map(t => mins(t.end)));
    cursor = cursor === null ? e : Math.max(cursor, e);
  }
  return `<div class="list">${out.join("")}</div>`;
}

const hm = m => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

function renderNow() {
  const n = state.now;
  const today = state.talks.filter(t => t.date === conDate(n) && isPlannable(t));
  const first = state.talks.find(t => isPlannable(t) && at(t, "start") > n);
  if (!today.length) {
    const lastDay = state.data.days[state.data.days.length - 1];
    if (conDate(n) > lastDay) return `<p class="empty">[un]prompted has wrapped. See you next time.</p>`;
    return `<p class="empty">Nothing on today.${first ? `<br>The conference starts ${fmtDay(first.date)} at ${first.start}.` : ""}</p>${first ? card(first, { showDay: true }) : ""}`;
  }
  const live = today.filter(t => status(t) === "live");
  const upcoming = today.filter(t => status(t) === "future");
  const nextStart = upcoming.length ? Math.min(...upcoming.map(t => mins(t.start))) : null;
  const next = upcoming.filter(t => mins(t.start) === nextStart);
  const mineNext = today.filter(t => state.stars.has(t.id) && status(t) !== "past").slice(0, 3);
  return `<div class="list">
    <div class="section-h">On now</div>
    ${live.length ? live.map(t => card(t)).join("") : `<p class="empty" style="padding:8px">Nothing running right now.</p>`}
    ${next.length ? `<div class="section-h">Next · ${hm(nextStart)}</div>${next.map(t => card(t)).join("")}` : ""}
    ${mineNext.length ? `<div class="section-h">Coming up in my plan</div>${mineNext.map(t => card(t)).join("")}` : ""}
  </div>`;
}

function render() {
  if (!state.data) return;
  renderChips();
  const main = $("#main");
  main.innerHTML = state.view === "plan" ? renderPlan() : state.view === "now" ? renderNow() : renderAgenda();
  document.querySelectorAll(".tabbar button").forEach(b => b.classList.toggle("on", b.dataset.view === state.view));
  const c = state.stars.size;
  $("#planCount").hidden = !c;
  $("#planCount").textContent = c;
  $("#starOnly").setAttribute("aria-pressed", state.starOnly);
  const upd = state.data.source_modified ? new Date(state.data.source_modified).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "America/Los_Angeles" }) + " PT" : "unknown";
  $("#foot").innerHTML = `Unofficial planner. Schedule from <a href="${esc(state.data.source)}" target="_blank" rel="noopener">unpromptedcon.org</a>, which notes the agenda is subject to change. Source last updated ${esc(upd)}. Your plan is saved on this device only; add the app to your home screen so the browser keeps it.`;
}

// ---------- detail sheet ----------
function openSheet(id) {
  const t = state.talks.find(x => x.id === id);
  if (!t) return;
  const tr = TRACK[t.track] || { color: "var(--line)" };
  const clashes = clashesOf(t);
  const on = state.stars.has(t.id);
  $("#sheetBody").innerHTML = `
    <div class="d-meta" style="--tc:${tr.color}">${fmtDay(t.date)} · ${t.start}–${t.end} · <span class="trk">${esc(t.track)}</span>${t.level ? ` · ${esc(t.level)}` : ""}</div>
    <h2 class="d-title" id="sheetTitle">${esc(t.title)}</h2>
    ${t.speakers.length ? `<ul class="d-spk">${t.speakers.map(s => `<li><b>${esc(s.name)}</b>${s.affiliation ? ` <span>${esc(s.affiliation)}</span>` : ""}</li>`).join("")}</ul>` : ""}
    <div class="d-actions">
      <button class="btn ${on ? "" : "primary"}" data-star="${t.id}" data-in-sheet="1">${on ? "Remove from plan" : "Add to plan"}</button>
      <button class="btn" data-ics="${t.id}">Add to calendar</button>
      ${t.register ? `<a class="btn" href="${esc(t.register)}" target="_blank" rel="noopener">Register (Luma)</a>` : ""}
    </div>
    ${clashes.length ? `<p class="d-clash">Overlaps with ${clashes.length} starred: ${clashes.map(c => esc(c.title)).join("; ")}</p>` : ""}
    ${t.abstract ? `<p class="d-abs">${esc(t.abstract)}</p>` : `<p class="d-meta">No abstract published.</p>`}
    ${t.details ? `<details><summary>Full workshop description and setup</summary><p class="d-abs">${esc(t.details)}</p></details>` : ""}
  `;
  const dlg = $("#sheet");
  if (!dlg.open) dlg.showModal();
}

// ---------- iCalendar ----------
function icsStamp(d) { return d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, ""); }
function icsText(s) { return String(s).replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/([,;])/g, "\\$1"); }
function fold(line) {
  const out = []; let s = line;
  while (s.length > 74) { out.push(s.slice(0, 74)); s = " " + s.slice(74); }
  out.push(s); return out.join("\r\n");
}
function downloadIcs(items, name) {
  const now = icsStamp(new Date());
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//unprompted-planner//EN", "CALSCALE:GREGORIAN"];
  for (const t of items) {
    const desc = [t.speakers.map(s => s.name + (s.affiliation ? ` (${s.affiliation})` : "")).join(", "), t.abstract, t.register ? `Register: ${t.register}` : ""].filter(Boolean).join("\n\n");
    lines.push("BEGIN:VEVENT", `UID:${t.id}@unprompted-planner`, `DTSTAMP:${now}`,
      `DTSTART:${icsStamp(at(t, "start"))}`, `DTEND:${icsStamp(at(t, "end"))}`,
      fold(`SUMMARY:${icsText(t.title)}`), fold(`LOCATION:${icsText("[un]prompted · " + t.track)}`),
      fold(`DESCRIPTION:${icsText(desc)}`), "END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  const url = URL.createObjectURL(new Blob([lines.join("\r\n") + "\r\n"], { type: "text/calendar" }));
  const a = Object.assign(document.createElement("a"), { href: url, download: name });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ---------- events ----------
document.addEventListener("click", e => {
  const el = e.target.closest("[data-star],[data-open],[data-day],[data-track],[data-view],[data-ics]");
  if (!el) return;
  if (el.dataset.star) {
    e.stopPropagation();
    const id = el.dataset.star;
    state.stars.has(id) ? state.stars.delete(id) : state.stars.add(id);
    saveStars();
    requestPersistence();
    render();
    if (el.dataset.inSheet) openSheet(id);
  } else if (el.dataset.ics) {
    const t = state.talks.find(x => x.id === el.dataset.ics);
    downloadIcs([t], `unprompted-${t.id}.ics`);
  } else if (el.dataset.open) {
    openSheet(el.dataset.open);
  } else if (el.dataset.day) {
    state.day = Number(el.dataset.day);
    localStorage.setItem(LS.day, `${state.day}@${conDate(new Date())}`);
    render(); window.scrollTo({ top: 0 });
  } else if (el.dataset.track) {
    state.track = el.dataset.track;
    localStorage.setItem(LS.track, state.track);
    render();
  } else if (el.dataset.view) {
    state.view = el.dataset.view;
    localStorage.setItem(LS.view, state.view);
    render(); window.scrollTo({ top: 0 });
    if (state.view === "agenda") scrollToNow();
  }
});
document.addEventListener("keydown", e => {
  if ((e.key === "Enter" || e.key === " ") && e.target.matches("[data-open]")) { e.preventDefault(); openSheet(e.target.dataset.open); }
});
$("#main").addEventListener("click", e => {
  const drop = e.target.closest("[data-drop-orphan]");
  if (drop) { state.orphans.splice(Number(drop.dataset.dropOrphan), 1); saveStars(); render(); return; }
  if (e.target.id === "icsDay") downloadIcs(state.talks.filter(t => state.stars.has(t.id) && t.day === state.day), `unprompted-day${state.day}.ics`);
  if (e.target.id === "icsAll") downloadIcs(state.talks.filter(t => state.stars.has(t.id)), "unprompted-plan.ics");
});
$("#sheetClose").addEventListener("click", () => $("#sheet").close());
$("#sheet").addEventListener("click", e => { if (e.target === e.currentTarget) e.currentTarget.close(); });
$("#searchBtn").addEventListener("click", () => {
  const row = $("#searchRow"); row.hidden = !row.hidden;
  $("#searchBtn").setAttribute("aria-expanded", !row.hidden);
  if (!row.hidden) $("#q").focus(); else { $("#q").value = ""; state.q = ""; render(); }
  setHeaderVar();
});
$("#q").addEventListener("input", e => { state.q = e.target.value.trim(); if (state.view !== "agenda") state.view = "agenda"; render(); });
$("#starOnly").addEventListener("click", () => { state.starOnly = !state.starOnly; localStorage.setItem(LS.starOnly, state.starOnly ? "1" : "0"); render(); });
$("#themeBtn").addEventListener("click", () => {
  const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  document.documentElement.dataset.theme = next; localStorage.setItem(LS.theme, next);
});

function scrollToNow() {
  const nl = $("#nowLine");
  if (nl && nl.offsetParent) nl.scrollIntoView({ block: "center" });
}
function setHeaderVar() {
  document.documentElement.style.setProperty("--hdr", $(".top").offsetHeight + "px");
}

// ---------- boot ----------
const savedTheme = localStorage.getItem(LS.theme);
if (savedTheme) document.documentElement.dataset.theme = savedTheme;
else if (matchMedia("(prefers-color-scheme: light)").matches) document.documentElement.dataset.theme = "light";

load().then(() => { setHeaderVar(); scrollToNow(); }).catch(err => {
  $("#main").innerHTML = `<p class="empty">Could not load the schedule (${esc(err.message)}). Check your connection and reload.</p>`;
});
setInterval(() => { state.now = new Date(); if (!$("#sheet").open) render(); }, 60_000);
addEventListener("resize", setHeaderVar);
// Keep other open tabs on this device in sync.
addEventListener("storage", e => { if (e.key === LS.stars && state.data) { reconcileStars(); render(); } });
if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
