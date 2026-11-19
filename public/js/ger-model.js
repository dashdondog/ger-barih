// ── ger model: dimensions, textures, materials, the eleven parts ────────────

import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { mat } from "./scene.js";

// door opening the gate has to fit into (local units)
const DOOR_W = 0.62;
const DOOR_H = 0.74;
// toono model diameter (a little wider than the uni ring TR so the poles meet it)
const TOONO_D = 0.7;
// height of the toono's centre; the uni tops meet the toono ring at this height
const TOONO_Y = 1.40;
// radius where the uni tops meet the toono (just inside its outer rim)
const UNI_TOP_R = TOONO_D / 2 - 0.09;   // 0.05 inside the rim; bigger number = further from the edge

// bagana height: from the floor up to just under the crown (TOP = 1.55)
const BAGANA_H = 1.32;

const loader = new GLTFLoader();
const cache = new Map();
/**
 * Load a .glb once, scale it with `scaleFor(size)`, centre it on x/z and stand it on y = 0.
 * Resolves to a group whose userData.height is the scaled height.
 */
function loadModel(url, scaleFor) {
  if (!cache.has(url)) {
    cache.set(url, loader.loadAsync(url).then((gltf) => {
      const model = gltf.scene;
      const size = new THREE.Box3().setFromObject(model).getSize(new THREE.Vector3());
      model.scale.setScalar(scaleFor(size));
      const box = new THREE.Box3().setFromObject(model);
      const center = box.getCenter(new THREE.Vector3());
      model.position.set(-center.x, -box.min.y, -center.z);
      model.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
      const wrap = new THREE.Group();
      wrap.add(model);
      wrap.userData.height = box.max.y - box.min.y;
      return wrap;
    }));
  }
  return cache.get(url);
}
const loadDoor = () => loadModel("/models/door.glb", (s) => Math.min(DOOR_H / s.y, DOOR_W / s.x));
const loadToono = () => loadModel("/models/toono.glb", (s) => TOONO_D / Math.max(s.x, s.z));
// distance between the two bagana (the copy stands this far in front, towards the door)
const BAGANA_GAP = 0.3;
const loadBagana =() => loadModel("/models/toono2.glb", (s) => BAGANA_H / s.y);

export const R = 1.2;          // wall radius
export const H = 0.78;         // wall height
export const TOP = 1.55;       // crown height
export const TR = 0.26;        // crown radius
export const GAP = 0.46;       // door gap, radians

