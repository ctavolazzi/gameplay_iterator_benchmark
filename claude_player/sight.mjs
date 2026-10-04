// The player's sight: a picture of the world as its eyes would see it, drawn in this process
// from the blocks and creatures the server has sent it. No game client, no browser and no
// graphics card: one ray is cast for each dot of the picture through a box of block states.
// Everything here takes arrays and gives arrays back, with no game connection, so that tests
// can run it on a made-up world. eyes.mjs is the part that knows the player.

import { crc32, deflateSync, inflateSync } from 'node:zlib';

// How a block state is drawn.
export const KIND = { AIR: 0, CUBE: 1, CUTOUT: 2, SHAPED: 3, CROSS: 4, WATER: 5, LAVA: 6, FLAT: 7 };
// The faces of a block, in the order every table here uses.
export const FACE = { DOWN: 0, UP: 1, NORTH: 2, SOUTH: 3, WEST: 4, EAST: 5 };
const NX = [0, 0, 0, 0, -1, 1];
const NY = [-1, 1, 0, 0, 0, 0];
const NZ = [0, 0, -1, 1, 0, 0];
// The game shades the faces of a block by which way they point. These are its amounts.
const FACE_SHADE = [0.5, 1, 0.8, 0.8, 0.62, 0.62];
const NO_TEXTURE = 0xffff;

// The player's yaw and pitch as mineflayer keeps them, in radians: yaw 0 faces north (the z
// that gets smaller) and grows turning left; pitch grows looking up.
export function camera({ yaw, pitch, fov = 70, width, height }) {
  const cp = Math.cos(pitch), sp = Math.sin(pitch), cy = Math.cos(yaw), sy = Math.sin(yaw);
  const tanY = Math.tan((fov * Math.PI) / 360);
  return { f: [-sy * cp, sp, -cy * cp], r: [cy, 0, -sy], u: [sy * sp, cp, cy * sp],
    tanX: (tanY * width) / height, tanY, width, height };
}

// Where a point of the world falls in the picture, or null when it is behind the eye.
export function project(cam, eye, point) {
  const v = [point[0] - eye[0], point[1] - eye[1], point[2] - eye[2]];
  const ahead = v[0] * cam.f[0] + v[1] * cam.f[1] + v[2] * cam.f[2];
  if (ahead <= 0.05) return null;
  const right = v[0] * cam.r[0] + v[1] * cam.r[1] + v[2] * cam.r[2];
  const up = v[0] * cam.u[0] + v[1] * cam.u[1] + v[2] * cam.u[2];
  return { x: ((right / ahead / cam.tanX + 1) / 2) * cam.width, y: ((1 - up / ahead / cam.tanY) / 2) * cam.height, ahead };
}

// The compass point a yaw faces, and its heading in degrees (0 north, 90 east).
export function facing(yaw) {
  const heading = ((((-yaw * 180) / Math.PI) % 360) + 360) % 360;
  return { heading: Math.round(heading), name: ['north', 'east', 'south', 'west'][Math.round(heading / 90) % 4] };
}

// The yaw and pitch that look from one point at another.
export function aimAt(from, to) {
  const dx = to[0] - from[0], dy = to[1] - from[1], dz = to[2] - from[2];
  return { yaw: Math.atan2(-dx, -dz), pitch: Math.atan2(dy, Math.hypot(dx, dz)) };
}

// The sky for a time of day (0 sunrise, 6000 noon, 12000 sunset, 18000 midnight).
export function skyAt(timeOfDay, underground = false) {
  if (underground) return { top: [6, 6, 9], horizon: [9, 9, 13], sun: null, day: 0 };
  const mix = (a, b, k) => a.map((v, i) => v + (b[i] - v) * k);
  const t = ((timeOfDay % 24000) + 24000) % 24000;
  // How much of the day's light there is: 1 by day, 0 at night, sliding at dusk and dawn.
  const day = t < 11500 ? 1 : t < 13800 ? 1 - (t - 11500) / 2300 : t < 22000 ? 0 : (t - 22000) / 2000;
  const glow = day > 0 && day < 1 ? 1 - Math.abs(day - 0.5) * 2 : 0;
  const angle = (t / 24000) * 2 * Math.PI;
  return { top: mix([8, 10, 26], [108, 160, 250], day), horizon: mix(mix([18, 22, 44], [186, 210, 252], day), [240, 150, 96], glow * 0.7),
    sun: [Math.cos(angle), Math.sin(angle), 0], day };
}

