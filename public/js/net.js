// ── net (template harness, kept) ─────────────────────────────────────────────

/** Each visitor without ?room= gets a fresh room, so the link they share is theirs. */
function resolveRoom() {
  const params = new URLSearchParams(location.search);
  let name = params.get("room");
  if (!name) {
    name = Math.random().toString(36).slice(2, 8);
    params.set("room", name);
    history.replaceState(null, "", `${location.pathname}?${params}`);
  }
  return name;
}
export const room = resolveRoom();

function playerId() {
  const key = "hf:game:playerId";
  let id = localStorage.getItem(key);
  if (!id) {
    id = Math.random().toString(36).slice(2, 10);
    localStorage.setItem(key, id);
  }
  return id;
}
export const ME = playerId();

const PING = "__ping";
const PONG = "__pong";
let socket = null;
let retry = 0;

/** `onState(msg)` gets each state frame, `notify(text, isError)` shows connection errors. */
export function connect(onState, notify) {
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  socket = new WebSocket(`${proto}//${location.host}/ws/${encodeURIComponent(room)}`);
  socket.addEventListener("open", () => {
    retry = 0;
    send({ type: "join", playerId: ME });
  });
  socket.addEventListener("message", (event) => {
    if (event.data === PONG) return;
    let msg;
    try {
      msg = JSON.parse(event.data);
    } catch {
      return;
    }
    if (msg.type === "state") onState(msg);
    else if (msg.type === "error") notify(msg.error, true);
  });
  socket.addEventListener("close", () => {
    retry = Math.min(retry + 1, 6);
    const wait = 500 * 2 ** (retry - 1);
    notify(`Холболт тасарлаа, ${Math.round(wait / 1000)} секундын дараа дахин оролдоно`, true);
    setTimeout(() => connect(onState, notify), wait);
  });
}
export function send(msg) {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(msg));
}
setInterval(() => {
  if (socket?.readyState === WebSocket.OPEN) socket.send(PING);
}, 30_000);
