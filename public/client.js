/**
 * Гэр барих: the client entry. index.html loads this file; it only wires the
 * modules in order. Each module in ./js/ owns one concern.
 *
 *   3D
 *   js/dom.js          $, el, icon, iconButton
 *   js/scene.js        renderer, scene, camera, controls, lights, ground + hills
 *   js/ger-model.js    ger dimensions, textures, materials, buildParts() (11 parts)
 *   js/sites.js        one plot per player: floor, glow, label, makeSite()
 *   js/animation.js    tweens, dust puffs, placePart / blowPart / setBuilt
 *   js/intro.js        the self-building ger behind the title screen
 *   js/camera.js       intro orbit, game view, resize, leaveIntro()
 *   js/loop.js         the per-frame render loop
 *
 *   game
 *   js/net.js          room, player id, WebSocket connect / send
 *   js/data.js         part names and texts, step labels, player colours
 *   js/toast-share.js  toast messages, invite link copy
 *   js/online.js       online-count heartbeat
 *   js/sound.js        synthesised sound effects
 *   js/game-ui.js      server state → sites + HUD, lobby, hand, actions, help, keys
 *
 *   js/preview.js      TEMP tool: build/blow a ger with the keyboard, no server.
 *                      Off while the game runs (both claim the "Тоглох" button).
 */

import "./js/scene.js";
import "./js/ger-model.js";
import "./js/sites.js";
import "./js/animation.js";
import "./js/intro.js";
import "./js/camera.js";
import "./js/loop.js";

import "./js/game-ui.js";

// import "./js/preview.js";