function latticeTexture() {
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 64;
  const g = c.getContext("2d");
  g.strokeStyle = "#511c0ec0";
  g.lineWidth = 5;
  for (let x = -64; x < 320; x += 22) {
    g.beginPath(); g.moveTo(x, 0); g.lineTo(x + 64, 64); g.stroke();
    g.beginPath(); g.moveTo(x + 64, 0); g.lineTo(x, 64); g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = THREE.RepeatWrapping;
  t.repeat.set(3, 1);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
function canvasCoverTexture() {
  const c = document.createElement("canvas");
  c.width = 512;
  c.height = 128;
  const g = c.getContext("2d");
  g.fillStyle = "#fbfaf5";
  g.fillRect(0, 0, 512, 128);
  g.fillStyle = "#2f6fb3";
  g.fillRect(0, 96, 512, 22);
  g.fillStyle = "#fbfaf5";
  for (let x = 0; x < 512; x += 24) {
    g.fillRect(x + 4, 100, 12, 4);
    g.fillRect(x + 12, 100, 4, 10);
    g.fillRect(x + 8, 106, 8, 4);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = THREE.RepeatWrapping;
  t.repeat.set(4, 1);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export const M = {
  wood: mat("#c8502e"),
  woodDark: mat("#9c3c22"),
  blue: mat("#2f6fb3"),
  gold: mat("#f2b53a", { emissive: "#6b4200", emissiveIntensity: 0.25 }),
  lattice: new THREE.MeshStandardMaterial({ map: latticeTexture(), transparent: true, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.9 }),
  felt: mat("#e9dcc2", { side: THREE.DoubleSide }),
  canvas: new THREE.MeshStandardMaterial({ map: canvasCoverTexture(), side: THREE.DoubleSide, roughness: 0.8 }),
  rope: mat("#5a3b24"),
  floor: mat("#b88a5a"),
};
// the lattice texture is drawn with transparent gaps; clear the canvas first
{
  const t = M.lattice.map;
  const g = t.image.getContext("2d");
  const copy = g.getImageData(0, 0, 256, 64);
  g.clearRect(0, 0, 256, 64);
  g.putImageData(copy, 0, 0);
  t.needsUpdate = true;
}

function rod(a, b, radius, material) {
  const dir = new THREE.Vector3().subVectors(b, a);
  const len = dir.length();
  const geo = new THREE.CylinderGeometry(radius, radius, len, 6);
  geo.translate(0, len / 2, 0);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
  geo.applyQuaternion(q);
  geo.translate(a.x, a.y, a.z);
  return geo;
}

/** Eleven groups, one per build step, positioned in the ger's local frame (door faces +z). */
export function buildParts() {
  const parts = [];
  const add = (...meshes) => {
    const g = new THREE.Group();
    for (const m of meshes) {
      m.castShadow = true;
      m.receiveShadow = true;
      g.add(m);
    }
    parts.push(g);
  };

  // 0 door: the gate model from public/models/door.glb, loaded once and cloned per ger
  {
    const g = new THREE.Group();
    loadDoor().then((door) => {
      const d = door.clone();
      d.position.set(0, 0, R + 0.02);
      g.add(d);
    });
    parts.push(g);
  }
  // 1-2 khana halves
  for (const [start, len] of [[GAP / 1.9, Math.PI - GAP / 2], [Math.PI, Math.PI - GAP / 2]]) {
    const geo = new THREE.CylinderGeometry(R, R, H, 32, 1, true, start, len);
    geo.translate(0, H / 2, 0);
    add(new THREE.Mesh(geo, M.lattice));
  }
  // 3 toono: the crown model from public/models/toono.glb, centred on the crown height
  {
    const g = new THREE.Group();
    loadToono().then((toono) => {
      const t = toono.clone();
      t.position.y = TOONO_Y - toono.userData.height / 2; // centre of the toono at TOONO_Y
      g.add(t);
    });
    parts.push(g);
  }
  // 4 bagana: the pillar model from public/models/toono2.glb, floor up to the toono
  {
    const g = new THREE.Group();
    loadBagana().then((bagana) => {
      const back = bagana.clone();
      const front = bagana.clone();
      back.rotation.y = Math.PI / 2;
      front.rotation.y = Math.PI / 2;
      front.position.set(-0.28, 0, 0);
      back.position.set(0.28, 0, 0);   // (x, y, z)
      g.add(back, front);
    });
    parts.push(g);
  }
  // 5-6 uni (roof poles), split even / odd
  const UNI_CUT_TOP = 0.08;    // share of the length cut off at the toono end
  const UNI_CUT_BOTTOM = 0;    // share of the length cut off at the wall end
  for (const parity of [0, 1]) {
    const geos = [];
    const count = 40;
    for (let i = parity; i < count; i += 2) {
      const a = (i / count) * Math.PI * 2;
      const wall = new THREE.Vector3(Math.sin(a) * R, H, Math.cos(a) * R);
      const crown = new THREE.Vector3(Math.sin(a) * UNI_TOP_R, TOONO_Y, Math.cos(a) * UNI_TOP_R);
      // shorten the pole: cut a share of its length off each end (0.1 = 10 %)
      const lo = wall.clone().lerp(crown, UNI_CUT_BOTTOM);
      const hi = crown.clone().lerp(wall, UNI_CUT_TOP);
      geos.push(rod(lo, hi, 0.016));
    }
    add(new THREE.Mesh(mergeGeometries(geos), M.wood));
  }
  // 7 esgii wall felt (keeps the door clear)
  {
    const geo = new THREE.CylinderGeometry(R + 0.03, R + 0.03, H, 36, 1, true, GAP / 2, Math.PI * 2 - GAP);
    geo.translate(0, H / 2, 0);
    add(new THREE.Mesh(geo, M.felt));
  }
  // roof cover cone: follows the uni slope from the wall top up to the toono rim (leaves the toono open)
  //   lift   – how far it sits above the poles
  //   reach  – how far it hangs out past the wall
  const roofCone = (lift, reach, segments) => {
    const topR = TOONO_D / 2;                                                // ends at the toono rim
    const slope = (TOONO_Y - H) / (R - UNI_TOP_R);                           // rise per unit of radius along the uni
    const topY = H + (R - topR) * slope;                                     // uni height at the toono rim
    const bottomR = R + reach;
    const bottomY = H - reach * slope;                                       // keep the same slope past the wall
    const geo = new THREE.CylinderGeometry(topR, bottomR, topY - bottomY, segments, 1, true);
    geo.translate(0, (topY + bottomY) / 2 + lift, 0);
    return geo;
  };
  // 8 esgii roof felt
  add(new THREE.Mesh(roofCone(0.03, 0.05, 36), M.felt));
  // 9 gadar: white canvas over wall and roof
  {
    const wall = new THREE.CylinderGeometry(R + 0.07, R + 0.07, H + 0.02, 40, 1, true, GAP / 2, Math.PI * 2 - GAP);
    wall.translate(0, H / 2, 0);
    add(new THREE.Mesh(wall, M.canvas), new THREE.Mesh(roofCone(0.06, 0.08, 40), M.canvas));
  }
  // 10 bus: three ropes round the wall, leaving the same GAP as the khana at the door (+z)
  {
    const geos = [0.18, 0.42, 0.66].map((y) => {
      const g = new THREE.TorusGeometry(R + 0.09, 0.022, 5, 48, Math.PI * 2 - GAP);
      g.rotateX(Math.PI / 2);
      g.rotateY(-(Math.PI / 2 + GAP / 2)); // centre the gap on the door
      g.translate(0, y, 0);
      return g;
    });
    add(new THREE.Mesh(mergeGeometries(geos), M.rope));
  }
  return parts;
}
