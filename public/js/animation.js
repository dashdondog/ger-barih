// ── animation: tweens, dust puffs, placing / blowing ger parts ──────────────

import * as THREE from "three";
import { scene, reduced } from "./scene.js";
import { R } from "./ger-model.js";

const tweens = [];
const easeOutBack = (t) => 1 + 2.7 * Math.pow(t - 1, 3) + 1.7 * Math.pow(t - 1, 2);
const easeIn = (t) => t * t;
export function tween(dur, step, done) {
  if (reduced) { step(1); done?.(); return; }
  tweens.push({ start: performance.now(), dur, step, done });
}

const puffGeo = new THREE.IcosahedronGeometry(0.07, 0);
const puffMat = new THREE.MeshStandardMaterial({ color: "#e7dcc4", transparent: true, roughness: 1, flatShading: true });
const PUFFS = 64;
const puffs = new THREE.InstancedMesh(puffGeo, puffMat, PUFFS);
puffs.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
puffs.count = 0;
scene.add(puffs);
const puffData = [];
const dummy = new THREE.Object3D();
function emitPuffs(origin, n, spread, rise) {
  if (reduced) return;
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2;
    puffData.push({
      p: origin.clone().add(new THREE.Vector3(Math.cos(a) * spread, 0.05, Math.sin(a) * spread)),
      v: new THREE.Vector3(Math.cos(a) * 0.9, rise * (0.6 + Math.random() * 0.8), Math.sin(a) * 0.9),
      life: 0,
      max: 0.7 + Math.random() * 0.5,
    });
  }
  while (puffData.length > PUFFS) puffData.shift();
}

export function placePart(site, i) {
  const p = site.parts[i];
  p.visible = true;
  const base = p.userData.base;
  tween(650, (t) => {
    const e = easeOutBack(t);
    p.position.set(base.x, base.y + (1 - e) * 2.2, base.z);
    p.scale.setScalar(0.8 + 0.2 * Math.min(1, e));
  }, () => {
    p.position.copy(base);
    p.scale.setScalar(1);
    emitPuffs(site.root.position.clone().add(new THREE.Vector3(0, 0, 0)), 14, R + 0.2, 0.8);
  });
}
export function blowPart(site, i) {
  const p = site.parts[i];
  const base = p.userData.base;
  emitPuffs(site.root.position.clone(), 22, R + 0.4, 2.4);
  tween(950, (t) => {
    const e = easeIn(t);
    p.position.set(base.x + e * 2.5, base.y + e * 4, base.z - e * 1.5);
    p.rotation.set(e * 1.5, e * 4, e * 0.8);
    p.scale.setScalar(1 - e * 0.6);
  }, () => {
    p.visible = false;
    p.position.copy(base);
    p.rotation.set(0, 0, 0);
    p.scale.setScalar(1);
  });
}
export function setBuilt(site, n, animate) {
  if (!animate) {
    site.parts.forEach((p, i) => {
      p.visible = i < n;
      p.position.copy(p.userData.base);
      p.rotation.set(0, 0, 0);
      p.scale.setScalar(1);
    });
    site.shown = n;
    return;
  }
  if (n > site.shown) {
    for (let i = site.shown; i < n; i++) setTimeout(() => placePart(site, i), (i - site.shown) * 220);
  } else if (n < site.shown) {
    for (let i = n; i < site.shown; i++) blowPart(site, i);
  }
  site.shown = n;
}

/** Advance every running tween; called once per frame from loop.js. */
export function updateTweens(now) {
  for (let i = tweens.length - 1; i >= 0; i--) {
    const tw = tweens[i];
    const t = Math.min(1, (now - tw.start) / tw.dur);
    tw.step(t);
    if (t >= 1) { tweens.splice(i, 1); tw.done?.(); }
  }
}

/** Move, shrink and retire the dust puffs; called once per frame from loop.js. */
export function updatePuffs(dt) {
  let alive = 0;
  for (const d of puffData) {
    d.life += dt;
    d.v.y -= 1.6 * dt;
    d.p.addScaledVector(d.v, dt);
    if (d.life < d.max) {
      const s = 1 - d.life / d.max;
      dummy.position.copy(d.p);
      dummy.scale.setScalar(0.4 + s);
      dummy.updateMatrix();
      puffs.setMatrixAt(alive++, dummy.matrix);
    }
  }
  for (let i = puffData.length - 1; i >= 0; i--) if (puffData[i].life >= puffData[i].max) puffData.splice(i, 1);
  puffs.count = alive;
  puffs.instanceMatrix.needsUpdate = true;
}
