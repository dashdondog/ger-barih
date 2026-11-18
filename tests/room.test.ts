/**
 * Room behaviour, exercised through real WebSockets in workerd.
 *
 * These tests are the safety net for the whole games migration: every existing
 * game speaks the wire protocol asserted here, so a regression in this file is a
 * regression in every migrated game. They deliberately drive the PUBLIC surface
 * (connect, send frames, read frames) rather than poking at internals.
 */

import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

/** Open a socket to a room and collect frames as they arrive. */
async function open(room = "main") {
  const res = await SELF.fetch(`https://game.test/ws/${room}`, {
    headers: { Upgrade: "websocket" },
  });
  expect(res.status).toBe(101);
  const ws = res.webSocket;
  if (!ws) throw new Error("no webSocket on the upgrade response");
  ws.accept();

  const frames: unknown[] = [];
  ws.addEventListener("message", (event: MessageEvent) => {
    const data = typeof event.data === "string" ? event.data : "";
    // Keepalive auto-responses are not protocol traffic.
    if (data === "__pong") return;
    try {
      frames.push(JSON.parse(data));
    } catch {
      frames.push(data);
    }
  });

  /** Wait for the next frame matching `pred` (frames can arrive out of step). */
  const next = async (pred: (f: any) => boolean, label: string) => {
    for (let i = 0; i < 100; i++) {
      const hit = frames.find(pred);
      if (hit) return hit as any;
      await scheduler.wait(10);
    }
    throw new Error(`timed out waiting for ${label}; got ${JSON.stringify(frames)}`);
  };

  return {
    ws,
    frames,
    next,
    send: (msg: unknown) => ws.send(JSON.stringify(msg)),
    state: () => next((f) => f?.type === "state", "a state frame"),
    error: () => next((f) => f?.type === "error", "an error frame"),
  };
}

/**
 * A fresh room name per call. Durable Object state persists across tests in the
 * pool, so reusing a literal name would inherit the previous test's seats and
 * make the suite order-dependent.
 */
let seq = 0;
function uniq(label: string): string {
  seq += 1;
  return `${label}-${seq}-${crypto.randomUUID().slice(0, 6)}`;
}

describe("routing", () => {
  it("rejects a non-upgrade request to /ws instead of waking a room", async () => {
    const res = await SELF.fetch("https://game.test/ws");
    expect(res.status).toBe(426);
  });

  it("rejects a room name that isn't a short safe label", async () => {
    const res = await SELF.fetch("https://game.test/ws/../../etc/passwd", {
      headers: { Upgrade: "websocket" },
    });
    // Either the URL normalises away or the guard rejects it — never a 101.
    expect(res.status).not.toBe(101);
  });

  it("404s a non-asset, non-ws path for a non-HTML request", async () => {
    const res = await SELF.fetch("https://game.test/api/nope");
    expect(res.status).toBe(404);
  });
});

/** Join + sit a player with a name, waiting until the room has seen the sit. */
async function sit(room: string, id: string, name: string) {
  const c = await open(room);
  c.send({ type: "join", playerId: id });
  await c.state();
  c.frames.length = 0;
  c.send({ type: "action", action: { type: "sit", name } });
  await c.next(
    (f) => f?.type === "state" && f.view?.players?.some((p: any) => p.id === id && p.name === name),
    `${id} to sit`,
  );
  return c;
}

/** Two named players, round started. Alice (first seated) moves first. */
async function started(room: string) {
  const a = await sit(room, "alice", "Алиса");
  const b = await sit(room, "bob", "Бат");
  a.frames.length = 0;
  b.frames.length = 0;
  a.send({ type: "action", action: { type: "start" } });
  const sa = await a.next((f) => f?.type === "state" && f.view?.phase === "playing", "A playing");
  const sb = await b.next((f) => f?.type === "state" && f.view?.phase === "playing", "B playing");
  a.frames.length = 0;
  b.frames.length = 0;
  return { a, b, sa, sb };
}

