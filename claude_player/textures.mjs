#!/usr/bin/env node
// Builds what the player's eyes need to draw blocks as the game draws them: every block
// texture in the installed game's own jar, and for every block state which texture is on
// which of its faces. It is read once from the copy of the game installed on this machine
// into data/claude_player/sight-cache/, which is not in git: the textures are Mojang's.
// Without that folder the eyes still work, in flat colours.
//   node claude_player/textures.mjs            build the cache (a few seconds)
//   node claude_player/textures.mjs --check    say whether it is there and what it was built from
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateRawSync } from 'node:zlib';
import { KIND, decodePng } from './sight.mjs';

const require = createRequire(import.meta.url);
export const CACHE = fileURLToPath(new URL('../data/claude_player/sight-cache/', import.meta.url));
const GAME_VERSION = '26.1';
const NO_TEXTURE = 0xffff;

// The colours the game mixes into its grey textures. It picks them by biome; these are the
// ones for the plains and forest this world's spawn point is in.
export const TINTS = [[255, 255, 255], [134, 190, 90], [104, 172, 48], [128, 167, 85], [97, 153, 97], [63, 118, 228], [32, 128, 48], [110, 170, 60]];
const TINT = { none: 0, grass: 1, foliage: 2, birch: 3, spruce: 4, water: 5, lily: 6, stem: 7 };

// The game's jar of the newest installed version (block textures hardly change between versions).
export function findJar() {
  const versions = join(homedir(), 'Library', 'Application Support', 'minecraft', 'versions');
  if (!existsSync(versions)) return null;
  const jars = readdirSync(versions).map((name) => join(versions, name, `${name}.jar`)).filter(existsSync)
    .map((path) => ({ path, exact: path.endsWith(`${GAME_VERSION}.jar`), at: statSync(path).mtimeMs }));
  jars.sort((a, b) => (b.exact - a.exact) || (b.at - a.at));
  return jars[0]?.path ?? null;
}

// The files of a zip whose names pass the test, as { name: Buffer }.
export function unzip(buffer, wanted) {
  let end = buffer.length - 22;
  while (end >= 0 && buffer.readUInt32LE(end) !== 0x06054b50) end -= 1;
  if (end < 0) throw new Error('not a zip file');
  const count = buffer.readUInt16LE(end + 10);
  let at = buffer.readUInt32LE(end + 16);
  const out = {};
  for (let i = 0; i < count; i++) {
    if (buffer.readUInt32LE(at) !== 0x02014b50) throw new Error('the zip directory is damaged');
    const method = buffer.readUInt16LE(at + 10);
    const packed = buffer.readUInt32LE(at + 20);
    const nameLength = buffer.readUInt16LE(at + 28);
    const local = buffer.readUInt32LE(at + 42);
    const name = buffer.toString('utf8', at + 46, at + 46 + nameLength);
    at += 46 + nameLength + buffer.readUInt16LE(at + 30) + buffer.readUInt16LE(at + 32);
    if (!wanted(name)) continue;
    const start = local + 30 + buffer.readUInt16LE(local + 26) + buffer.readUInt16LE(local + 28);
    const data = buffer.subarray(start, start + packed);
    out[name] = method === 0 ? Buffer.from(data) : inflateRawSync(data);
  }
  return out;
}