let TR = 0, TG = 0, TB = 0, TA = 255;
function texel(tex, index, u, v) {
  const tx = u <= 0 ? 0 : u >= 1 ? 15 : (u * 16) | 0;
  const ty = v <= 0 ? 0 : v >= 1 ? 15 : (v * 16) | 0;
  const o = index * 1024 + (ty * 16 + tx) * 4;
  TR = tex[o]; TG = tex[o + 1]; TB = tex[o + 2]; TA = tex[o + 3];
}

// A scene ready to be drawn:
//   width, height, eye [x, y, z], yaw, pitch, fov, far (blocks)
//   grid  { ids: Uint16Array of block states, x0, y0, z0, sx, sy, sz } with x fastest, then z, then y
//   cells { kind, faces (6 a state), tintOf, tintMask, emit, flat (3 a state): typed arrays by
//           block state; boxes: Map of state to Float32Array of boxes for SHAPED states }
//   textures  Uint8Array, 16 by 16 RGBA each, or null for flat colours
//   tints     [[r, g, b], ...] by the number in tintOf
//   light     (x, y, z) => 0 to 1, or null for full light
//   lamp      how bright the player's own lamp is at its feet, 0 for none
//   sky       from skyAt()
export function prepare(scene) {
  const { width, height } = scene;
  return { ...scene, cam: camera(scene), rgb: new Uint8Array(width * height * 3), depth: new Float32Array(width * height).fill(Infinity),
    what: new Uint16Array(width * height), who: new Uint8Array(width * height), wetAt: new Float32Array(width * height) };
}