describe("joining", () => {
  it("opens a lobby, seats named players, then starts on request", async () => {
    const room = uniq("lobby");
    const a = await open(room);
    a.send({ type: "join", playerId: "alice" });
    const first = await a.state();
    expect(first.meta.game).toBe("Гэр барих");
    expect(first.view.phase).toBe("lobby");
    expect(first.seats).toEqual(["alice"]);

    // one player cannot start alone
    a.frames.length = 0;
    a.send({ type: "action", action: { type: "sit", name: "Алиса" } });
    await a.state();
    a.frames.length = 0;
    a.send({ type: "action", action: { type: "start" } });
    expect((await a.error()).error).toMatch(/2 тоглогч/);

    const b = await sit(room, "bob", "Бат");
    a.frames.length = 0;
    b.frames.length = 0;
    a.send({ type: "action", action: { type: "start" } });
    const live = await b.next((f) => f?.type === "state" && f.view?.phase === "playing", "start");
    expect(live.view.players.map((p: any) => p.name)).toEqual(["Алиса", "Бат"]);
    expect(live.view.yourHand).toHaveLength(5);

    a.ws.close();
    b.ws.close();
  });

  it("gives each player their OWN hand and only counts for others", async () => {
    const { a, b, sa, sb } = await started(uniq("views"));
    expect(sa.you).toBe("alice");
    expect(sb.you).toBe("bob");
    expect(sa.view.yourTurn).toBe(true);
    expect(sb.view.yourTurn).toBe(false);
    for (const p of sa.view.players) {
      expect(p).not.toHaveProperty("hand");
      expect(p.handCount).toBe(5);
    }
    a.ws.close();
    b.ws.close();
  });

  it("refuses to act before joining", async () => {
    const a = await open(uniq("no-join"));
    a.send({ type: "action", action: { type: "start" } });
    expect((await a.error()).error).toBe("join first");
    a.ws.close();
  });
});

describe("playing", () => {
  it("enforces turn order (the client cannot move out of turn)", async () => {
    const { a, b } = await started(uniq("turn-order"));
    b.send({ type: "action", action: { type: "swap", cards: [0] } });
    expect((await b.error()).error).toBe("таны ээлж биш");
    a.ws.close();
    b.ws.close();
  });

  it("checks a placement against the build order", async () => {
    const { a, b, sa } = await started(uniq("order"));
    const hand: string[] = sa.view.yourHand;
    const wrong = hand.findIndex((c) => c !== "door" && c !== "storm");
    if (wrong >= 0) {
      a.send({ type: "action", action: { type: "place", card: wrong } });
      expect((await a.error()).error).toMatch(/дарааллаа/);
      a.frames.length = 0;
    }
    const door = hand.indexOf("door");
    if (door >= 0) {
      a.send({ type: "action", action: { type: "place", card: door } });
      const seenByB = await b.next(
        (f) => f?.type === "state" && f.view?.players?.[0]?.built?.length === 1,
        "the door to land",
      );
      expect(seenByB.view.players[0].built).toEqual(["door"]);
      // placing keeps the turn
      expect(seenByB.view.turn).toBe("alice");
    }
    a.ws.close();
    b.ws.close();
  });

  it("swaps cards, keeps the hand size and passes the turn", async () => {
    const { a, b } = await started(uniq("swap"));
    a.send({ type: "action", action: { type: "end" } });
    expect((await a.error()).error).toMatch(/эхлээд/);
    a.frames.length = 0;
    a.send({ type: "action", action: { type: "swap", cards: [0, 1] } });
    const after = await a.next((f) => f?.type === "state" && f.view?.turn === "bob", "turn to pass");
    expect(after.view.yourHand).toHaveLength(5);
    expect(after.view.last.kind).toBe("swap");
    a.ws.close();
    b.ws.close();
  });

  it("rejects malformed actions", async () => {
    const { a, b } = await started(uniq("bad-actions"));
    a.send({ type: "action", action: { type: "place", card: 99 } });
    expect((await a.error()).error).toBe("карт сонгоно уу");
    a.frames.length = 0;
    a.send({ type: "action", action: { type: "swap", cards: [0, 0] } });
    expect((await a.error()).error).toMatch(/өөр өөр/);
    a.frames.length = 0;
    a.send({ type: "action", action: { type: "fly" } });
    expect((await a.error()).error).toBe("үл мэдэгдэх үйлдэл");
    a.ws.close();
    b.ws.close();
  });

  it("resets to a fresh lobby on request", async () => {
    const { a, b } = await started(uniq("reset"));
    a.send({ type: "reset" });
    const fresh = await a.next((f) => f?.type === "state" && f.view?.phase === "lobby", "lobby");
    expect(fresh.result).toBeNull();
    a.ws.close();
    b.ws.close();
  });
});

