// ── intro: a ger raises itself, away from the play area, while the title is up ──

import * as THREE from "three";
import { scene, controls, reduced } from "./scene.js";
import { R, M, buildParts } from "./ger-model.js";
import { placePart } from "./animation.js";

export const INTRO_AT = new THREE.Vector3(0, 0, 16);
export const intro = { on: true, site: null };
controls.enabled = false;
{
  const root = new THREE.Group();
  root.position.copy(INTRO_AT);
  const floor = new THREE.Mesh(new THREE.CylinderGeometry(R + 0.35, R + 0.42, 0.08, 32), M.floor);
  floor.position.y = -0.03;
  floor.receiveShadow = true;
  root.add(floor);
  const parts = buildParts();
  for (const p of parts) {
    p.visible = reduced;
    p.userData.base = p.position.clone();
    root.add(p);
  }
  scene.add(root);
  intro.site = { root, parts };
  if (!reduced) parts.forEach((_, i) => setTimeout(() => intro.on && placePart(intro.site, i), 700 + i * 360));
}
