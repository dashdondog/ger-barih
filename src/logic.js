/**
 * ГЭР БАРИХ — the rules.
 *
 * Every player builds their own ger, part by part, in the real order a ger is
 * raised. Cards come from one shared deck. On your turn you place the next part,
 * blow an opponent's top covering off with a storm card, or swap cards. Placing
 * keeps the turn, so a hand that holds the next parts in order builds several at
 * once; a storm, a swap or `end` passes it. First finished ger wins.
 *
 * The room seats people as they open the link, so the game starts in a lobby:
 * late arrivals `sit` (with a name) and anyone seated starts the round once two
 * or more are present.
 *
 * Pure and deterministic: randomness is a mulberry32 stream whose seed lives in
 * state and is advanced only here.
 */

export const meta = {
  game: "Гэр барих",
  minPlayers: 1,
  maxPlayers: 4,
};

/** The build order — the real order a ger goes up. */
const STEPS = ["door", "khana", "khana", "toono", "bagana", "uni", "uni", "esgii", "esgii", "gadar", "bus"];
const PARTS = ["door", "khana", "toono", "bagana", "uni", "esgii", "gadar", "bus"];
const COVERING = ["esgii", "gadar", "bus"];
const HAND_SIZE = 5;
const MAX_SWAP = 3;
const MAX_NAME = 16;
const BOT_PREFIX = "bot:";

// ── deterministic randomness ────────────────────────────────────────────────