// Draws rows from..to of the world. Called in slices so the player's reflexes keep running.
export function rows(s, from, to) {
  const { width, height, rgb, depth, what, wetAt, cam, grid, cells, far, light, sky } = s;
  const tex = s.textures ?? null;
  const tints = s.tints ?? [[255, 255, 255]];
  const lamp = s.lamp ?? 0;
  const { ids, x0, y0, z0, sx, sy, sz } = grid;
  const { kind, faces, tintOf, tintMask, emit, flat, boxes } = cells;
  const [ex, ey, ez] = s.eye;
  const [f0, f1, f2] = cam.f, [r0, r1, r2] = cam.r, [u0, u1, u2] = cam.u;
  const fogFrom = far * 0.55;
  const waterIndex = s.waterTexture ?? NO_TEXTURE;
  const waterTint = tints[s.waterTint ?? 0] ?? [63, 118, 228];
  let CR = 0, CG = 0, CB = 0;

  // The colour of a block's face where the ray met it. False when that dot of its texture is clear.
  const paint = (id, face, t, cx, cy, cz, dx, dy, dz, crossU) => {
    const lx = ex + dx * t - cx, ly = ey + dy * t - cy, lz = ez + dz * t - cz;
    let u, v;
    if (crossU >= 0) { u = crossU; v = 1 - ly; }
    else if (face === 1) { u = lx; v = lz; }
    else if (face === 0) { u = lx; v = 1 - lz; }
    else if (face === 2) { u = 1 - lx; v = 1 - ly; }
    else if (face === 3) { u = lx; v = 1 - ly; }
    else if (face === 4) { u = lz; v = 1 - ly; }
    else { u = 1 - lz; v = 1 - ly; }
    const index = tex ? faces[id * 6 + face] : NO_TEXTURE;
    let r, g, b;
    if (index !== NO_TEXTURE) {
      texel(tex, index, u, v);
      if (TA < 128) return false;
      r = TR; g = TG; b = TB;
      if (tintMask[id] & (1 << face)) { const tint = tints[tintOf[id]]; r = (r * tint[0]) / 255; g = (g * tint[1]) / 255; b = (b * tint[2]) / 255; }
    } else {
      // No texture: the block's own colour, a little darker at its edges so that blocks can be counted.
      const edge = u < 0.0625 || u > 0.9375 || v < 0.0625 || v > 0.9375 ? 0.82 : 1;
      r = flat[id * 3] * edge; g = flat[id * 3 + 1] * edge; b = flat[id * 3 + 2] * edge;
    }
    let bright = 1;
    if (!emit[id]) {
      // A plant is lit by the air it stands in; a face, by the air in front of it.
      const lit = !light ? 1 : crossU >= 0 ? light(cx, cy, cz) : light(cx + NX[face], cy + NY[face], cz + NZ[face]);
      const carried = lamp ? lamp / (1 + (t / 7) * (t / 7)) : 0;
      bright = (0.16 + 0.84 * Math.max(lit, carried)) * (crossU >= 0 ? 0.9 : FACE_SHADE[face]);
    }
    CR = r * bright; CG = g * bright; CB = b * bright;
    return true;
  };

  for (let py = from; py < to; py++) {
    const vy = (1 - (2 * (py + 0.5)) / height) * cam.tanY;
    for (let px = 0; px < width; px++) {
      const vx = ((2 * (px + 0.5)) / width - 1) * cam.tanX;
      let dx = f0 + r0 * vx + u0 * vy, dy = f1 + r1 * vx + u1 * vy, dz = f2 + r2 * vx + u2 * vy;
      const inv = 1 / Math.sqrt(dx * dx + dy * dy + dz * dz);
      dx *= inv; dy *= inv; dz *= inv;
      let x = Math.floor(ex), y = Math.floor(ey), z = Math.floor(ez);
      const stepX = dx > 0 ? 1 : -1, stepY = dy > 0 ? 1 : -1, stepZ = dz > 0 ? 1 : -1;
      const tDeltaX = dx !== 0 ? Math.abs(1 / dx) : Infinity, tDeltaY = dy !== 0 ? Math.abs(1 / dy) : Infinity, tDeltaZ = dz !== 0 ? Math.abs(1 / dz) : Infinity;
      let tMaxX = dx !== 0 ? (dx > 0 ? x + 1 - ex : ex - x) * tDeltaX : Infinity;
      let tMaxY = dy !== 0 ? (dy > 0 ? y + 1 - ey : ey - y) * tDeltaY : Infinity;
      let tMaxZ = dz !== 0 ? (dz > 0 ? z + 1 - ez : ez - z) * tDeltaZ : Infinity;
      let t = 0, face = -1, hit = false, hitId = 0, hitT = Infinity;
      let inWater = false, waterFrom = 0, firstWater = -1, wet = 0, surface = false, SR = 0, SG = 0, SB = 0;

      while (t < far) {
        const gx = x - x0, gy = y - y0, gz = z - z0;
        if (gx < 0 || gy < 0 || gz < 0 || gx >= sx || gy >= sy || gz >= sz) break;
        const id = ids[gx + sx * (gz + sz * gy)];
        const k = kind[id];
        const next = tMaxX < tMaxY ? (tMaxX < tMaxZ ? tMaxX : tMaxZ) : (tMaxY < tMaxZ ? tMaxY : tMaxZ);
        if (k === 5) {
          if (!inWater) {
            inWater = true; waterFrom = t;
            if (firstWater < 0) firstWater = t;
            if (!surface && face === 1 && waterIndex !== NO_TEXTURE && tex) {
              texel(tex, waterIndex, ex + dx * t - x, ez + dz * t - z);
              surface = true; SR = (TR * waterTint[0]) / 255; SG = (TG * waterTint[1]) / 255; SB = (TB * waterTint[2]) / 255;
            }
          }
        } else {
          if (inWater) { inWater = false; wet += t - waterFrom; }
          if (k === 1 || k === 2 || k === 6) {
            // A whole block. The one the eye itself is in is looked out of, not at.
            if (face >= 0 && paint(id, face, t, x, y, z, dx, dy, dz, -1)) { hit = true; hitId = id; hitT = t; break; }
          } else if (k === 3) {
            const list = boxes.get(id);
            let best = Infinity, bestFace = -1;
            for (let i = 0; list && i < list.length; i += 6) {
              let near = -Infinity, away = Infinity, nearFace = -1, miss = false;
              for (let axis = 0; axis < 3 && !miss; axis++) {
                const o = axis === 0 ? ex : axis === 1 ? ey : ez, d = axis === 0 ? dx : axis === 1 ? dy : dz, c = axis === 0 ? x : axis === 1 ? y : z;
                const lo = c + list[i + axis], hi = c + Math.min(1, list[i + axis + 3]);
                if (d === 0) { if (o < lo || o > hi) miss = true; continue; }
                const a = (lo - o) / d, b = (hi - o) / d;
                const first = a < b ? a : b, second = a < b ? b : a;
                if (first > near) { near = first; nearFace = axis === 0 ? (d > 0 ? 4 : 5) : axis === 1 ? (d > 0 ? 0 : 1) : (d > 0 ? 2 : 3); }
                if (second < away) away = second;
              }
              if (!miss && near <= away && near > 0.02 && near < best) { best = near; bestFace = nearFace; }
            }
            if (bestFace >= 0 && best < far && paint(id, bestFace, best, x, y, z, dx, dy, dz, -1)) { hit = true; hitId = id; hitT = best; break; }
          } else if (k === 4) {
            // A plant: two flat sheets crossing in the middle of the block. The nearer one first;
            // where its texture is clear, the further one.
            const ox = ex - x, oz = ez - z;
            let a = Infinity, ua = 0, b = Infinity, ub = 0;
            if (dx !== dz) {
              const at = (oz - ox) / (dx - dz), lx = ox + dx * at, ly = ey + dy * at - y;
              if (at > 0.02 && lx >= 0 && lx <= 1 && ly >= 0 && ly <= 1) { a = at; ua = lx; }
            }
            if (dx !== -dz) {
              const at = (1 - ox - oz) / (dx + dz), lx = ox + dx * at, ly = ey + dy * at - y;
              if (at > 0.02 && lx >= 0 && lx <= 1 && ly >= 0 && ly <= 1) { b = at; ub = lx; }
            }
            const t1 = a < b ? a : b, u1 = a < b ? ua : ub, t2 = a < b ? b : a, u2 = a < b ? ub : ua;
            if (t1 < Infinity && paint(id, 3, t1, x, y, z, dx, dy, dz, u1)) { hit = true; hitId = id; hitT = t1; break; }
            if (t2 < Infinity && paint(id, 3, t2, x, y, z, dx, dy, dz, u2)) { hit = true; hitId = id; hitT = t2; break; }
          } else if (k === 7 && dy !== 0) {
            // Something that lies flat on the block below: a rail, a layer of snow.
            const at = (y + 0.0625 - ey) / dy, lx = ex + dx * at - x, lz = ez + dz * at - z;
            if (at > 0.02 && lx >= 0 && lx <= 1 && lz >= 0 && lz <= 1 && paint(id, 1, at, x, y, z, dx, dy, dz, -1)) { hit = true; hitId = id; hitT = at; break; }
          }
        }
        t = next;
        if (tMaxX < tMaxY) {
          if (tMaxX < tMaxZ) { tMaxX += tDeltaX; x += stepX; face = stepX > 0 ? 4 : 5; } else { tMaxZ += tDeltaZ; z += stepZ; face = stepZ > 0 ? 2 : 3; }
        } else if (tMaxY < tMaxZ) { tMaxY += tDeltaY; y += stepY; face = stepY > 0 ? 0 : 1; } else { tMaxZ += tDeltaZ; z += stepZ; face = stepZ > 0 ? 2 : 3; }
      }

      const p = py * width + px;
      let r, g, b;
      if (hit) {
        r = CR; g = CG; b = CB;
        depth[p] = hitT;
        what[p] = hitId;
      } else {
        // Sky: paler toward the horizon, with the sun or the moon where it stands.
        const k = dy > 0 ? Math.pow(dy, 0.55) : 0;
        r = sky.horizon[0] + (sky.top[0] - sky.horizon[0]) * k; g = sky.horizon[1] + (sky.top[1] - sky.horizon[1]) * k; b = sky.horizon[2] + (sky.top[2] - sky.horizon[2]) * k;
        if (sky.sun) {
          const toSun = dx * sky.sun[0] + dy * sky.sun[1] + dz * sky.sun[2];
          if (toSun > 0.9972) { r = 255; g = 244; b = 196; } else if (toSun < -0.998) { r = 222; g = 226; b = 236; }
        }
      }
      if (inWater) wet += Math.min(hitT, far) - waterFrom;
      if (hit && hitT > fogFrom) {
        const fog = Math.min(1, (hitT - fogFrom) / (far - fogFrom));
        r += (sky.horizon[0] - r) * fog; g += (sky.horizon[1] - g) * fog; b += (sky.horizon[2] - b) * fog;
      }
      if (wet > 0 || surface) {
        // Looked at through water: bluer and dimmer the more of it there is.
        const deep = Math.min(0.92, Math.max(surface ? 0.4 : 0.25, 1 - Math.exp(-0.2 * wet)));
        const body = 0.25 + 0.75 * (sky.day ?? 1);
        r += (waterTint[0] * 0.45 * body - r) * deep; g += (waterTint[1] * 0.55 * body - g) * deep; b += (waterTint[2] * 0.75 * body - b) * deep;
        if (surface) { r += (SR * body - r) * 0.3; g += (SG * body - g) * 0.3; b += (SB * body - b) * 0.3; }
        // Water first met away from the eye is what is seen there, whatever lies under it.
        if (firstWater > 0) wetAt[p] = firstWater;
      }
      rgb[p * 3] = r > 255 ? 255 : r; rgb[p * 3 + 1] = g > 255 ? 255 : g; rgb[p * 3 + 2] = b > 255 ? 255 : b;
    }
  }
}