const bare = (name) => String(name).replace(/^minecraft:/, '').replace(/^block\//, '');
const first = (value) => (Array.isArray(value) ? value[0] : value);

// The model the game uses for a block in one state, from its blockstates file.
function modelFor(blockstate, props) {
  if (blockstate?.variants) {
    for (const [key, value] of Object.entries(blockstate.variants)) {
      if (key === '' || key.split(',').every((pair) => { const [k, v] = pair.split('='); return String(props[k]) === v; })) return first(value)?.model;
    }
    return first(Object.values(blockstate.variants)[0])?.model;
  }
  if (blockstate?.multipart) return first(blockstate.multipart[0].apply)?.model;
  return null;
}

// A model's named textures, with what its parents name underneath.
function texturesOf(models, name, depth = 0) {
  const model = models[bare(name)];
  if (!model || depth > 8) return {};
  return { ...(model.parent ? texturesOf(models, model.parent, depth + 1) : {}), ...(model.textures ?? {}) };
}

// The texture on each face (down, up, north, south, west, east) of a block in one state.
function facesFor(named, props) {
  const tex = (key) => {
    // Since 26.x a texture may be written as { sprite, force_translucent } instead of a name.
    const named1 = (value) => (value && typeof value === 'object' ? value.sprite : value);
    let value = named1(named[key]);
    for (let hop = 0; typeof value === 'string' && value.startsWith('#') && hop < 6; hop++) value = named1(named[value.slice(1)]);
    return typeof value === 'string' ? bare(value) : null;
  };
  // A door's two textures are its two halves, not its top and bottom faces.
  if (tex('top') && tex('bottom') && /^(upper|lower)$/.test(props.half ?? '') && !tex('side') && !tex('all')) {
    return new Array(6).fill(props.half === 'upper' ? tex('top') : tex('bottom'));
  }
  const any = () => ['all', 'texture', 'side', 'cross', 'crop', 'plant', 'torch', 'wall', 'pane', 'rail', 'fire', 'top', 'end', 'front', 'particle', ...Object.keys(named)].map(tex).find(Boolean) ?? null;
  const side = (direction) => tex(direction) ?? tex('side') ?? tex('all') ?? any();
  const faces = { down: tex('down') ?? tex('bottom') ?? tex('end') ?? tex('all') ?? any(), up: tex('up') ?? tex('top') ?? tex('end') ?? tex('all') ?? any(),
    north: side('north'), south: side('south'), west: side('west'), east: side('east') };
  // A front (a furnace, a carved pumpkin) is on the side the block faces.
  const front = tex('front');
  if (front && ['north', 'south', 'west', 'east'].includes(props.facing)) faces[props.facing] = front;
  // A log lying on its side has its ends along that axis.
  const end = tex('end');
  if (end && props.axis === 'x') { faces.west = faces.east = end; faces.up = faces.down = tex('side') ?? end; }
  if (end && props.axis === 'z') { faces.north = faces.south = end; faces.up = faces.down = tex('side') ?? end; }
  return [faces.down, faces.up, faces.north, faces.south, faces.west, faces.east];
}

const AIR = /^(air|cave_air|void_air|light|structure_void|barrier|moving_piston)$/;
const LIES_FLAT = /rail$|^redstone_wire$|_pressure_plate$|^snow$|^glow_lichen$|^sculk_vein$|^pink_petals$|^leaf_litter$|^wildflowers$|^tripwire$/;
const GLOWS = /^(lava|fire|soul_fire|torch|wall_torch|soul_torch|soul_wall_torch|lantern|soul_lantern|glowstone|sea_lantern|shroomlight|jack_o_lantern|magma_block|end_rod|beacon|redstone_torch|redstone_wall_torch)$|froglight$/;
function tintFor(name) {
  if (name === 'grass_block') return [TINT.grass, 1 << 1];                 // the top only
  if (/^(short_grass|tall_grass|fern|large_fern|sugar_cane|bush|potted_fern)$/.test(name)) return [TINT.grass, 63];
  if (/^(oak|jungle|acacia|dark_oak|mangrove)_leaves$|^vine$/.test(name)) return [TINT.foliage, 63];
  if (name === 'birch_leaves') return [TINT.birch, 63];
  if (name === 'spruce_leaves') return [TINT.spruce, 63];
  if (/^(water|bubble_column)$/.test(name)) return [TINT.water, 63];
  if (name === 'lily_pad') return [TINT.lily, 63];
  if (/_stem$/.test(name)) return [TINT.stem, 63];
  return [TINT.none, 0];
}

// Everything the eyes need, from the jar: { index, textures, states }.
export function build(jarPath) {
  const registry = require('prismarine-registry')(GAME_VERSION);
  const Block = require('prismarine-block')(registry);
  const files = unzip(readFileSync(jarPath), (name) => /^assets\/minecraft\/(textures\/block\/[^/]+\.png|models\/block\/[^/]+\.json|blockstates\/[^/]+\.json)$/.test(name));
  const names = [];
  const rgba = [];
  const clear = [];                       // whether a texture has dots that are see-through
  const blockstates = {};
  const models = {};
  let unread = 0;
  for (const [path, data] of Object.entries(files)) {
    const name = path.split('/').pop().replace(/\.(png|json)$/, '');
    if (path.includes('/blockstates/')) blockstates[name] = JSON.parse(data.toString('utf8'));
    else if (path.includes('/models/')) models[name] = JSON.parse(data.toString('utf8'));
    else {
      let image;
      try { image = decodePng(data); } catch { unread += 1; continue; }
      // A texture that moves is its frames one under another: the first one is kept. One that
      // is finer than 16 dots across (signs, shelves) is thinned to 16.
      if (image.width % 16 || image.height < image.width) { unread += 1; continue; }
      const every = image.width / 16;
      const frame = new Uint8Array(1024);
      for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
        frame.set(image.rgba.subarray((y * every * image.width + x * every) * 4, (y * every * image.width + x * every) * 4 + 4), (y * 16 + x) * 4);
      }
      let holes = false;
      for (let i = 3; i < 1024; i += 4) if (frame[i] < 128) { holes = true; break; }
      names.push(name); rgba.push(frame); clear.push(holes);
    }
  }
  const indexOf = new Map(names.map((name, i) => [name, i]));
  const count = Math.max(...Object.keys(registry.blocksByStateId).map(Number)) + 1;
  const faces = new Uint16Array(count * 6).fill(NO_TEXTURE);
  const kind = new Uint8Array(count), tintOf = new Uint8Array(count), tintMask = new Uint8Array(count), emit = new Uint8Array(count);
  const flat = new Uint8Array(count * 3);
  const kinds = {};
  let untextured = 0;
  for (let id = 0; id < count; id++) {
    const def = registry.blocksByStateId[id];
    if (!def) continue;
    const block = Block.fromStateId(id, 0);
    const props = block.getProperties();
    const name = def.name;
    const shapes = block.shapes ?? [];
    const whole = shapes.length === 1 && shapes[0].every((v, i) => v === (i < 3 ? 0 : 1));
    const model = modelFor(blockstates[name], props);
    const on = model ? facesFor(texturesOf(models, model), props).map((texture) => indexOf.get(texture) ?? NO_TEXTURE) : new Array(6).fill(NO_TEXTURE);
    faces.set(on, id * 6);
    if (AIR.test(name)) kind[id] = KIND.AIR;
    else if (/^(water|bubble_column)$/.test(name)) kind[id] = KIND.WATER;
    else if (name === 'lava') kind[id] = KIND.LAVA;
    else if (whole) kind[id] = on.some((texture) => texture !== NO_TEXTURE && clear[texture]) ? KIND.CUTOUT : KIND.CUBE;
    else if (shapes.length) kind[id] = KIND.SHAPED;
    else kind[id] = LIES_FLAT.test(name) ? KIND.FLAT : KIND.CROSS;
    kinds[kind[id]] = (kinds[kind[id]] ?? 0) + 1;
    [tintOf[id], tintMask[id]] = tintFor(name);
    emit[id] = GLOWS.test(name) || props.lit === true ? 1 : 0;
    // The block's colour when a face has no texture: the mean of its side's dots that can be seen.
    const from = on[2] !== NO_TEXTURE ? on[2] : on.find((texture) => texture !== NO_TEXTURE);
    if (from === undefined) { untextured += kind[id] === KIND.AIR ? 0 : 1; flat.set([140, 120, 100], id * 3); continue; }
    const dots = rgba[from];
    let r = 0, g = 0, b = 0, n = 0;
    for (let i = 0; i < 1024; i += 4) if (dots[i + 3] >= 128) { r += dots[i]; g += dots[i + 1]; b += dots[i + 2]; n += 1; }
    const tint = tintMask[id] === 63 ? TINTS[tintOf[id]] : TINTS[0];
    flat.set(n ? [(r / n) * tint[0] / 255, (g / n) * tint[1] / 255, (b / n) * tint[2] / 255] : [140, 120, 100], id * 3);
  }
  const textures = new Uint8Array(names.length * 1024);
  rgba.forEach((frame, i) => textures.set(frame, i * 1024));
  const states = Buffer.concat([Buffer.from(faces.buffer), Buffer.from(kind), Buffer.from(tintOf), Buffer.from(tintMask), Buffer.from(emit), Buffer.from(flat)]);
  const index = { built: new Date().toISOString(), jar: jarPath, game: GAME_VERSION, states: count, textures: names, unread, untextured, kinds,
    water: { state: registry.blocksByName.water.defaultState, texture: indexOf.get('water_still') ?? NO_TEXTURE, tint: TINT.water } };
  return { index, textures, states };
}