describe("isolation and persistence", () => {
  it("keeps two rooms completely separate", async () => {
    const r_room_one = uniq("room-one");
    const r_room_two = uniq("room-two");
    const one = await open(r_room_one);
    const two = await open(r_room_two);
    one.send({ type: "join", playerId: "alice" });
    two.send({ type: "join", playerId: "bob" });

    const s1 = await one.state();
    const s2 = await two.state();
    // Each room saw only its own player.
    expect(s1.seats).toEqual(["alice"]);
    expect(s2.seats).toEqual(["bob"]);
    expect(s1.connected).toBe(1);
    expect(s2.connected).toBe(1);

    one.ws.close();
    two.ws.close();
  });

  it("survives a reconnect: state persists and the seat is reclaimed", async () => {
    const room = uniq("persist");
    const { a, b } = await started(room);
    a.send({ type: "action", action: { type: "swap", cards: [0] } });
    await a.next((f) => f?.type === "state" && f.view?.turn === "bob", "turn to pass");
    a.ws.close();

    const again = await open(room);
    again.send({ type: "join", playerId: "alice" });
    const restored = await again.state();
    expect(restored.seats).toEqual(["alice", "bob"]);
    expect(restored.view.phase).toBe("playing");
    expect(restored.view.turn).toBe("bob");
    expect(restored.view.players[0].name).toBe("Алиса");
    expect(restored.view.yourHand).toHaveLength(5);

    again.ws.close();
    b.ws.close();
  });

  it("drops a departed player from the connected count", async () => {
    const r_leave = uniq("leave");
    const a = await open(r_leave);
    const b = await open(r_leave);
    a.send({ type: "join", playerId: "alice" });
    b.send({ type: "join", playerId: "bob" });
    await a.next((f) => f?.type === "state" && f.connected === 2, "both connected");

    a.frames.length = 0;
    b.frames.length = 0;
    b.ws.close();
    const afterLeave = await a.next(
      (f) => f?.type === "state" && f.connected === 1,
      "the count to drop",
    );
    // The seat is kept (bob can reclaim it); only the connection went away.
    expect(afterLeave.seats).toEqual(["alice", "bob"]);
    a.ws.close();
  });
});

describe("untrusted input", () => {
  it("rejects a non-JSON frame", async () => {
    const r_bad_json = uniq("bad-json");
    const a = await open(r_bad_json);
    a.ws.send("not json at all");
    expect((await a.error()).error).toBe("invalid json");
    a.ws.close();
  });

  it("rejects a JSON array (not an object)", async () => {
    const r_bad_shape = uniq("bad-shape");
    const a = await open(r_bad_shape);
    a.ws.send(JSON.stringify([1, 2, 3]));
    expect((await a.error()).error).toBe("expected a json object");
    a.ws.close();
  });

  it("rejects an unknown message type", async () => {
    const r_bad_type = uniq("bad-type");
    const a = await open(r_bad_type);
    a.send({ type: "definitely-not-a-thing" });
    expect((await a.error()).error).toMatch(/unknown message type/);
    a.ws.close();
  });

  it("requires a playerId on join", async () => {
    const r_no_id = uniq("no-id");
    const a = await open(r_no_id);
    a.send({ type: "join" });
    expect((await a.error()).error).toBe("playerId required");
    a.frames.length = 0;
    a.send({ type: "join", playerId: "   " });
    // Whitespace is a real id per the previous engine's clamp; what must NOT
    // happen is a crash — assert we still get a protocol frame back.
    await a.next((f) => f?.type === "state" || f?.type === "error", "any protocol frame");
    a.ws.close();
  });

  it("refuses an oversized frame instead of persisting it", async () => {
    const r_too_big = uniq("too-big");
    const a = await open(r_too_big);
    a.send({ type: "join", playerId: "alice" });
    await a.state();
    a.frames.length = 0;
    // Well over the 16 KiB frame cap.
    a.send({ type: "action", action: { blob: "x".repeat(20_000) } });
    expect((await a.error()).error).toBe("message too large");
    a.ws.close();
  });

  it("refuses an oversized action payload", async () => {
    const r_big_action = uniq("big-action");
    const a = await open(r_big_action);
    a.send({ type: "join", playerId: "alice" });
    await a.state();
    a.frames.length = 0;
    // Under the frame cap, over the 4 KiB action cap.
    a.send({ type: "action", action: { blob: "x".repeat(6_000) } });
    expect((await a.error()).error).toBe("action too large");
    a.ws.close();
  });

  it("does not seat a spectator beyond maxPlayers, and refuses their actions", async () => {
    const room = uniq("spectator");
    const seated = [];
    for (const id of ["p1", "p2", "p3", "p4"]) {
      const c = await open(room);
      c.send({ type: "join", playerId: id });
      await c.state();
      seated.push(c);
    }
    const s = await open(room);
    s.send({ type: "join", playerId: "watcher" });
    const asWatcher = await s.next((f) => f?.type === "state" && f.connected === 5, "five connected");
    expect(asWatcher.seats).toEqual(["p1", "p2", "p3", "p4"]);
    expect(asWatcher.view.seated).toBe(false);

    s.frames.length = 0;
    s.send({ type: "action", action: { type: "sit", name: "Үзэгч" } });
    expect((await s.error()).error).toBe("spectators cannot act");

    s.frames.length = 0;
    s.send({ type: "reset" });
    expect((await s.error()).error).toBe("spectators cannot reset");

    for (const c of seated) c.ws.close();
    s.ws.close();
  });
});
