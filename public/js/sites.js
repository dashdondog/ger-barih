// ── sites: one ger plot per player (floor, turn glow, name label, parts) ────

import * as THREE from "three";
import { scene } from "./scene.js";
import { R, TOP, M, buildParts } from "./ger-model.js";

const SLOT = [
  new THREE.Vector3(0, 0, 0),
  new THREE.Vector3(-3.9, 0, -3.6),
  new THREE.Vector3(3.9, 0, -3.6),
  new THREE.Vector3(0, 0, -6.4),
];
// a phone held upright is narrow: stack the sites deeper instead of wider
const SLOT_TALL = [
  new THREE.Vector3(0, 0, 0),
  new THREE.Vector3(-2.2, 0, -3.8),
  new THREE.Vector3(2.2, 0, -3.8),
  new THREE.Vector3(0, 0, -6.6),
];
/** Shared layout flag; camera.js flips `tall` on resize. */
export const layout = { tall: innerWidth < innerHeight };
const slotAt = (index) => (layout.tall ? SLOT_TALL : SLOT)[index];

function labelSprite() {
  const c = document.createElement("canvas");
  c.width = 512;
  c.height = 128;
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  sprite.scale.set(2.4, 0.6, 1);
  sprite.renderOrder = 10;
  const draw = (text, color, active) => {
    const g = c.getContext("2d");
    g.clearRect(0, 0, 512, 128);
    g.font = "700 46px Manrope, sans-serif";
    const w = Math.min(500, g.measureText(text).width + 70);
    const x = (512 - w) / 2;
    g.fillStyle = active ? "#f2b53a" : "rgba(251,246,234,0.94)";
    g.beginPath();
    g.roundRect(x, 24, w, 80, 40);
    g.fill();
    g.fillStyle = color;
    g.beginPath();
    g.arc(x + 38, 64, 13, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = "#2a2118";
    g.textBaseline = "middle";
    g.fillText(text, x + 60, 66, w - 76);
    tex.needsUpdate = true;
  };
  return { sprite, draw };
}

export const sites = new Map(); // playerId -> site

export function placeRoot(root, index) {
  const at = slotAt(index);
  root.position.copy(at);
  root.rotation.y = index === 0 ? 0 : Math.atan2(-at.x, -at.z + 9) * 0.6;
}

export function makeSite(index) {
  const root = new THREE.Group();
  placeRoot(root, index);
  const floor = new THREE.Mesh(new THREE.CylinderGeometry(R + 0.35, R + 0.42, 0.08, 32), M.floor);
  floor.position.y = -0.03;
  floor.receiveShadow = true;
  root.add(floor);
  const glow = new THREE.Mesh(new THREE.TorusGeometry(R + 0.55, 0.05, 6, 48), M.gold);
  glow.rotation.x = Math.PI / 2;
  glow.position.y = 0.02;
  glow.visible = false;
  root.add(glow);
  const parts = buildParts();
  for (const p of parts) {
    p.visible = false;
    p.userData.base = p.position.clone();
    root.add(p);
  }
  const label = labelSprite();
  label.sprite.position.set(0, TOP + 0.75, 0);
  root.add(label.sprite);
  scene.add(root);
  return { root, parts, glow, label, shown: 0, index, labelKey: "" };
}

export function disposeSite(site) {
  scene.remove(site.root);
}