function hash(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** One mulberry32 step: returns [value in 0..1, next seed]. */
function rand(seed) {
  let t = (seed + 0x6d2b79f5) >>> 0;
  const next = t;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return [((t ^ (t >>> 14)) >>> 0) / 4294967296, next];
}

function shuffle(cards, seed) {
  const out = [...cards];
  let s = seed;
  for (let i = out.length - 1; i > 0; i--) {
    let r;
    [r, s] = rand(s);
    const j = Math.floor(r * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return [out, s];
}

function buildDeck(playerCount) {
  const perPlayer = {};
  for (const step of STEPS) perPlayer[step] = (perPlayer[step] ?? 0) + 1;
  const deck = [];
  for (const part of PARTS) {
    // every player's needs plus one spare per player, so a hand can't starve
    const copies = (perPlayer[part] + 1) * playerCount;
    for (let i = 0; i < copies; i++) deck.push(part);
  }
  for (let i = 0; i < playerCount + 1; i++) deck.push("storm");
  return deck;
}

/** Draw `count` cards, reshuffling the discard pile into the deck when it runs out. */
function draw(state, count) {
  let deck = [...state.deck];
  let discard = [...state.discard];
  let seed = state.seed;
  const drawn = [];
  for (let i = 0; i < count; i++) {
    if (deck.length === 0 && discard.length > 0) {
      [deck, seed] = shuffle(discard, seed);
      discard = [];
    }
    if (deck.length === 0) break;
    drawn.push(deck.pop());
  }
  return { drawn, deck, discard, seed };
}

// ── helpers ─────────────────────────────────────────────────────────────────

function player(state, id) {
  return state.players.find((p) => p.id === id);
}

function nextNeed(p) {
  return STEPS[p.built.length] ?? null;
}

function topCovering(p) {
  const last = p.built[p.built.length - 1];
  return last && COVERING.includes(last) ? last : null;
}

function cleanName(raw) {
  if (typeof raw !== "string") return null;
  const name = raw.replace(/\s+/g, " ").trim().slice(0, MAX_NAME);
  return name.length ? name : null;
}

function nextTurn(state, fromId) {
  const ids = state.players.map((p) => p.id);
  const at = ids.indexOf(fromId);
  return ids[(at + 1) % ids.length];
}

function isBot(id) {
  return typeof id === "string" && id.startsWith(BOT_PREFIX);
}

/** The computer's move: place the next part if it can, then storm the leader, else swap the dead cards. */
function botAction(state, id) {
  const me = player(state, id);
  const need = nextNeed(me);
  const at = me.hand.indexOf(need);
  if (at !== -1) return { type: "place", card: at };
  if (state.placedThisTurn) return { type: "end" };

  const stormAt = me.hand.indexOf("storm");
  if (stormAt !== -1) {
    const targets = state.players
      .filter((p) => p.id !== id && topCovering(p))
      .sort((a, b) => b.built.length - a.built.length);
    if (targets.length) return { type: "storm", card: stormAt, target: targets[0].id };
  }

  return { type: "swap", cards: deadCards(me) };
}

/** Up to three cards worth throwing: keep storms and the parts needed soonest. */
function deadCards(me) {
  const soon = new Set(STEPS.slice(me.built.length, me.built.length + 3));
  let cards = me.hand.map((c, i) => (c === "storm" || soon.has(c) ? -1 : i)).filter((i) => i >= 0);
  if (!cards.length) cards = me.hand.map((c, i) => (c === "storm" ? -1 : i)).filter((i) => i >= 0);
  if (!cards.length) cards = me.hand.map((_, i) => i);
  return cards.slice(0, MAX_SWAP);
}

/** Play every computer turn until a person is up or the game ends. */
function runBots(state) {
  let next = state;
  let shown = null; // the bot's last placement reads better than its "end"
  for (let guard = 0; guard < 500 && next.phase === "playing" && isBot(next.turn); guard++) {
    const id = next.turn;
    const action = botAction(next, id);
    if (!validateAction(next, id, action).ok) {
      // an empty hand with nothing to do: pass the turn
      next = { ...next, turn: nextTurn(next, id), placedThisTurn: 0, turnNo: (next.turnNo ?? 0) + 1 };
      continue;
    }
    next = applyTurn(next, id, action);
    if (next.last.kind === "place") shown = next.last;
    else if (next.last.kind !== "end") shown = null;
    if (next.last.kind === "end" && shown) next = { ...next, last: { ...shown, seq: next.seq } };
  }
  return next;
}

function withEvent(state, event) {
  return { ...state, seq: state.seq + 1, last: { ...event, seq: state.seq + 1 } };
}

// ── the contract ────────────────────────────────────────────────────────────

export function setup(players) {
  return {
    phase: "lobby",
    players: players.map((id) => ({ id, name: null, hand: [], built: [] })),
    deck: [],
    discard: [],
    seed: hash(players.join("|")),
    turn: null,
    round: 0,
    winner: null,
    placedThisTurn: 0,
    // counts every handover; the room's turn clock restarts whenever it changes
    turnNo: 0,
    seq: 0,
    last: null,
  };
}

export function validateAction(state, playerId, action) {
  if (!action || typeof action !== "object") return { ok: false, error: "буруу үйлдэл" };
  const me = player(state, playerId);

  if (action.type === "sit") {
    if (state.phase !== "lobby") return { ok: false, error: "тоглолт эхэлсэн байна, дараагийн тоглолтыг хүлээнэ үү" };
    if (!cleanName(action.name)) return { ok: false, error: "нэрээ оруулна уу" };
    if (!me && state.players.length >= meta.maxPlayers) return { ok: false, error: "өрөө дүүрсэн" };
    return { ok: true };
  }

  if (!me) return { ok: false, error: "та энэ тоглолтод ороогүй байна" };

  if (action.type === "addBot") {
    if (state.phase !== "lobby") return { ok: false, error: "тоглолт эхэлсэн байна" };
    if (!me.name) return { ok: false, error: "эхлээд нэрээ оруулна уу" };
    if (state.players.length >= meta.maxPlayers) return { ok: false, error: "өрөө дүүрсэн" };
    return { ok: true };
  }

  if (action.type === "removeBot") {
    if (state.phase !== "lobby") return { ok: false, error: "тоглолт эхэлсэн байна" };
    if (!isBot(action.id) || !player(state, action.id)) return { ok: false, error: "компьютер олдсонгүй" };
    return { ok: true };
  }

  if (action.type === "start") {
    if (state.phase !== "lobby") return { ok: false, error: "тоглолт аль хэдийн эхэлсэн" };
    if (state.players.length < 2) return { ok: false, error: "дор хаяж 2 тоглогч хэрэгтэй" };
    if (state.players.some((p) => !p.name)) return { ok: false, error: "бүх тоглогч нэрээ оруулаагүй байна" };
    return { ok: true };
  }

  if (state.phase !== "playing") return { ok: false, error: "тоглолт явагдаагүй байна" };
  if (state.turn !== playerId) return { ok: false, error: "таны ээлж биш" };

  const validIndex = (i) => Number.isInteger(i) && i >= 0 && i < me.hand.length;

  if (action.type === "place") {
    if (!validIndex(action.card)) return { ok: false, error: "карт сонгоно уу" };
    const card = me.hand[action.card];
    const need = nextNeed(me);
    if (card === "storm") return { ok: false, error: "шуургыг өрсөлдөгч рүү илгээнэ" };
    if (card !== need) return { ok: false, error: "энэ хэсгийг одоо тавих боломжгүй, дарааллаа шалгана уу" };
    return { ok: true };
  }

  if (action.type === "storm") {
    if (!validIndex(action.card) || me.hand[action.card] !== "storm") return { ok: false, error: "шуурганы карт сонгоно уу" };
    if (action.target === playerId) return { ok: false, error: "өөрийн гэр рүүгээ шуурга илгээх боломжгүй" };
    const target = player(state, action.target);
    if (!target) return { ok: false, error: "тоглогч олдсонгүй" };
    if (!topCovering(target)) return { ok: false, error: "энэ гэрт хийсгэх бүрээс алга" };
    return { ok: true };
  }

  if (action.type === "swap") {
    const cards = action.cards;
    if (!Array.isArray(cards) || cards.length < 1 || cards.length > MAX_SWAP) return { ok: false, error: `1-${MAX_SWAP} карт сонгоно уу` };
    if (!cards.every(validIndex)) return { ok: false, error: "буруу карт" };
    if (new Set(cards).size !== cards.length) return { ok: false, error: "өөр өөр карт сонгоно уу" };
    return { ok: true };
  }

  // sent by the room when the turn clock runs out (a player may also give up their own turn)
  if (action.type === "timeout") return { ok: true };

  if (action.type === "end") {
    if (!state.placedThisTurn) return { ok: false, error: "эхлээд хэсэг тавих, карт солих эсвэл шуурга илгээнэ үү" };
    return { ok: true };
  }

  return { ok: false, error: "үл мэдэгдэх үйлдэл" };
}

export function applyAction(state, playerId, action) {
  return runBots(applyTurn(state, playerId, action));
}

function applyTurn(state, playerId, action) {
  if (action.type === "addBot") {
    let n = 1;
    while (player(state, BOT_PREFIX + n)) n++;
    const bot = { id: BOT_PREFIX + n, name: `Компьютер ${n}`, hand: [], built: [] };
    return withEvent({ ...state, players: [...state.players, bot] }, { kind: "sit", by: bot.id });
  }

  if (action.type === "removeBot") {
    const players = state.players.filter((p) => p.id !== action.id);
    return withEvent({ ...state, players }, { kind: "leave", by: action.id });
  }

  if (action.type === "sit") {
    const name = cleanName(action.name);
    const exists = player(state, playerId);
    const players = exists
      ? state.players.map((p) => (p.id === playerId ? { ...p, name } : p))
      : [...state.players, { id: playerId, name, hand: [], built: [] }];
    return withEvent({ ...state, players }, { kind: "sit", by: playerId });
  }

  if (action.type === "start") {
    const round = state.round + 1;
    let [deck, seed] = shuffle(buildDeck(state.players.length), hash(state.players.map((p) => p.id).join("|") + ":" + round));
    let working = { ...state, deck, discard: [], seed };
    const players = state.players.map((p) => {
      const res = draw(working, HAND_SIZE);
      working = { ...working, deck: res.deck, discard: res.discard, seed: res.seed };
      return { ...p, hand: res.drawn, built: [] };
    });
    // the first player rotates with each round
    const first = state.players[(round - 1) % state.players.length].id;
    return withEvent(
      { ...working, phase: "playing", players, round, turn: first, winner: null, placedThisTurn: 0, turnNo: (state.turnNo ?? 0) + 1 },
      { kind: "start", by: playerId },
    );
  }

  const me = player(state, playerId);
  let next = state;
  let event;

  // out of time: hand the turn on, swapping the dead cards if nothing was built
  const timedOut = action.type === "timeout";
  if (timedOut) action = state.placedThisTurn ? { type: "end" } : { type: "swap", cards: deadCards(me) };

  if (action.type === "place") {
    const part = me.hand[action.card];
    const hand = me.hand.filter((_, i) => i !== action.card);
    const res = draw(state, 1);
    const built = [...me.built, part];
    next = {
      ...state,
      deck: res.deck,
      discard: res.discard,
      seed: res.seed,
      players: state.players.map((p) => (p.id === playerId ? { ...p, hand: [...hand, ...res.drawn], built } : p)),
    };
    event = { kind: "place", by: playerId, part, step: built.length - 1 };
    if (built.length === STEPS.length) {
      return withEvent({ ...next, phase: "done", winner: playerId, turn: null }, event);
    }
    // placing keeps the turn
    return withEvent({ ...next, placedThisTurn: state.placedThisTurn + 1 }, event);
  } else if (action.type === "end") {
    next = state;
    event = { kind: "end", by: playerId, count: state.placedThisTurn };
  } else if (action.type === "storm") {
    const target = player(state, action.target);
    const part = topCovering(target);
    const hand = me.hand.filter((_, i) => i !== action.card);
    const afterDiscard = { ...state, discard: [...state.discard, "storm", part] };
    const res = draw(afterDiscard, 1);
    next = {
      ...afterDiscard,
      deck: res.deck,
      discard: res.discard,
      seed: res.seed,
      players: state.players.map((p) => {
        if (p.id === playerId) return { ...p, hand: [...hand, ...res.drawn] };
        if (p.id === action.target) return { ...p, built: p.built.slice(0, -1) };
        return p;
      }),
    };
    event = { kind: "storm", by: playerId, target: action.target, part, step: target.built.length - 1 };
  } else {
    const drop = new Set(action.cards);
    const thrown = me.hand.filter((_, i) => drop.has(i));
    const kept = me.hand.filter((_, i) => !drop.has(i));
    const afterDiscard = { ...state, discard: [...state.discard, ...thrown] };
    const res = draw(afterDiscard, thrown.length);
    next = {
      ...afterDiscard,
      deck: res.deck,
      discard: res.discard,
      seed: res.seed,
      players: state.players.map((p) => (p.id === playerId ? { ...p, hand: [...kept, ...res.drawn] } : p)),
    };
    event = { kind: "swap", by: playerId, count: thrown.length };
  }

  const handover = { ...next, turn: nextTurn(next, playerId), placedThisTurn: 0, turnNo: (state.turnNo ?? 0) + 1 };
  if (timedOut) {
    // kept apart from `last`, which a computer's reply would overwrite before anyone saw it
    const out = withEvent(handover, { kind: "timeout", by: playerId, count: event.kind === "swap" ? event.count : 0 });
    return { ...out, lastTimeout: out.last };
  }
  return withEvent(handover, event);
}

export function isGameOver(state) {
  if (state.phase === "done") return { over: true, winner: state.winner };
  return { over: false };
}

export function viewFor(state, playerId) {
  const me = player(state, playerId);
  return {
    phase: state.phase,
    steps: STEPS,
    you: playerId,
    seated: Boolean(me),
    yourHand: me ? me.hand : [],
    yourTurn: state.phase === "playing" && state.turn === playerId,
    placedThisTurn: state.turn === playerId ? state.placedThisTurn : 0,
    turn: state.turn,
    round: state.round,
    winner: state.winner,
    deckCount: state.deck.length,
    // everyone's built ger is public; hands are counted, never shown
    players: state.players.map((p) => ({ id: p.id, name: p.name, bot: isBot(p.id), built: p.built, handCount: p.hand.length })),
    last: state.last,
    lastTimeout: state.lastTimeout ?? null,
    seq: state.seq,
  };
}