// Creatures, players and dropped things, as boxes of their own size and colour, over the
// world already drawn. entities: [{ x, y, z (feet), w, h, colour, head, label }]. Gives back how
// many dots of each were drawn, and where its label goes.
export function drawEntities(s, entities) {
  const { width, height, rgb, depth, who, cam, far, light } = s;
  const lamp = s.lamp ?? 0;
  const [ex, ey, ez] = s.eye;
  const seen = [];
  for (let n = 0; n < entities.length && n < 254; n++) {
    const e = entities[n];
    const lo = [e.x - e.w / 2, e.y, e.z - e.w / 2], hi = [e.x + e.w / 2, e.y + e.h, e.z + e.w / 2];
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, behind = 0;
    for (let corner = 0; corner < 8; corner++) {
      const at = project(cam, s.eye, [corner & 1 ? hi[0] : lo[0], corner & 2 ? hi[1] : lo[1], corner & 4 ? hi[2] : lo[2]]);
      if (!at) { behind++; continue; }
      if (at.x < minX) minX = at.x; if (at.x > maxX) maxX = at.x; if (at.y < minY) minY = at.y; if (at.y > maxY) maxY = at.y;
    }
    seen.push({ dots: 0, x: 0, y: Infinity, distance: Math.hypot(e.x - ex, e.y + e.h / 2 - ey, e.z - ez) });
    if (behind === 8) continue;
    if (behind > 0) { minX = 0; maxX = width - 1; minY = 0; maxY = height - 1; }     // it stands across the eye's own plane
    const xa = Math.max(0, Math.floor(minX)), xb = Math.min(width - 1, Math.ceil(maxX)), ya = Math.max(0, Math.floor(minY)), yb = Math.min(height - 1, Math.ceil(maxY));
    const lit = light ? light(Math.floor(e.x), Math.floor(e.y + e.h / 2), Math.floor(e.z)) : 1;
    let sumX = 0;
    for (let py = ya; py <= yb; py++) {
      const vy = (1 - (2 * (py + 0.5)) / height) * cam.tanY;
      for (let px = xa; px <= xb; px++) {
        const vx = ((2 * (px + 0.5)) / width - 1) * cam.tanX;
        let dx = cam.f[0] + cam.r[0] * vx + cam.u[0] * vy, dy = cam.f[1] + cam.r[1] * vx + cam.u[1] * vy, dz = cam.f[2] + cam.r[2] * vx + cam.u[2] * vy;
        const inv = 1 / Math.sqrt(dx * dx + dy * dy + dz * dz);
        dx *= inv; dy *= inv; dz *= inv;
        let near = -Infinity, away = Infinity, face = -1, miss = false;
        for (let axis = 0; axis < 3 && !miss; axis++) {
          const o = axis === 0 ? ex : axis === 1 ? ey : ez, d = axis === 0 ? dx : axis === 1 ? dy : dz;
          if (d === 0) { if (o < lo[axis] || o > hi[axis]) miss = true; continue; }
          const a = (lo[axis] - o) / d, b = (hi[axis] - o) / d;
          const first = a < b ? a : b, second = a < b ? b : a;
          if (first > near) { near = first; face = axis === 0 ? (d > 0 ? 4 : 5) : axis === 1 ? (d > 0 ? 0 : 1) : (d > 0 ? 2 : 3); }
          if (second < away) away = second;
        }
        const p = py * width + px;
        if (miss || near > away || near < 0.2 || near >= far || near >= depth[p]) continue;
        const high = (ey + dy * near - e.y) / e.h;
        const colour = e.head && high > 0.74 ? e.head : e.colour;
        const carried = lamp ? lamp / (1 + (near / 7) * (near / 7)) : 0;
        const bright = (0.2 + 0.8 * Math.max(lit, carried)) * FACE_SHADE[face];
        rgb[p * 3] = colour[0] * bright; rgb[p * 3 + 1] = colour[1] * bright; rgb[p * 3 + 2] = colour[2] * bright;
        depth[p] = near; who[p] = n + 1;
        seen[n].dots += 1; sumX += px;
        if (py < seen[n].y) seen[n].y = py;
      }
    }
    if (seen[n].dots) seen[n].x = sumX / seen[n].dots;
  }
  return seen;
}

