import { $, el, icon, iconButton } from "./dom.js";
import { ME, send, connect } from "./net.js";
import { PART, STEP_LABEL, COLORS, NAME_KEY, cardSrc } from "./data.js";
import { toast } from "./toast-share.js";
import { ctx, tone, sfx } from "./sound.js";
import { sites, makeSite, disposeSite } from "./sites.js";
import { setBuilt } from "./animation.js";
import { intro } from "./intro.js";
import { leaveIntro, afterLeaveIntro } from "./camera.js";
import "./online.js";

// ── game state → screen ─────────────────────────────────────────────────────

let view = null;
let status = "waiting";
let lastSeq = -1;
let selected = [];
let stormPick = false;
let autoSat = false;
let replay = null; // {bots, sent}: computers to bring back after "play again"
let lastMsg = null; // the latest state frame, to redraw the HUD when the intro closes
let turnDeadline = null; // performance.now() when the current turn runs out
let lastTick = null;

function nameOf(id) {
  const p = view?.players.find((x) => x.id === id);
  return p?.name || "Тоглогч";
}

function orderPlayers(players) {
  // you first (centre site), others keep table order
  const mine = players.filter((p) => p.id === ME);
  return [...mine, ...players.filter((p) => p.id !== ME)];
}

function syncSites(animate) {
  const players = view && view.phase !== "lobby" ? orderPlayers(view.players) : orderPlayers(view?.players ?? []);
  const ids = new Set(players.map((p) => p.id));
  for (const [id, site] of sites) {
    if (!ids.has(id)) { disposeSite(site); sites.delete(id); }
  }
  players.forEach((p, i) => {
    let site = sites.get(p.id);
    if (site && site.index !== i) { disposeSite(site); sites.delete(p.id); site = null; }
    if (!site) { site = makeSite(i); sites.set(p.id, site); site.shown = 0; }
    const color = COLORS[view.players.findIndex((x) => x.id === p.id) % COLORS.length];
    const active = view.turn === p.id && view.phase === "playing";
    const text = `${p.name || "..."}${p.id === ME ? " (та)" : ""}`;
    const key = `${text}|${color}|${active}`;
    if (key !== site.labelKey) { site.label.draw(text, color, active); site.labelKey = key; }
    site.glow.visible = active;
    setBuilt(site, p.built.length, animate);
  });
}

function onState(msg) {
  const prevSeq = lastSeq;
  status = msg.status;
  view = msg.view;
  if (!view) return;
  lastMsg = msg;
  // back in a round that is still going (a reload): straight to the table
  const mine = view.players.find((p) => p.id === ME);
  if (intro.on && view.phase === "playing" && mine && mine.handCount + mine.built.length > 0) leaveIntro(true);
  const isNew = view.seq !== prevSeq;
  lastSeq = view.seq;
  turnDeadline = msg.turnEndsIn == null ? null : performance.now() + msg.turnEndsIn;
  tickTimer();

  // re-seat automatically after a reset, using the saved name
  const savedName = localStorage.getItem(NAME_KEY);
  const meIn = view.players.find((p) => p.id === ME);
  if (view.phase === "lobby" && savedName && (!meIn || !meIn.name) && !autoSat && msg.seats.includes(ME)) {
    autoSat = true;
    send({ type: "action", action: { type: "sit", name: savedName } });
  }
  if (view.phase !== "lobby") autoSat = false;

  // "play again" with computers: re-add them one per update, then wait in the lobby for "start"
  if (replay && view.phase === "lobby" && meIn?.name && replay.sent !== view.seq) {
    replay.sent = view.seq;
    const bots = view.players.filter((p) => p.bot).length;
    if (bots < replay.bots && view.players.length < 4) act({ type: "addBot" });
    else replay = null;
  }
  if (replay && view.phase === "playing") replay = null;

  // events → toast + sound
  if (isNew && prevSeq !== -1 && view.last) {
    const e = view.last;
    const who = e.by === ME ? "Та" : nameOf(e.by);
    if (e.kind === "place") { sfx.place(); toast(`${who} ${PART[e.part].name.toLowerCase()} тавилаа`); }
    else if (e.kind === "storm") { sfx.storm(); toast(`${who} шуурга илгээв! ${e.target === ME ? "Таны" : nameOf(e.target) + "-ийн"} ${PART[e.part].name.toLowerCase()} хийслээ`, false, "storm"); }
    else if (e.kind === "swap") { sfx.swap(); toast(`${who} ${e.count} карт солив`); }
    else if (e.kind === "start") toast("Тоглолт эхэллээ! Хаалгаа босгоорой");
    if (view.yourTurn && e.by !== ME && (e.kind === "storm" || e.kind === "swap" || e.kind === "end" || e.kind === "timeout")) sfx.turn();
    // a timeout can be followed by a computer's move in the same update, so it has its own slot
    const t = view.lastTimeout;
    if (t && t.seq > prevSeq) { sfx.swap(); toast(`${t.by === ME ? "Таны" : nameOf(t.by) + "-ийн"} хугацаа дууслаа${t.count ? `, ${t.count} карт солигдлоо` : ""}`, false, "timer"); }
  }
  if (isNew) { selected = []; stormPick = false; }

  syncSites(prevSeq !== -1);
  renderHud(msg);
}

