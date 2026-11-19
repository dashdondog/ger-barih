// ── ger preview (temporary): model + animation only, no server ──────────────
// "Тоглох" leaves the intro and drops one ger on the table.
//   → / Space   next part (placePart)
//   ← / Backspace   blow the last part away (blowPart)
//   R   rebuild from scratch,  F   show all instantly

import { $ } from "./dom.js";
import { makeSite } from "./sites.js";
import { setBuilt } from "./animation.js";
import { leaveIntro } from "./camera.js";

const preview = { site: null, n: 0 };
function previewHint() {
  const t = $("#toast");
  t.textContent = `${preview.n}/11 · → дараагийн хэсэг · ← хийсгэх · R дахин · F бүгд`;
  t.classList.add("on");
}
function previewStart() {
  leaveIntro();
  if (!preview.site) preview.site = makeSite(0);
  preview.n = 0;
  setBuilt(preview.site, 0, false);
  previewHint();
}
function previewSet(n, animate = true) {
  if (!preview.site) return;
  preview.n = Math.max(0, Math.min(11, n));
  setBuilt(preview.site, preview.n, animate);
  previewHint();
}
$("#intro-play").addEventListener("click", previewStart);
$("#intro-play").focus();
addEventListener("keydown", (e) => {
  if (!preview.site) return;
  if (e.code === "ArrowRight" || e.code === "Space") { e.preventDefault(); previewSet(preview.n + 1); }
  else if (e.code === "ArrowLeft" || e.code === "Backspace") { e.preventDefault(); previewSet(preview.n - 1); }
  else if (e.code === "KeyR") { previewSet(0, false); previewSet(11); }
  else if (e.code === "KeyF") previewSet(11, false);
});
