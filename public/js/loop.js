// ── frame loop ──────────────────────────────────────────────────────────────

import { renderer, scene, camera, controls } from "./scene.js";
import { sites } from "./sites.js";
import { updateTweens, updatePuffs } from "./animation.js";
import { intro } from "./intro.js";
import { introFrame } from "./camera.js";

let last = performance.now();
renderer.setAnimationLoop((now) => {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  updateTweens(now);
  updatePuffs(dt);
  for (const site of sites.values()) {
    if (site.glow.visible) site.glow.material.emissiveIntensity = 0.35 + Math.sin(now / 280) * 0.25;
  }
  if (intro.on) introFrame(now);
  else controls.update();
  renderer.render(scene, camera);
});