function renderHud(msg) {
  const phase = view.phase;
  const me = view.players.find((p) => p.id === ME);
  const inGame = phase !== "lobby" && Boolean(me) && me.handCount + me.built.length > 0;

  $("#round-label").textContent = phase === "lobby" ? "Лобби" : `Тоглолт ${view.round}`;
  $("#lobby").hidden = phase !== "lobby" || intro.on;
  $("#gameover").hidden = phase !== "done" || intro.on;
  $("#ladder").hidden = !inGame;
  $("#players").hidden = phase === "lobby";
  $("#bottom").hidden = !inGame || phase === "done";
  $("#spectator").hidden = phase === "lobby" || inGame;

  if (phase === "lobby") renderLobby(msg);
  if (phase === "done") {
    const won = view.winner === ME;
    $("#over-title").textContent = won ? "Та яллаа!" : `${nameOf(view.winner)} яллаа`;
    $("#over-text").textContent = won ? "Таны гэр хамгийн түрүүнд бүрэн баригдлаа. Сайхан нүүдэллээрэй!" : "Энэ удаад өрсөлдөгч тань түрүүлж гэрээ барилаа. Дахин нэг үзэх үү?";
    if (lastWinSeq !== view.seq) { lastWinSeq = view.seq; sfx.win(); }
  }
  if (phase !== "lobby") renderPlayers();
  if (inGame) { renderLadder(me); renderHand(me); }
}
let lastWinSeq = -1;

function renderLobby(msg) {
  const me = view.players.find((p) => p.id === ME);
  const list = $("#seated-list");
  list.replaceChildren();
  view.players.forEach((p, i) => {
    const li = el("li");
    const dot = el("span", "pl-dot");
    dot.style.background = COLORS[i % COLORS.length];
    li.append(dot, document.createTextNode(p.name || "Нэр оруулаагүй"));
    if (p.id === ME) li.append(el("em", null, "(та)"));
    if (p.bot) {
      const rm = el("button", "bot-remove");
      rm.type = "button";
      rm.append(icon("close"));
      rm.setAttribute("aria-label", `${p.name} хасах`);
      rm.addEventListener("click", () => act({ type: "removeBot", id: p.id }));
      li.append(rm);
    }
    list.append(li);
  });
  const input = $("#name-input");
  if (!input.value && (me?.name || localStorage.getItem(NAME_KEY))) input.value = me?.name || localStorage.getItem(NAME_KEY);
  $("#name-submit").textContent = me?.name ? "Нэр солих" : "Суух";
  const named = view.players.filter((p) => p.name).length;
  const canStart = me?.name && view.players.length >= 2 && named === view.players.length;
  $("#start").disabled = !canStart;
  $("#add-bot").disabled = !me?.name || view.players.length >= 4;
  const seatedInRoom = msg.seats.includes(ME);
  $("#lobby-note").textContent = !seatedInRoom
    ? "Өрөө дүүрсэн байна (4 тоглогч). Та үзэгчээр орлоо."
    : view.players.length < 2
      ? "Дор хаяж 2 тоглогч хэрэгтэй. Линкээ найздаа илгээх эсвэл компьютертэй тоглоорой."
      : named < view.players.length
        ? "Бүх тоглогч нэрээ оруулахыг хүлээж байна."
        : "Бэлэн! Хэн ч тоглолтыг эхлүүлж болно.";
}