// A 5 by 7 letter for each character the pictures are written on with. Rows from the top,
// the leftmost dot the highest bit.
const GLYPHS = {
  A: [14, 17, 17, 31, 17, 17, 17], B: [30, 17, 17, 30, 17, 17, 30], C: [14, 17, 16, 16, 16, 17, 14], D: [30, 17, 17, 17, 17, 17, 30],
  E: [31, 16, 16, 30, 16, 16, 31], F: [31, 16, 16, 30, 16, 16, 16], G: [14, 17, 16, 23, 17, 17, 15], H: [17, 17, 17, 31, 17, 17, 17],
  I: [14, 4, 4, 4, 4, 4, 14], J: [7, 2, 2, 2, 2, 18, 12], K: [17, 18, 20, 24, 20, 18, 17], L: [16, 16, 16, 16, 16, 16, 31],
  M: [17, 27, 21, 21, 17, 17, 17], N: [17, 25, 21, 19, 17, 17, 17], O: [14, 17, 17, 17, 17, 17, 14], P: [30, 17, 17, 30, 16, 16, 16],
  Q: [14, 17, 17, 17, 21, 18, 13], R: [30, 17, 17, 30, 20, 18, 17], S: [15, 16, 16, 14, 1, 1, 30], T: [31, 4, 4, 4, 4, 4, 4],
  U: [17, 17, 17, 17, 17, 17, 14], V: [17, 17, 17, 17, 17, 10, 4], W: [17, 17, 17, 21, 21, 21, 10], X: [17, 17, 10, 4, 10, 17, 17],
  Y: [17, 17, 10, 4, 4, 4, 4], Z: [31, 1, 2, 4, 8, 16, 31],
  0: [14, 17, 19, 21, 25, 17, 14], 1: [4, 12, 4, 4, 4, 4, 14], 2: [14, 17, 1, 2, 4, 8, 31], 3: [31, 2, 4, 2, 1, 17, 14],
  4: [2, 6, 10, 18, 31, 2, 2], 5: [31, 16, 30, 1, 1, 17, 14], 6: [6, 8, 16, 30, 17, 17, 14], 7: [31, 1, 2, 4, 8, 8, 8],
  8: [14, 17, 17, 14, 17, 17, 14], 9: [14, 17, 17, 15, 1, 2, 12],
  ' ': [0, 0, 0, 0, 0, 0, 0], '.': [0, 0, 0, 0, 0, 12, 12], ',': [0, 0, 0, 0, 12, 4, 8], ':': [0, 12, 12, 0, 12, 12, 0],
  '-': [0, 0, 0, 31, 0, 0, 0], _: [0, 0, 0, 0, 0, 0, 31], '/': [1, 1, 2, 4, 8, 16, 16], '(': [2, 4, 8, 8, 8, 4, 2], ')': [8, 4, 2, 2, 2, 4, 8],
  '+': [0, 4, 4, 31, 4, 4, 0], '!': [4, 4, 4, 4, 4, 0, 4], '?': [14, 17, 1, 2, 4, 0, 4], "'": [4, 4, 8, 0, 0, 0, 0], '%': [24, 25, 2, 4, 8, 19, 3],
  '=': [0, 0, 31, 0, 31, 0, 0], '<': [2, 4, 8, 16, 8, 4, 2], '>': [8, 4, 2, 1, 2, 4, 8], '#': [10, 10, 31, 10, 31, 10, 10],
  '[': [14, 8, 8, 8, 8, 8, 14], ']': [14, 2, 2, 2, 2, 2, 14], '"': [10, 10, 10, 0, 0, 0, 0], '*': [0, 4, 21, 14, 21, 4, 0],
};

