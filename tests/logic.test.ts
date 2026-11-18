/**
 * The rules of Гэр барих, driven directly (no sockets) so the card-dependent
 * paths — storms, the winning placement, deck reshuffles — are exercised
 * deterministically instead of depending on a dealt hand.
 */

import { describe, expect, it } from "vitest";

import * as L from "../src/logic.js";

const STEPS = ["door", "khana", "khana", "toono", "bagana", "uni", "uni", "esgii", "esgii", "gadar", "bus"];

function playing(over: Record<string, unknown> = {}) {
  const base: any = L.setup(["a", "b"]);
  return {
    ...base,
    phase: "playing",
    turn: "a",
    placedThisTurn: 0,
    deck: ["khana", "uni", "toono"],
    discard: [],
    players: [
      { id: "a", name: "A", hand: ["storm", "door", "uni", "bus", "gadar"], built: [] },
      { id: "b", name: "B", hand: ["door", "door", "uni", "uni", "khana"], built: STEPS.slice(0, 8) },
    ],
    ...over,
  };
}

describe("storm", () => {
  it("blows the target's top covering into the discard pile and passes the turn", () => {
    const s = playing();
    expect(L.validateAction(s, "a", { type: "storm", card: 0, target: "b" })).toEqual({ ok: true });
    const next: any = L.applyAction(s, "a", { type: "storm", card: 0, target: "b" });
    expect(next.players[1].built).toEqual(STEPS.slice(0, 7));
    expect(next.discard).toEqual(["storm", "esgii"]);
    expect(next.players[0].hand).toHaveLength(5);
    expect(next.turn).toBe("b");
    expect(next.last).toMatchObject({ kind: "storm", target: "b", part: "esgii" });
  });

  it("refuses a target whose top part is not a covering, and self-targeting", () => {
    const s = playing();
    s.players[1].built = STEPS.slice(0, 5);
    expect(L.validateAction(s, "a", { type: "storm", card: 0, target: "b" }).ok).toBe(false);
    expect(L.validateAction(playing(), "a", { type: "storm", card: 0, target: "a" }).ok).toBe(false);
    expect(L.validateAction(playing(), "a", { type: "storm", card: 1, target: "b" }).ok).toBe(false);
  });
});

describe("building", () => {
  it("keeps the turn after a placement and allows ending it", () => {
    const s: any = L.applyAction(playing(), "a", { type: "place", card: 1 });
    expect(s.players[0].built).toEqual(["door"]);
    expect(s.turn).toBe("a");
    expect(L.validateAction(s, "a", { type: "end" })).toEqual({ ok: true });
    expect((L.applyAction(s, "a", { type: "end" }) as any).turn).toBe("b");
  });

  it("ends the game on the eleventh part", () => {
    const s = playing();
    s.players[0].built = STEPS.slice(0, 10);
    const done: any = L.applyAction(s, "a", { type: "place", card: 3 });
    expect(L.isGameOver(done)).toEqual({ over: true, winner: "a" });
    expect(L.validateAction(done, "b", { type: "swap", cards: [0] }).ok).toBe(false);
  });

  it("reshuffles the discard pile when the deck runs dry", () => {
    const s = playing({ deck: [], discard: ["toono", "bagana"] });
    const next: any = L.applyAction(s, "a", { type: "swap", cards: [2] });
    expect(next.players[0].hand).toHaveLength(5);
    expect(next.deck.length + next.discard.length).toBe(2);
  });
});

describe("whole games", () => {
  it("always finishes and never loses a card", () => {
    for (let g = 0; g < 60; g++) {
      const n = 2 + (g % 3);
      const ids = Array.from({ length: n }, (_, i) => `g${g}p${i}`);
      let s: any = L.setup([ids[0]!]);
      for (const id of ids) s = L.applyAction(s, id, { type: "sit", name: id });
      s = L.applyAction(s, ids[0]!, { type: "start" });
      const total = () => s.deck.length + s.discard.length + s.players.reduce((t: number, p: any) => t + p.hand.length + p.built.length, 0);
      const cards = total();
      let guard = 0;
      while (!L.isGameOver(s).over && guard++ < 4000) {
        const me = s.players.find((p: any) => p.id === s.turn);
        const need = STEPS[me.built.length];
        const at = me.hand.indexOf(need);
        const action = at >= 0 ? { type: "place", card: at } : s.placedThisTurn ? { type: "end" } : { type: "swap", cards: [0] };
        expect(L.validateAction(s, s.turn, action)).toEqual({ ok: true });
        s = L.applyAction(s, s.turn, action);
        expect(total()).toBe(cards);
      }
      expect(L.isGameOver(s).over).toBe(true);
    }
  });
});

describe("computer players", () => {
  it("joins from the lobby and plays its turns until a person is up", () => {
    let s: any = L.setup(["a"]);
    s = L.applyAction(s, "a", { type: "sit", name: "A" });
    expect(L.validateAction(s, "a", { type: "addBot" })).toEqual({ ok: true });
    s = L.applyAction(s, "a", { type: "addBot" });
    expect(s.players.map((p: any) => p.id)).toEqual(["a", "bot:1"]);
    s = L.applyAction(s, "a", { type: "start" });
    expect(s.turn).toBe("a");
    s = L.applyAction(s, "a", { type: "swap", cards: [0] });
    // the computer moved straight away and handed the turn back
    expect(s.turn).toBe("a");
    expect(L.viewFor(s, "a")).toMatchObject({ players: [{ bot: false }, { bot: true }] });
  });
});

describe("turn clock", () => {
  it("swaps the dead cards and passes the turn when nothing was built", () => {
    const s = playing();
    expect(L.validateAction(s, "a", { type: "timeout" })).toEqual({ ok: true });
    const next: any = L.applyAction(s, "a", { type: "timeout" });
    // only the storm and the next three steps (door, khana, khana) are worth keeping
    expect(next.discard).toEqual(["uni", "bus", "gadar"]);
    expect(next.players[0].hand.slice(0, 2)).toEqual(["storm", "door"]);
    expect(next.turn).toBe("b");
    expect(next.turnNo).toBe(s.turnNo + 1);
    expect(next.last).toMatchObject({ kind: "timeout", by: "a", count: 3 });
  });

  it("just passes the turn after a placement, and only for the player on it", () => {
    const s: any = L.applyAction(playing(), "a", { type: "place", card: 1 });
    expect(L.validateAction(s, "b", { type: "timeout" }).ok).toBe(false);
    const next: any = L.applyAction(s, "a", { type: "timeout" });
    expect(next.players[0].built).toEqual(["door"]);
    expect(next.discard).toEqual([]);
    expect(next.turn).toBe("b");
    expect(next.last).toMatchObject({ kind: "timeout", count: 0 });
  });
});