function renderPlayers() {
  const ul = $("#player-list");
  ul.replaceChildren();
  view.players.forEach((p, i) => {
    const li = el("li", view.turn === p.id && view.phase === "playing" ? "turn" : "");
    const head = el("div", "pl-head");
    const dot = el("span", "pl-dot");
    dot.style.background = COLORS[i % COLORS.length];
    head.append(dot, el("span", null, `${p.name || "Тоглогч"}${p.id === ME ? " (та)" : ""}`), el("em", null, `${p.built.length}/11 · ${p.handCount} карт`));
    const bar = el("div", "bar");
    const fill = el("i");
    fill.style.width = `${(p.built.length / 11) * 100}%`;
    bar.append(fill);
    li.append(head, bar);
    ul.append(li);
  });
  $("#deck-info").textContent = `Багцад ${view.deckCount} карт үлдсэн`;
}

function renderLadder(me) {
  const ol = $("#ladder-list");
  ol.replaceChildren();
  view.steps.forEach((part, i) => {
    const li = el("li", i < me.built.length ? "done" : i === me.built.length ? "next" : "");
    const img = el("img");
    img.src = cardSrc(part);
    img.alt = "";
    li.append(img, el("span", null, STEP_LABEL[i]));
    ol.append(li);
  });
  const need = view.steps[me.built.length];
  $("#ladder-tip").textContent = need ? `${PART[need].name}: ${PART[need].text}` : "Гэр бүрэн баригдлаа!";
}

function renderHand(me) {
  const need = view.steps[me.built.length];
  const hand = $("#hand");
  hand.replaceChildren();
  view.yourHand.forEach((c, i) => {
    const b = el("button", "card");
    b.type = "button";
    if (c === "storm") b.classList.add("storm");
    if (view.yourTurn && c === need) b.classList.add("fits");
    if (selected.includes(i)) b.classList.add("selected");
    b.setAttribute("aria-pressed", String(selected.includes(i)));
    b.title = PART[c].text;
    const img = el("img");
    img.src = cardSrc(c);
    img.alt = "";
    b.append(img, el("b", null, PART[c].name));
    b.disabled = !view.yourTurn;
    b.addEventListener("click", () => toggleCard(i));
    b.addEventListener("dblclick", () => { if (c === need) act({ type: "place", card: i }); });
    hand.append(b);
  });

  const line = $("#turn-line");
  line.classList.toggle("mine", view.yourTurn);
  line.textContent = view.yourTurn
    ? view.placedThisTurn
      ? `Таны ээлж: ${view.placedThisTurn} хэсэг тавилаа. Үргэлжлүүлэх эсвэл ээлжээ дуусгана уу`
      : `Таны ээлж! Дараагийнх: ${PART[need]?.name ?? "-"}`
    : `${nameOf(view.turn)}-ийн ээлж...`;

  renderActions(me, need);
}

/** The turn clock under the hand: a draining bar and the seconds left, red for the last five. */
function tickTimer() {
  const box = $("#timer");
  const on = turnDeadline != null && view?.phase === "playing";
  box.hidden = !on;
  if (!on) return;
  const left = Math.max(0, turnDeadline - performance.now());
  const sec = Math.ceil(left / 1000);
  box.querySelector("i").style.transform = `scaleX(${left / 15000})`;
  $("#timer-sec").textContent = `${sec}с`;
  box.classList.toggle("low", sec <= 5);
  if (view.yourTurn && sec <= 5 && sec > 0 && sec !== lastTick) tone(660, 0.06, "sine", 0.05);
  lastTick = sec;
}
setInterval(tickTimer, 100);

function toggleCard(i) {
  const at = selected.indexOf(i);
  if (at >= 0) selected.splice(at, 1);
  else {
    selected.push(i);
    if (selected.length > 3) selected.shift();
  }
  stormPick = false;
  renderHand(view.players.find((p) => p.id === ME));
}

function act(action) {
  send({ type: "action", action });
}