export const textWidth = (string, scale = 1) => String(string).length * 6 * scale;

// Writes on a picture. Letters are capitals; a dark edge keeps them readable on anything.
export function write(rgb, width, height, x, y, string, scale = 1, colour = [255, 255, 255]) {
  const dot = (px, py, c) => {
    if (px < 0 || py < 0 || px >= width || py >= height) return;
    const o = (py * width + px) * 3;
    rgb[o] = c[0]; rgb[o + 1] = c[1]; rgb[o + 2] = c[2];
  };
  const letters = String(string).toUpperCase();
  for (const [dark, shift] of [[true, scale], [false, 0]]) {
    for (let i = 0; i < letters.length; i++) {
      const glyph = GLYPHS[letters[i]] ?? GLYPHS['?'];
      for (let row = 0; row < 7; row++) for (let col = 0; col < 5; col++) {
        if (!(glyph[row] & (16 >> col))) continue;
        for (let a = 0; a < scale; a++) for (let b = 0; b < scale; b++) {
          dot(Math.round(x) + (i * 6 + col) * scale + a + shift, Math.round(y) + row * scale + b + shift, dark ? [0, 0, 0] : colour);
        }
      }
    }
  }
}

// Darkens a rectangle of a picture, as a ground for writing on.
export function shade(rgb, width, height, x, y, w, h, amount = 0.55) {
  for (let py = Math.max(0, Math.round(y)); py < Math.min(height, Math.round(y + h)); py++) {
    for (let px = Math.max(0, Math.round(x)); px < Math.min(width, Math.round(x + w)); px++) {
      const o = (py * width + px) * 3;
      rgb[o] *= 1 - amount; rgb[o + 1] *= 1 - amount; rgb[o + 2] *= 1 - amount;
    }
  }
}