// The cache as the eyes use it, or null when it has not been built.
export function load() {
  if (!existsSync(join(CACHE, 'index.json'))) return null;
  const index = JSON.parse(readFileSync(join(CACHE, 'index.json'), 'utf8'));
  const raw = readFileSync(join(CACHE, 'states.bin'));
  const n = index.states;
  const part = (from, length) => new Uint8Array(raw.buffer, raw.byteOffset + from, length);
  return { index, textures: new Uint8Array(readFileSync(join(CACHE, 'textures.bin'))),
    faces: new Uint16Array(raw.buffer.slice(raw.byteOffset, raw.byteOffset + n * 12)),
    kind: part(n * 12, n), tintOf: part(n * 13, n), tintMask: part(n * 14, n), emit: part(n * 15, n), flat: part(n * 16, n * 3) };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--check')) {
    const cache = load();
    console.log(cache ? JSON.stringify({ built: cache.index.built, jar: cache.index.jar, states: cache.index.states, textures: cache.index.textures.length }) : 'no cache: the eyes draw in flat colours');
  } else {
    const jar = findJar();
    if (!jar) { console.error('no installed game found under ~/Library/Application Support/minecraft/versions'); process.exit(1); }
    const started = Date.now();
    const { index, textures, states } = build(jar);
    mkdirSync(CACHE, { recursive: true });
    writeFileSync(join(CACHE, 'textures.bin'), textures);
    writeFileSync(join(CACHE, 'states.bin'), states);
    writeFileSync(join(CACHE, 'index.json'), JSON.stringify(index));
    console.log(`${index.textures.length} textures and ${index.states} block states from ${jar} in ${Date.now() - started} ms`);
    console.log(JSON.stringify({ unread: index.unread, untextured: index.untextured, kinds: index.kinds, bytes: textures.length + states.length }));
  }
}