function renderActions(me, need) {
  const box = $("#actions");
  box.replaceChildren();
  const hint = $("#hint");
  hint.textContent = "";
  if (!view.yourTurn) return;

  const one = selected.length === 1 ? view.yourHand[selected[0]] : null;
  const place = iconButton("btn btn-place", "ger", "Тавих");
  place.disabled = one !== need;
  place.addEventListener("click", () => act({ type: "place", card: selected[0] }));
  box.append(place);

  if (one === "storm") {
    const targets = view.players.filter((p) => p.id !== ME && ["esgii", "gadar", "bus"].includes(p.built[p.built.length - 1]));
    if (targets.length) {
      for (const t of targets) {
        const b = iconButton("btn btn-storm", "storm", `${t.name}: ${PART[t.built[t.built.length - 1]].name}`);
        b.addEventListener("click", () => act({ type: "storm", card: selected[0], target: t.id }));
        box.append(b);
      }
    } else {
      hint.textContent = "Одоогоор хэнд ч хийсгэх бүрээс алга. Шуургаа хадгалаарай.";
    }
  }

  const swap = iconButton("btn btn-swap", "swap", selected.length ? `${selected.length} карт солих` : "Солих");
  swap.disabled = selected.length === 0;
  swap.addEventListener("click", () => act({ type: "swap", cards: [...selected] }));
  box.append(swap);

  if (view.placedThisTurn) {
    const end = iconButton("btn btn-end", "next", "Ээлж дуусгах", true);
    end.addEventListener("click", () => act({ type: "end" }));
    box.append(end);
  }

  if (!hint.textContent) {
    if (!selected.length) {
      hint.textContent = view.yourHand.includes(need)
        ? `Гэрэлтсэн ${PART[need].name.toLowerCase()} картыг сонгоод тавина уу (давхар дарж ч болно).`
        : `${PART[need].name} алга. Хэрэггүй 1-3 картаа сонгоод солих уу, эсвэл шуурга илгээх үү.`;
    } else if (one && one !== need && one !== "storm") {
      hint.textContent = `Одоо ${PART[need].name.toLowerCase()} хэрэгтэй. ${PART[one].name} дараа хэрэг болно, эсвэл соль.`;
    }
  }
}

// lobby controls
$("#name-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const name = $("#name-input").value.trim();
  if (!name) return;
  localStorage.setItem(NAME_KEY, name);
  ctx(); // unlock audio on a user gesture
  act({ type: "sit", name });
});
$("#start").addEventListener("click", () => { ctx(); act({ type: "start" }); });
$("#add-bot").addEventListener("click", () => { ctx(); act({ type: "addBot" }); });
$("#again").addEventListener("click", () => {
  // a reset empties the table, so remember the computers and bring them back in the lobby
  const bots = view?.players.filter((p) => p.bot).length ?? 0;
  if (bots) replay = { bots, sent: -1 };
  send({ type: "reset" });
});

// how-to-play dialog: opens from the top bar or the lobby, and once by itself on a first visit
const help = $("#help");
let helpReturn = null;
function openHelp() {
  helpReturn = document.activeElement;
  help.hidden = false;
  $("#help-close").focus();
}
function closeHelp() {
  help.hidden = true;
  localStorage.setItem("hf:ger:helpSeen", "1");
  helpReturn?.focus?.();
}
$("#help-open").addEventListener("click", openHelp);
$("#help-from-lobby").addEventListener("click", openHelp);
$("#help-close").addEventListener("click", closeHelp);
$("#help-ok").addEventListener("click", closeHelp);
help.addEventListener("click", (e) => { if (e.target === help) closeHelp(); });
addEventListener("keydown", (e) => { if (e.key === "Escape" && !help.hidden) closeHelp(); });
// the intro: "Play" glides to the table (and shows the rules once on a first visit)
$("#intro-play").addEventListener("click", () => { ctx(); leaveIntro(); });
$("#intro-help").addEventListener("click", openHelp);
$("#intro-play").focus();

// keyboard: 1-5 select, Enter place, S swap, E end
addEventListener("keydown", (e) => {
  if (!view?.yourTurn || e.target instanceof HTMLInputElement || !help.hidden) return;
  const n = Number(e.key);
  if (n >= 1 && n <= view.yourHand.length) { toggleCard(n - 1); return; }
  const me = view.players.find((p) => p.id === ME);
  const need = view.steps[me.built.length];
  if (e.code === "Enter" && selected.length === 1 && view.yourHand[selected[0]] === need) act({ type: "place", card: selected[0] });
  if (e.code === "KeyS" && selected.length) act({ type: "swap", cards: [...selected] });
  if (e.code === "KeyE" && view.placedThisTurn) act({ type: "end" });
});

// leaving the intro: draw the HUD, and show the rules once on a first visit
afterLeaveIntro(() => {
  if (view) renderHud(lastMsg);
  if (!localStorage.getItem("hf:ger:helpSeen")) setTimeout(openHelp, 700);
});

connect(onState, toast);