// One picture set into a larger one.
export function paste(into, intoWidth, from, fromWidth, fromHeight, x, y) {
  for (let row = 0; row < fromHeight; row++) {
    into.set(from.subarray(row * fromWidth * 3, (row + 1) * fromWidth * 3), ((y + row) * intoWidth + x) * 3);
  }
}

// What is in a drawn picture, in numbers: how much of it each block fills, what is under the
// middle of it, and the nearest of each thing worth a remark. nameOf turns a block state into its name.
const WORTH_A_REMARK = /_ore$|^lava$|^water$|chest$|_bed$|^crafting_table$|furnace$|_door$|torch$|^ladder$|^spawner$|^obsidian$|^farmland$|^wheat$|^cobweb$|^magma_block$|^fire$|_sign$|^bell$|^composter$|^barrel$/;
export function describe(s, nameOf) {
  const { width, height, what, who, depth, wetAt } = s;
  const water = s.waterState ?? 0;
  const counts = new Map();
  const remarks = new Map();
  let sky = 0, total = 0;
  for (let py = 0; py < height; py += 2) for (let px = 0; px < width; px += 2) {
    const p = py * width + px;
    total += 1;
    if (who[p]) continue;
    const wet = water && wetAt[p] > 0;
    if (!what[p] && !wet) { sky += 1; continue; }
    const name = nameOf(wet ? water : what[p]);
    const distance = wet ? wetAt[p] : depth[p];
    counts.set(name, (counts.get(name) ?? 0) + 1);
    if (WORTH_A_REMARK.test(name)) {
      const r = remarks.get(name) ?? { name, distance: Infinity, x: 0, y: 0, dots: 0 };
      r.dots += 1; r.x += px; r.y += py;
      if (distance < r.distance) r.distance = distance;
      remarks.set(name, r);
    }
  }
  const side = (x) => (x < width * 0.36 ? 'left' : x > width * 0.64 ? 'right' : 'ahead');
  const level = (y) => (y < height * 0.36 ? 'above' : y > height * 0.64 ? 'below' : 'level');
  const centre = Math.floor(height / 2) * width + Math.floor(width / 2);
  return {
    fills: [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([name, n]) => ({ name, share: +(n / total).toFixed(3) })),
    sky: +(sky / total).toFixed(3),
    ahead: who[centre] ? { entity: who[centre] - 1, distance: +depth[centre].toFixed(1) }
      : what[centre] ? { block: nameOf(what[centre]), distance: +depth[centre].toFixed(1) } : { block: null, distance: null },
    remarks: [...remarks.values()].filter((r) => r.dots >= 2).sort((a, b) => a.distance - b.distance)
      .map((r) => ({ name: r.name, distance: +r.distance.toFixed(1), side: side(r.x / r.dots), level: level(r.y / r.dots) })),
  };
}

