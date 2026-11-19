// ── camera framing: intro orbit, game view, resize, intro → table glide ─────

import * as THREE from "three";
import { $ } from "./dom.js";
import { renderer, scene, camera, controls, reduced } from "./scene.js";
import { layout, sites, placeRoot } from "./sites.js";
import { tween } from "./animation.js";
import { INTRO_AT, intro } from "./intro.js";

/** Frame the intro ger beside the title (landscape) or above it (portrait). */
function introView(w, h) {
  const portrait = w < h;
  camera.fov = portrait ? 40 : 34;
  camera.setViewOffset(w, h, portrait ? 0 : -w * 0.2, portrait ? h * 0.25 : 0, w, h);
  camera.updateProjectionMatrix();
}

export function introFrame(now) {
  const a = reduced ? 0.35 : now * 0.00012 + 0.35;
  const far = layout.tall ? 10.5 : 8;
  camera.position.set(INTRO_AT.x + Math.sin(a) * far, layout.tall ? 4 : 3, INTRO_AT.z + Math.cos(a) * far);
  camera.lookAt(INTRO_AT.x, 0.8, INTRO_AT.z);
}

export function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  const portrait = w < h;
  if (portrait !== layout.tall) {
    layout.tall = portrait;
    for (const site of sites.values()) placeRoot(site.root, site.index);
  }
  camera.fov = portrait ? 50 : 42;
  // the narrower the screen, the further back the camera sits to fit the sites
  const back = portrait ? Math.min(1.6, Math.max(1.15, 0.7 / (w / h))) : 1;
  camera.position.set(0, (portrait ? 8.6 : 6.4) * back, (portrait ? 7.6 : 9.6) * back);
  controls.target.set(0, 0.7, portrait ? -3.2 : -1.8);
  // the hand panel covers the bottom of the screen; lift the scene above it
  camera.setViewOffset(w, h, 0, h * (portrait ? 0.17 : 0.12), w, h);
  camera.updateProjectionMatrix();
  if (intro.on) { introView(w, h); return; }
  controls.update();
}

/** Leave the intro: glide the camera to the play area, then drop the showcase ger. */
export function leaveIntro(instant = false) {
  if (!intro.on) return;
  intro.on = false;
  document.body.classList.remove("intro-on");
  const box = $("#intro");
  const from = camera.position.clone();
  const fromLook = new THREE.Vector3(INTRO_AT.x, 0.85, INTRO_AT.z);
  resize(); // sets the game camera and view offset
  controls.enabled = true;
  const to = camera.position.clone();
  const toLook = controls.target.clone();
  const drop = () => { scene.remove(intro.site.root); box.hidden = true; };
  if (instant) { drop(); return; }
  box.classList.add("leaving");
  camera.position.copy(from);
  controls.target.copy(fromLook);
  tween(1100, (t) => {
    const e = 1 - Math.pow(1 - t, 3);
    camera.position.lerpVectors(from, to, e);
    controls.target.lerpVectors(fromLook, toLook, e);
  }, drop);
  afterLeave?.();
}

/** game-ui.js hooks in here to draw the HUD once the intro has gone. */
let afterLeave = null;
export const afterLeaveIntro = (fn) => { afterLeave = fn; };

addEventListener("resize", resize);
// the phone layout parks the build order just above the hand panel, whose height varies
new ResizeObserver(([e]) => document.documentElement.style.setProperty("--bottom-h", `${e.target.offsetHeight}px`)).observe($("#bottom"));
resize();
