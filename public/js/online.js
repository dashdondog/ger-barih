import { $ } from "./dom.js";
import { ME } from "./net.js";

// ── online count: a heartbeat every 20 s, answered with everyone online in any room ──

const ONLINE_BEAT_MS = 20_000;
async function beat() {
  if (document.hidden) return; // a tab in the background is not someone playing
  try {
    const res = await fetch(`/api/online?id=${encodeURIComponent(ME)}`, { cache: "no-store" });
    if (!res.ok) return;
    const { online } = await res.json();
    if (!Number.isInteger(online)) return;
    $("#online-count").textContent = String(Math.max(1, online));
    $("#online").setAttribute("aria-label", `${online} хүн онлайн`);
    $("#online").hidden = false;
  } catch {
    /* offline for a moment; the next beat retries */
  }
}
beat();
setInterval(beat, ONLINE_BEAT_MS);
document.addEventListener("visibilitychange", () => { if (!document.hidden) beat(); });