// A PNG file of a picture (8 bits each of red, green and blue).
export function encodePng(rgb, width, height) {
  const stride = width * 3 + 1;
  const raw = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) raw.set(rgb.subarray(y * width * 3, (y + 1) * width * 3), y * stride + 1);
  const chunk = (type, data) => {
    const out = Buffer.alloc(12 + data.length);
    out.writeUInt32BE(data.length, 0);
    out.write(type, 4, 'latin1');
    data.copy(out, 8);
    out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
    return out;
  };
  const head = Buffer.alloc(13);
  head.writeUInt32BE(width, 0);
  head.writeUInt32BE(height, 4);
  head[8] = 8; head[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', head), chunk('IDAT', deflateSync(raw, { level: 6 })), chunk('IEND', Buffer.alloc(0))]);
}

// A PNG file read back: { width, height, rgba }. Every kind the game's own textures come in.
export function decodePng(buffer) {
  let at = 8, width = 0, height = 0, bits = 8, type = 6, interlace = 0, palette = null, clear = null;
  const data = [];
  while (at < buffer.length) {
    const length = buffer.readUInt32BE(at);
    const name = buffer.toString('latin1', at + 4, at + 8);
    const body = buffer.subarray(at + 8, at + 8 + length);
    if (name === 'IHDR') { width = body.readUInt32BE(0); height = body.readUInt32BE(4); bits = body[8]; type = body[9]; interlace = body[12]; }
    else if (name === 'PLTE') palette = body;
    else if (name === 'tRNS') clear = body;
    else if (name === 'IDAT') data.push(body);
    else if (name === 'IEND') break;
    at += 12 + length;
  }
  if (interlace) throw new Error('an interlaced PNG is not read');
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[type];
  if (!channels) throw new Error(`PNG colour type ${type} is not read`);
  const step = Math.max(1, (channels * bits) >> 3);
  const stride = Math.ceil((width * channels * bits) / 8);
  const raw = inflateSync(Buffer.concat(data));
  const pixels = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    for (let x = 0; x < stride; x++) {
      const a = x >= step ? pixels[y * stride + x - step] : 0;
      const b = y > 0 ? pixels[(y - 1) * stride + x] : 0;
      const c = x >= step && y > 0 ? pixels[(y - 1) * stride + x - step] : 0;
      let value = raw[y * (stride + 1) + 1 + x];
      if (filter === 1) value += a;
      else if (filter === 2) value += b;
      else if (filter === 3) value += (a + b) >> 1;
      else if (filter === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); value += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      pixels[y * stride + x] = value & 255;
    }
  }
  // One sample of a row: scaled to 0..255, except a palette's, which is a place in the palette.
  const sample = (y, i) => {
    if (bits === 8) return pixels[y * stride + i];
    if (bits === 16) return pixels[y * stride + i * 2];
    const bit = i * bits;
    const value = (pixels[y * stride + (bit >> 3)] >> (8 - bits - (bit & 7))) & ((1 << bits) - 1);
    return type === 3 ? value : Math.round((value * 255) / ((1 << bits) - 1));
  };
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const o = (y * width + x) * 4;
    if (type === 6) { rgba[o] = sample(y, x * 4); rgba[o + 1] = sample(y, x * 4 + 1); rgba[o + 2] = sample(y, x * 4 + 2); rgba[o + 3] = sample(y, x * 4 + 3); }
    else if (type === 2) {
      rgba[o] = sample(y, x * 3); rgba[o + 1] = sample(y, x * 3 + 1); rgba[o + 2] = sample(y, x * 3 + 2);
      rgba[o + 3] = clear && rgba[o] === clear[1] && rgba[o + 1] === clear[3] && rgba[o + 2] === clear[5] ? 0 : 255;
    } else if (type === 0) { const grey = sample(y, x); rgba[o] = rgba[o + 1] = rgba[o + 2] = grey; rgba[o + 3] = clear && bits === 8 && grey === clear[1] ? 0 : 255; }
    else if (type === 4) { const grey = sample(y, x * 2); rgba[o] = rgba[o + 1] = rgba[o + 2] = grey; rgba[o + 3] = sample(y, x * 2 + 1); }
    else { const i = sample(y, x); rgba[o] = palette[i * 3]; rgba[o + 1] = palette[i * 3 + 1]; rgba[o + 2] = palette[i * 3 + 2]; rgba[o + 3] = clear && i < clear.length ? clear[i] : 255; }
  }
  return { width, height, rgba };
}
