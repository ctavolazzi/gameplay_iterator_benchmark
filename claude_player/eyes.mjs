// The player's eyes. look() draws what the player would see from where it stands, from the
// blocks and creatures the server has sent it, and saves it as a PNG under
// data/claude_player/sight/. It also says what is in the picture in words and numbers, so that
// a program (or a chat line) can use what was seen without opening the picture.
//
// It is drawn in this process by sight.mjs: no game client is opened and nothing is sent to
// the server, so a look can be taken at any moment, in the middle of a skill too. The head is
// turned for the other players to see only when the player is idle and asked to look at something.
//
// With the texture cache (node claude_player/textures.mjs, once) blocks are drawn with the
// game's own textures; without it, in flat colours.

import { existsSync, mkdirSync, readdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const HERE = new URL('./', import.meta.url);
const OUT = fileURLToPath(new URL('../data/claude_player/sight/', import.meta.url));
const KEPT = 40;                                   // pictures kept; the disk here is nearly full
const fresh = (file) => {
  const url = new URL(file, HERE);
  return import(`${url.href}?v=${statSync(url).mtimeMs}`);
};
const pause = () => new Promise((resolve) => setImmediate(resolve));
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const plain = (name) => String(name).replace(/_/g, ' ');

// Body and head colours of what walks about. Anything else: red if it attacks, sand if not.
const BODIES = {
  player: [[60, 120, 200], [214, 164, 120]], zombie: [[60, 100, 150], [86, 140, 76]], husk: [[150, 130, 90], [170, 150, 100]], drowned: [[50, 110, 110], [90, 170, 150]],
  zombie_villager: [[110, 80, 60], [86, 140, 76]], skeleton: [[196, 196, 196], [220, 220, 220]], stray: [[150, 170, 175], [200, 215, 220]], bogged: [[120, 140, 100], [170, 180, 150]],
  creeper: [[70, 170, 60], [90, 200, 80]], spider: [[52, 44, 40], [120, 20, 20]], cave_spider: [[20, 60, 80], [120, 20, 20]], enderman: [[22, 14, 30], [40, 20, 60]],
  witch: [[80, 40, 110], [200, 170, 150]], slime: [[110, 200, 90], null], phantom: [[70, 80, 150], null], pillager: [[90, 90, 100], [150, 160, 160]],
  cow: [[80, 56, 40], [220, 215, 205]], pig: [[236, 164, 164], [240, 180, 180]], sheep: [[232, 232, 226], [200, 170, 150]], chicken: [[246, 246, 246], [220, 60, 50]],
  horse: [[130, 92, 56], null], donkey: [[120, 104, 90], null], villager: [[120, 80, 60], [200, 160, 130]], iron_golem: [[200, 196, 188], null], wolf: [[214, 210, 206], null],
  cat: [[230, 170, 90], null], fox: [[226, 130, 50], null], rabbit: [[180, 150, 110], null], bat: [[60, 46, 36], null], squid: [[44, 66, 100], null],
  salmon: [[170, 70, 70], null], cod: [[170, 150, 110], null], bee: [[236, 196, 60], null], item: [[250, 216, 80], null], experience_orb: [[160, 250, 70], null], arrow: [[210, 210, 210], null],
};

let BlockOf = null;
const shapesOf = new Map();
let cache = null, cacheStamp = 0;

// The texture cache, read again only when it has been rebuilt.
async function textureCache() {
  const textures = await fresh('./textures.mjs');
  const index = join(textures.CACHE, 'index.json');
  if (!existsSync(index)) return null;
  const stamp = statSync(index).mtimeMs;
  if (stamp !== cacheStamp) { cache = { ...textures.load(), tints: textures.TINTS }; cacheStamp = stamp; }
  return cache;
}

// The block states in a box of `far` blocks round the eye, in the order sight.mjs reads them.
async function gridAround(bot, eye, far) {
  const reach = Math.ceil(far);
  const x0 = Math.floor(eye[0]) - reach, z0 = Math.floor(eye[2]) - reach;
  const lowest = bot.game?.minY ?? -64, highest = lowest + (bot.game?.height ?? 384) - 1;
  const y0 = Math.max(lowest, Math.floor(eye[1]) - reach), y1 = Math.min(highest, Math.floor(eye[1]) + reach);
  const sx = 2 * reach + 1, sz = sx, sy = Math.max(1, y1 - y0 + 1);
  const ids = new Uint16Array(sx * sy * sz);
  const pos = { x: 0, y: 0, z: 0 };
  let missing = 0, last = Date.now();
  for (let cx = x0 >> 4; cx <= (x0 + sx - 1) >> 4; cx++) {
    for (let cz = z0 >> 4; cz <= (z0 + sz - 1) >> 4; cz++) {
      const column = bot.world.getColumn(cx, cz);
      if (!column) { missing += 1; continue; }
      for (let lx = 0; lx < 16; lx++) {
        const gx = cx * 16 + lx - x0;
        if (gx < 0 || gx >= sx) continue;
        for (let lz = 0; lz < 16; lz++) {
          const gz = cz * 16 + lz - z0;
          if (gz < 0 || gz >= sz) continue;
          pos.x = lx; pos.z = lz;
          for (let y = y0; y <= y1; y++) { pos.y = y; ids[gx + sx * (gz + sz * (y - y0))] = column.getBlockStateId(pos); }
        }
      }
      // The reflexes run in this same process: let them in every few columns.
      if (Date.now() - last > 20) { await pause(); last = Date.now(); }
    }
  }
  return { ids, x0, y0, z0, sx, sy, sz, missing };
}

// How each block state in the box is drawn. With the cache this is its tables; without, the
// states that are there are worked out from the game's own shapes and given a flat colour.
function cellsFor(bot, grid, textures, sight) {
  BlockOf ??= require('prismarine-block')(bot.registry);
  const present = new Set(grid.ids);
  const boxes = new Map();
  const count = textures?.index.states ?? Math.max(...Object.keys(bot.registry.blocksByStateId).map(Number)) + 1;
  const cells = textures
    ? { kind: textures.kind, faces: textures.faces, tintOf: textures.tintOf, tintMask: textures.tintMask, emit: textures.emit, flat: textures.flat, boxes }
    : { kind: new Uint8Array(count), faces: new Uint16Array(count * 6).fill(0xffff), tintOf: new Uint8Array(count), tintMask: new Uint8Array(count), emit: new Uint8Array(count), flat: new Uint8Array(count * 3), boxes };
  for (const id of present) {
    if (id >= count) continue;
    if (!shapesOf.has(id)) shapesOf.set(id, new Float32Array((BlockOf.fromStateId(id, 0).shapes ?? []).flat()));
    const shapes = shapesOf.get(id);
    if (!textures) {
      const name = bot.registry.blocksByStateId[id]?.name ?? 'air';
      const whole = shapes.length === 6 && shapes.every((v, i) => v === (i < 3 ? 0 : 1));
      cells.kind[id] = /^(air|cave_air|void_air)$/.test(name) ? sight.KIND.AIR : name === 'water' ? sight.KIND.WATER : name === 'lava' ? sight.KIND.LAVA
        : whole ? sight.KIND.CUBE : shapes.length ? sight.KIND.SHAPED : sight.KIND.CROSS;
      cells.flat.set(flatColour(name), id * 3);
      cells.emit[id] = name === 'lava' || /torch|fire|glowstone/.test(name) ? 1 : 0;
    }
    if (cells.kind[id] === sight.KIND.SHAPED) boxes.set(id, shapes);
  }
  return cells;
}

// A colour for a block by its name, for when the game's textures have not been read.
const FLAT = [[/^grass_block$|leaves$|^short_grass$|^tall_grass$|^fern|vine|^moss/, [86, 150, 62]], [/^water$/, [50, 100, 210]], [/^lava$|^fire$/, [230, 110, 30]],
  [/diamond/, [90, 220, 215]], [/emerald/, [40, 200, 90]], [/redstone/, [200, 40, 40]], [/lapis/, [40, 70, 190]], [/gold/, [240, 205, 70]], [/copper/, [200, 120, 80]],
  [/iron/, [214, 180, 150]], [/coal/, [44, 44, 44]], [/deepslate|tuff|basalt|blackstone|bedrock/, [72, 72, 76]], [/dirt|farmland|mud|podzol|path/, [128, 92, 62]],
  [/sand$|sandstone|birch/, [216, 204, 156]], [/gravel|andesite|stone|cobble/, [124, 124, 124]], [/log|wood|planks|chest|table|door|fence|sign|barrel|ladder/, [156, 122, 74]],
  [/snow|quartz|wool|bed|diorite|calcite/, [232, 232, 232]], [/granite|terracotta|brick/, [150, 100, 84]], [/glass|ice/, [170, 210, 235]], [/obsidian/, [26, 18, 40]]];
function flatColour(name) {
  for (const [pattern, colour] of FLAT) if (pattern.test(name)) return colour;
  let hash = 0;
  for (const letter of name) hash = (hash * 31 + letter.charCodeAt(0)) >>> 0;
  return [110 + (hash & 63), 100 + ((hash >> 6) & 63), 100 + ((hash >> 12) & 63)];
}

// How bright a place is, from the light the server sent: the brighter of what burns nearby
// and what comes down from the sky at this hour. Looked up once for each place.
function lightIn(bot, grid, daylight) {
  const known = new Uint8Array(grid.ids.length).fill(255);
  const curve = Float32Array.from({ length: 16 }, (_, level) => (level / 15) / (4 - (3 * level) / 15));
  const pos = { x: 0, y: 0, z: 0 };
  let column = null, columnX = NaN, columnZ = NaN;
  return (x, y, z) => {
    const gx = x - grid.x0, gy = y - grid.y0, gz = z - grid.z0;
    if (gx < 0 || gy < 0 || gz < 0 || gx >= grid.sx || gy >= grid.sy || gz >= grid.sz) return daylight;
    const i = gx + grid.sx * (gz + grid.sz * gy);
    let level = known[i];
    if (level === 255) {
      if ((x >> 4) !== columnX || (z >> 4) !== columnZ) { columnX = x >> 4; columnZ = z >> 4; column = bot.world.getColumn(columnX, columnZ); }
      if (!column) level = 0;
      else { pos.x = x & 15; pos.y = y; pos.z = z & 15; level = Math.max(column.getBlockLight(pos) ?? 0, Math.round((column.getSkyLight(pos) ?? 0) * daylight)); }
      known[i] = level;
    }
    return curve[level];
  };
}

// Everything that moves within reach of the eye, nearest first, as sight.mjs draws it.
function creatures(bot, eye, far, isHostile) {
  const out = [];
  for (const e of Object.values(bot.entities)) {
    if (e === bot.entity || !e.position) continue;
    const distance = Math.hypot(e.position.x - eye[0], e.position.y - eye[1], e.position.z - eye[2]);
    if (distance > far) continue;
    const kind = e.type === 'player' ? 'player' : (e.name ?? 'thing');
    const thing = kind === 'item' || kind === 'experience_orb' || kind === 'arrow';
    const hostile = !!isHostile?.(e);
    const [colour, head] = BODIES[kind] ?? [hostile ? [200, 56, 56] : [200, 180, 150], null];
    const name = e.username ?? (kind === 'item' ? (e.getDroppedItem?.()?.name ?? 'item') : kind);
    out.push({ x: e.position.x, y: e.position.y, z: e.position.z, w: thing ? 0.3 : (e.width || 0.6), h: thing ? 0.3 : (e.height || 1.8),
      colour, head, name, kind, hostile, thing, distance });
  }
  return out.sort((a, b) => a.distance - b.distance).slice(0, 200);
}

// Where to look for a thing asked for by name: a compass point, a player, a creature, a block.
function aim(bot, eye, at, sight) {
  const now = { yaw: bot.entity.yaw, pitch: bot.entity.pitch };
  if (at == null || at === '') return now;
  if (typeof at === 'object') {
    const whole = [at.x, at.y, at.z].every(Number.isInteger);
    return { ...sight.aimAt(eye, [at.x + (whole ? 0.5 : 0), at.y + (whole ? 0.5 : 0), at.z + (whole ? 0.5 : 0)]), target: `${at.x} ${at.y} ${at.z}` };
  }
  const word = String(at).toLowerCase().trim();
  const compass = { north: 0, east: -Math.PI / 2, south: Math.PI, west: Math.PI / 2 };
  if (word in compass) return { yaw: compass[word], pitch: -0.12, target: word };
  if (word === 'up') return { yaw: now.yaw, pitch: 1.35, target: word };
  if (word === 'down') return { yaw: now.yaw, pitch: -1.35, target: word };
  if (word === 'behind') return { yaw: now.yaw + Math.PI, pitch: -0.12, target: word };
  if (word === 'left') return { yaw: now.yaw + Math.PI / 2, pitch: -0.12, target: word };
  if (word === 'right') return { yaw: now.yaw - Math.PI / 2, pitch: -0.12, target: word };
  const who = Object.values(bot.entities).filter((e) => e !== bot.entity && e.position
    && (e.username ?? e.name ?? '').toLowerCase().replace(/ /g, '_').includes(word))
    .sort((a, b) => a.position.distanceTo(bot.entity.position) - b.position.distanceTo(bot.entity.position))[0];
  if (who) return { ...sight.aimAt(eye, [who.position.x, who.position.y + (who.height || 1.8) * 0.6, who.position.z]), target: who.username ?? who.name };
  const ids = Object.values(bot.registry.blocksByName).filter((b) => b.name === word || b.name.includes(word)).map((b) => b.id);
  const block = ids.length ? bot.findBlock({ matching: ids, maxDistance: 48 }) : null;
  if (block) return { ...sight.aimAt(eye, [block.position.x + 0.5, block.position.y + 0.5, block.position.z + 0.5]), target: `${block.name} at ${block.position.x} ${block.position.y} ${block.position.z}` };
  return { ...now, missed: `nothing called ${plain(word)} within 48 blocks` };
}

// What a chat line asks to be looked at: { around }, { at }, or nothing for "what do you see".
export function askedFor(text, username) {
  const t = String(text).toLowerCase();
  if (/\b(look(ing)? around|all around|panorama)\b/.test(t)) return { around: true };
  const way = /\b(north|south|east|west|up|down|behind|left|right)\b/.exec(t)?.[1];
  if (way) return { at: way };
  if (/\b(at me|look here|over here)\b/.test(t)) return { at: username };
  const thing = /\b(?:look at|picture of|photo of|screenshot of|show me)\s+(?:the |a |an |that |your |my )?([a-z_ ]{3,30}?)\s*(?:[?.!,]|$)/.exec(t)?.[1]?.trim();
  if (thing && !/^(what|you|see|me|it|that|this|around)$/.test(thing)) return { at: thing.replace(/ /g, '_') };
  return {};
}

// One view drawn: the picture, what is in it, and which creatures show.
async function draw(sight, base, view, creaturesNear, nameOf, write) {
  const s = sight.prepare({ ...base, yaw: view.yaw, pitch: view.pitch });
  for (let y = 0; y < s.height; y += 12) { sight.rows(s, y, Math.min(s.height, y + 12)); await pause(); }
  const drawn = sight.drawEntities(s, creaturesNear);
  const told = sight.describe(s, nameOf);
  const side = (x) => (x < s.width * 0.36 ? 'left' : x > s.width * 0.64 ? 'right' : 'ahead');
  const seen = [];
  const named = [];
  const scale = s.width >= 480 ? 2 : 1;
  drawn.forEach((d, i) => {
    const e = creaturesNear[i];
    if (d.dots < (e.thing ? 6 : 3)) return;
    seen.push({ name: e.name, kind: e.kind, hostile: e.hostile, distance: +e.distance.toFixed(1), side: side(d.x) });
    if (!write || e.thing || (!e.hostile && e.kind !== 'player' && e.distance > 24)) return;
    const label = `${e.name} ${Math.round(e.distance)}`;
    const wide = sight.textWidth(label, scale);
    const x = clamp(d.x - wide / 2, 2, s.width - wide - 2), y = Math.max(2, d.y - 9 * scale);
    if (named.length >= 8 || named.some((n) => x < n.x + n.wide && n.x < x + wide && Math.abs(n.y - y) < 9 * scale)) return;
    named.push({ x, y, wide });
    sight.write(s.rgb, s.width, s.height, x, y, label, scale, e.hostile ? [255, 120, 110] : [255, 255, 255]);
  });
  if (told.ahead.entity != null) told.ahead = { entity: creaturesNear[told.ahead.entity]?.name ?? 'something', distance: told.ahead.distance };
  return { s, told, seen };
}

const inWords = (told, seen, heading) => {
  const parts = [`Looking ${heading}.`];
  const fills = told.fills.slice(0, 3).map((f) => `${plain(f.name)} ${Math.round(f.share * 100)}%`);
  if (told.sky > 0.05) fills.push(`sky ${Math.round(told.sky * 100)}%`);
  if (fills.length) parts.push(`I see ${fills.join(', ')}.`);
  if (told.ahead.block) parts.push(`Ahead: ${plain(told.ahead.block)} at ${told.ahead.distance}.`);
  else if (told.ahead.entity) parts.push(`Ahead: ${told.ahead.entity} at ${told.ahead.distance}.`);
  const living = seen.filter((v) => v.kind !== 'item').slice(0, 4).map((v) => `${v.name} ${Math.round(v.distance)} ${v.side}`);
  if (living.length) parts.push(`In view: ${living.join('; ')}.`);
  const remarks = told.remarks.slice(0, 4).map((r) => `${plain(r.name)} ${Math.round(r.distance)} ${r.side}`);
  if (remarks.length) parts.push(`Also: ${remarks.join('; ')}.`);
  return parts.join(' ').slice(0, 220);
};

// Take a look. args: { at, around, yaw, pitch (degrees: 0 north, 90 east; up positive), width,
// height, far, fov, turn, tag, plain (no writing on the picture) }.
export async function look(ctx, args = {}) {
  const { bot } = ctx;
  if (!bot?.entity) throw new Error('the player is not in the world');
  const started = Date.now();
  const sight = await fresh('./sight.mjs');
  const status = typeof ctx.status === 'function' ? ctx.status() : (ctx.status ?? {});
  const width = clamp(Math.round(args.width ?? 640), 160, 960), height = clamp(Math.round(args.height ?? 360), 90, 540);
  const far = clamp(args.far ?? 64, 8, 96);
  const at = bot.entity.position;
  const eye = [at.x, at.y + (bot.entity.eyeHeight ?? 1.62), at.z];
  let view = aim(bot, eye, args.at, sight);
  if (Number.isFinite(args.yaw)) view = { ...view, yaw: (-args.yaw * Math.PI) / 180 };
  if (Number.isFinite(args.pitch)) view = { ...view, pitch: clamp((args.pitch * Math.PI) / 180, -1.5, 1.5) };
  // Idle and asked to look at a thing: the head turns, so the others in the world see it look.
  if (view.target && args.turn !== false && !status.doing) { try { await bot.look(view.yaw, view.pitch, true); } catch { /* the look is drawn all the same */ } }
  // The same question put to the game library's own ray, at this same moment: which block is
  // under the middle of the view. Only when the view is the head's own.
  let cursor;
  const turn = (a, b) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
  if (!args.around && turn(view.yaw, bot.entity.yaw) < 0.002 && turn(view.pitch, bot.entity.pitch) < 0.002) {
    try { cursor = bot.blockAtCursor(Math.min(far, 48))?.name ?? null; } catch { cursor = undefined; }
  }

  const textures = await textureCache();
  const grid = await gridAround(bot, eye, far);
  // plant: 'shift' draws the world one block out of place on purpose, to watch check go red.
  if (args.plant === 'shift') grid.x0 += 1;
  const cells = cellsFor(bot, grid, textures, sight);
  const hour = bot.time?.timeOfDay ?? 6000;
  const column = bot.world.getColumn(Math.floor(eye[0]) >> 4, Math.floor(eye[2]) >> 4);
  const local = { x: Math.floor(eye[0]) & 15, y: Math.floor(eye[1]), z: Math.floor(eye[2]) & 15 };
  const skyAtEye = column?.getSkyLight(local) ?? 15;
  // The server sends light with the world. If nowhere above or below the eye has any light
  // from the sky, it did not, and everything is drawn lit. (The very top of the world reads
  // dark even when it did: empty sections are not sent.)
  let lightSent = false;
  for (let y = (bot.game?.minY ?? -64) + (bot.game?.height ?? 384) - 1; column && y >= (bot.game?.minY ?? -64) && !lightSent; y -= 4) {
    lightSent = (column.getSkyLight({ x: local.x, y, z: local.z }) ?? 0) > 0;
  }
  // Under ground: no light from the sky at the eye, nor anywhere within 3 blocks round it or
  // over it. Under a tree or an overhang by open ground the sky is still there to be seen.
  let skyNear = skyAtEye;
  for (let dx = -3; dx <= 3 && lightSent && skyNear === 0; dx += 3) for (let dz = -3; dz <= 3 && skyNear === 0; dz += 3) for (const dy of [0, 3]) {
    const x = Math.floor(eye[0]) + dx, z = Math.floor(eye[2]) + dz;
    skyNear = Math.max(skyNear, bot.world.getColumn(x >> 4, z >> 4)?.getSkyLight({ x: x & 15, y: local.y + dy, z: z & 15 }) ?? 0);
  }
  const underground = lightSent && skyNear === 0;
  const sky = sight.skyAt(hour, underground);
  const { isHostile } = await fresh('./lib.mjs');
  const near = creatures(bot, eye, far, isHostile);
  const eyeCell = (Math.floor(eye[0]) - grid.x0) + grid.sx * ((Math.floor(eye[2]) - grid.z0) + grid.sz * (Math.floor(eye[1]) - grid.y0));
  const underWater = cells.kind[grid.ids[eyeCell] ?? 0] === sight.KIND.WATER;
  const base = { width, height, eye, fov: args.fov ?? 70, far, grid, cells, textures: textures?.textures ?? null, tints: textures?.tints,
    light: lightSent ? lightIn(bot, grid, 0.27 + 0.73 * sky.day) : null, lamp: 0.85, sky,
    waterState: bot.registry.blocksByName.water?.defaultState ?? 0, waterTexture: textures?.index.water.texture, waterTint: textures?.index.water.tint };
  const nameOf = (id) => bot.registry.blocksByStateId[id]?.name ?? 'unknown';
  const scale = width >= 480 ? 2 : 1;
  const clock = `${String(Math.floor((hour / 1000 + 6) % 24)).padStart(2, '0')}:${String(Math.floor((hour % 1000) * 0.06)).padStart(2, '0')}`;
  const stamp = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 19).replace(/:/g, '-');
  const where = `${Math.floor(at.x)} ${Math.floor(at.y)} ${Math.floor(at.z)}`;
  let rgb, told, seen, says, tag, checked = null;

  if (args.around) {
    // Four views, north east south and west, in one picture.
    rgb = new Uint8Array(width * height * 3);
    const half = { ...base, width: width >> 1, height: height >> 1 };
    told = {}; seen = [];
    const lines = [];
    for (const [i, way] of ['north', 'east', 'south', 'west'].entries()) {
      const part = await draw(sight, half, aim(bot, eye, way, sight), near, nameOf, !args.plain);
      if (!args.plain) sight.write(part.s.rgb, half.width, half.height, 4, 4, way, scale, [255, 236, 150]);
      sight.paste(rgb, width, part.s.rgb, half.width, half.height, (i % 2) * half.width, (i >> 1) * half.height);
      told[way] = part.told;
      for (const v of part.seen) if (!seen.some((w) => w.name === v.name && w.distance === v.distance)) seen.push({ ...v, way });
      const top = part.told.fills[0];
      const remark = part.told.remarks[0];
      const creature = part.seen.find((v) => v.kind !== 'item');
      lines.push(`${way}: ${top ? plain(top.name) : 'sky'}${remark ? `, ${plain(remark.name)} ${Math.round(remark.distance)}` : ''}${creature ? `, ${creature.name} ${Math.round(creature.distance)}` : ''}`);
    }
    says = `All round from ${where}. ${lines.join('. ')}.`.slice(0, 220);
    tag = 'around';
  } else {
    const part = await draw(sight, base, view, near, nameOf, !args.plain);
    ({ told, seen } = part);
    rgb = part.s.rgb;
    // check: N dots of the picture put to the game library's own ray, each along the same line.
    // What the two disagree on is listed. Plants, water and creatures are left out: the library's
    // ray passes through them. Meant for a player that is standing still.
    if (args.check > 0) {
      const { Vec3 } = require('vec3');
      const from = new Vec3(eye[0], eye[1], eye[2]);
      const solid = [sight.KIND.CUBE, sight.KIND.CUTOUT, sight.KIND.SHAPED, sight.KIND.LAVA];
      checked = { dots: 0, agreed: 0, differ: [] };
      for (let n = 0; n < Math.min(4000, args.check); n++) {
        const px = Math.floor(Math.random() * width), py = Math.floor(Math.random() * height), p = py * width + px;
        if (part.s.who[p] || part.s.wetAt[p] > 0) continue;
        const id = part.s.what[p];
        if (id && !solid.includes(cells.kind[id])) continue;
        const cam = part.s.cam;
        const vx = ((2 * (px + 0.5)) / width - 1) * cam.tanX, vy = (1 - (2 * (py + 0.5)) / height) * cam.tanY;
        const ray = new Vec3(cam.f[0] + cam.r[0] * vx + cam.u[0] * vy, cam.f[1] + cam.r[1] * vx + cam.u[1] * vy, cam.f[2] + cam.r[2] * vx + cam.u[2] * vy).normalize();
        const hit = bot.world.raycast(from, ray, far - 2);
        const theirs = hit ? `${hit.name} ${hit.position.x} ${hit.position.y} ${hit.position.z}` : null;
        // The same block in the same place, not only the same name: in a tunnel through tuff
        // nearly every ray meets tuff, and a world drawn one block out of place agreed 1500 times in 1500.
        const t = part.s.depth[p] + 1e-3;
        const mine = id && part.s.depth[p] < far - 2 ? `${nameOf(id)} ${Math.floor(eye[0] + ray.x * t)} ${Math.floor(eye[1] + ray.y * t)} ${Math.floor(eye[2] + ray.z * t)}` : null;
        // A leaf or a pane of glass is hit by the library's ray where the picture looks through its holes.
        if (cells.kind[id] === sight.KIND.CUTOUT || /leaves|glass/.test(theirs ?? '')) continue;
        checked.dots += 1;
        if (mine === theirs) checked.agreed += 1;
        else if (checked.differ.length < 8) checked.differ.push({ px, py, mine, theirs, at: +part.s.depth[p].toFixed(2) });
      }
    }
    const compass = sight.facing(view.yaw);
    const tilt = view.pitch > 0.6 ? ' and up' : view.pitch < -0.6 ? ' and down' : '';
    says = `${view.missed ? `I found ${view.missed}. ` : ''}${inWords(told, seen, `${compass.name}${tilt}`)}`.slice(0, 230);
    tag = String(view.target ?? compass.name).replace(/[^a-z0-9]+/gi, '-').slice(0, 24);
    if (!args.plain) {
      // The middle of the picture, marked as the game marks it.
      const mx = width >> 1, my = height >> 1;
      for (let d = -5 * scale; d <= 5 * scale; d++) for (const [px, py] of [[mx + d, my], [mx, my + d]]) {
        const o = (py * width + px) * 3;
        rgb[o] = 255 - rgb[o]; rgb[o + 1] = 255 - rgb[o + 1]; rgb[o + 2] = 255 - rgb[o + 2];
      }
      const ahead = told.ahead.block ? `ahead: ${told.ahead.block} ${told.ahead.distance}` : told.ahead.entity ? `ahead: ${told.ahead.entity} ${told.ahead.distance}` : 'ahead: sky';
      sight.shade(rgb, width, height, 0, height - 9 * scale - 4, sight.textWidth(ahead, scale) + 8, 9 * scale + 4);
      sight.write(rgb, width, height, 4, height - 9 * scale, ahead, scale, [255, 236, 150]);
    }
  }
  if (!args.plain) {
    // Two lines of where and how the player is: along the top, or along the bottom of the
    // all-round picture, whose top holds the names of the views.
    const first = `${bot.username} ${where}  ${args.around ? 'all round' : sight.facing(view.yaw).name}  ${clock}${underground ? ' under ground' : ''}`;
    const second = `hp ${Math.round(bot.health ?? 0)} food ${Math.round(bot.food ?? 0)}  ${bot.heldItem?.name ?? 'empty hand'}${status.doing ? `  ${status.doing.skill}` : ''}  day ${bot.time?.day ?? '?'}`;
    const top = args.around ? height - 18 * scale - 6 : 0;
    sight.shade(rgb, width, height, 0, top, Math.max(sight.textWidth(first, scale), sight.textWidth(second, scale)) + 8, 18 * scale + 6);
    sight.write(rgb, width, height, 4, top + 3, first, scale);
    sight.write(rgb, width, height, 4, top + 3 + 9 * scale, second, scale, [200, 230, 255]);
  }

  // Compared only for a block that can be bumped into: the library's ray passes through plants and water.
  let agrees = null;
  if (cursor !== undefined) {
    const mine = told.ahead.block ?? null;
    const solid = mine === null || [sight.KIND.CUBE, sight.KIND.CUTOUT, sight.KIND.SHAPED, sight.KIND.LAVA].includes(cells.kind[bot.registry.blocksByName[mine]?.defaultState ?? 0]);
    if (solid && !told.ahead.entity && (mine === null || told.ahead.distance <= 47)) agrees = cursor === mine;
  }

  mkdirSync(OUT, { recursive: true });
  const file = join(OUT, `${stamp}-${args.tag ? String(args.tag).replace(/[^a-z0-9]+/gi, '-').slice(0, 24) : tag}.png`);
  writeFileSync(file, sight.encodePng(rgb, width, height));
  const old = readdirSync(OUT).filter((name) => name.endsWith('.png')).sort();
  for (const name of old.slice(0, Math.max(0, old.length - KEPT))) { try { unlinkSync(join(OUT, name)); } catch { /* gone already */ } }
  return { ok: true, file, says, width, height, ms: Date.now() - started, where: { x: Math.floor(at.x), y: Math.floor(at.y), z: Math.floor(at.z) },
    facing: args.around ? 'all round' : sight.facing(view.yaw).name, heading: sight.facing(view.yaw).heading, pitch: Math.round((view.pitch * 180) / Math.PI),
    target: view.target ?? null, missed: view.missed ?? null, far, textured: !!textures, lit: lightSent, underground, underWater,
    unloaded: grid.missing, creatures: near.length, cursor: cursor ?? null, agrees, checked, seen, told };
}
