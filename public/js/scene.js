// ── three.js scene: renderer, camera, lights, ground + hills ────────────────

import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { $ } from "./dom.js";

export const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;

const canvas = $("#scene");
export const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;

export const scene = new THREE.Scene();
scene.background = new THREE.Color("#cfe6f1");
scene.fog = new THREE.Fog("#d9ebf2", 22, 60);

export const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 200);
camera.position.set(0, 6.4, 9.6);
export const controls = new OrbitControls(camera, canvas);
controls.target.set(0, 0.7, -1.8);
controls.enableDamping = true;
controls.enablePan = false;
controls.minDistance = 4;
controls.maxDistance = 22;
controls.minPolarAngle = 0.35;
controls.maxPolarAngle = 1.35;

scene.add(new THREE.HemisphereLight("#fff6e0", "#7aa457", 0.9));
const sun = new THREE.DirectionalLight("#ffe2b0", 2.1);
sun.position.set(-8, 12, 6);
sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024);
Object.assign(sun.shadow.camera, { left: -12, right: 12, top: 12, bottom: -12, near: 1, far: 40 });
scene.add(sun);

export const mat = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0, flatShading: true, ...extra });

// ground + hills (low-poly)
{
  const geo = new THREE.CircleGeometry(60, 48, 0, Math.PI * 2);
  geo.rotateX(-Math.PI / 2);
  const ground = new THREE.Mesh(geo, mat("#86b35c"));
  ground.receiveShadow = true;
  scene.add(ground);
  const hillGeo = new THREE.IcosahedronGeometry(1, 1);
  const hillMats = [mat("#94bd6b"), mat("#7fa95a"), mat("#b7b6d6")];
  const hills = [];
  for (let i = 0; i < 26; i++) {
    const a = (i / 26) * Math.PI * 2 + (i % 3) * 0.1;
    const r = 40 + (i % 4) * 6;
    hills.push({ a, r, s: 3 + (i % 5) * 1.4, m: i % 3 });
  }
  for (const m of [0, 1, 2]) {
    const list = hills.filter((h) => h.m === m);
    const inst = new THREE.InstancedMesh(hillGeo, hillMats[m], list.length);
    const d = new THREE.Object3D();
    list.forEach((h, i) => {
      d.position.set(Math.sin(h.a) * h.r, -h.s * 0.45, -Math.cos(h.a) * h.r);
      d.scale.set(h.s * 1.8, h.s, h.s * 1.4);
      d.rotation.y = h.a;
      d.updateMatrix();
      inst.setMatrixAt(i, d.matrix);
    });
    scene.add(inst);
  }
}
