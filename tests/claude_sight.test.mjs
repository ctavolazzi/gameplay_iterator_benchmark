import test from 'node:test';
import assert from 'node:assert/strict';

// SIGHT lets a changed sight.mjs be checked beside the one the running player has loaded.
const sight = await import(process.env.SIGHT ?? '../claude_player/sight.mjs');
const { KIND, aimAt, decodePng, describe, drawEntities, encodePng, facing, prepare, project, rows, skyAt, write } = sight;

// A made-up world, 33 blocks each way, with the eye in the middle of it standing on grass.
//   state 1 grass (the ground), 2 stone (a wall 10 blocks to the north), 3 a red marker to the
//   north-east, 4 a slab 4 blocks ahead, 5 water in a pool to the north-west, 6 a plant.
const SIZE = 33;
const STATES = { grass: 1, stone: 2, marker: 3, slab: 4, water: 5, plant: 6 };
const NAMES = ['air', 'grass_block', 'stone', 'redstone_ore', 'oak_slab', 'water', 'short_grass'];
function world() {
  const ids = new Uint16Array(SIZE * SIZE * SIZE);
  const set = (x, y, z, id) => { ids[x + SIZE * (z + SIZE * y)] = id; };
  for (let x = 0; x < SIZE; x++) for (let z = 0; z < SIZE; z++) {
    for (let y = 0; y <= 7; y++) set(x, y, z, STATES.grass);
    for (let y = 8; y <= 12; y++) set(x, y, 6, STATES.stone);
  }
  set(20, 8, 10, STATES.marker);
  set(16, 8, 12, STATES.slab);
  set(15, 8, 13, STATES.plant);
  for (let x = 9; x <= 12; x++) for (let z = 9; z <= 12; z++) set(x, 7, z, STATES.water);
  const kind = new Uint8Array(8);
  kind.set([KIND.AIR, KIND.CUBE, KIND.CUBE, KIND.CUBE, KIND.SHAPED, KIND.WATER, KIND.CROSS]);
  const flat = new Uint8Array(8 * 3);
  flat.set([0, 0, 0, 90, 170, 70, 128, 128, 128, 220, 40, 40, 190, 150, 90, 60, 110, 220, 110, 190, 80]);
  return { grid: { ids, x0: 0, y0: 0, z0: 0, sx: SIZE, sy: SIZE, sz: SIZE },
    cells: { kind, faces: new Uint16Array(8 * 6).fill(0xffff), tintOf: new Uint8Array(8), tintMask: new Uint8Array(8), emit: new Uint8Array(8), flat,
      boxes: new Map([[STATES.slab, new Float32Array([0, 0, 0, 1, 0.5, 1])]]) } };
}
const EYE = [16.5, 9.62, 16.5];
const view = (over = {}) => {
  const s = prepare({ width: 160, height: 90, eye: EYE, yaw: 0, pitch: 0, fov: 70, far: 30, textures: null, light: null, lamp: 0,
    sky: skyAt(6000), waterState: STATES.water, ...world(), ...over });
  rows(s, 0, s.height);
  return s;
};
const at = (s, point) => {
  const p = project(s.cam, s.eye, point);
  return p && p.x >= 0 && p.y >= 0 && p.x < s.width && p.y < s.height ? Math.floor(p.y) * s.width + Math.floor(p.x) : null;
};

test('facing north, the wall is straight ahead at its true distance', () => {
  const s = view();
  const centre = 45 * 160 + 80;
  assert.equal(s.what[centre], STATES.stone);
  assert.ok(Math.abs(s.depth[centre] - 9.5) < 0.1, `distance ${s.depth[centre]}`);
  // Up into the sky nothing is hit; down at its feet, the grass it stands on.
  assert.equal(view({ pitch: 1.3 }).what[centre], 0);
  assert.equal(view({ pitch: -1.3 }).what[centre], STATES.grass);
});

test('east is on the right when facing north, and what is up is up: the picture is not mirrored', () => {
  const marker = [20.5, 8.5, 10.99];
  const north = view();
  const p = at(north, marker);
  assert.equal(north.what[p], STATES.marker);
  assert.ok(p % 160 > 85, `the marker is at column ${p % 160} of 160`);
  // The marker bears 36 degrees east of north. Turned to face north-east (45), it is left of the middle.
  const turned = view({ yaw: -Math.PI / 4 });
  const q = at(turned, marker);
  assert.equal(turned.what[q], STATES.marker);
  assert.ok(q % 160 < 78, `facing north-east the marker is at column ${q % 160}`);
  // And what is up in the world is up in the picture.
  const top = at(north, [16.5, 12.5, 7.001]), bottom = at(north, [16.5, 8.5, 7.001]);
  assert.ok(Math.floor(top / 160) < Math.floor(bottom / 160));
});

test('a slab is drawn at half height, a plant is seen, and the block the eye is in is looked out of', () => {
  const s = view({ pitch: -0.3 });
  assert.equal(s.what[at(s, [16.5, 8.25, 12.999])], STATES.slab);
  assert.notEqual(s.what[at(s, [16.5, 8.9, 12.999])], STATES.slab);       // above the slab's top
  assert.equal(s.what[at(s, [15.5, 8.5, 13.5])], STATES.plant);
  // With the eye inside stone (a player that has dug itself in), it still sees out.
  const { grid, cells } = world();
  grid.ids[16 + SIZE * (16 + SIZE * 9)] = STATES.stone;
  const dug = view({ grid, cells });
  assert.equal(dug.what[45 * 160 + 80], STATES.stone);
  assert.ok(dug.depth[45 * 160 + 80] > 9);
});

test('a creature is drawn where it stands, hides what is behind it, and is hidden by a wall', () => {
  const s = view();
  const zombie = { x: 18.5, y: 8, z: 11.5, w: 0.6, h: 1.95, colour: [70, 110, 60] };
  const hidden = { x: 16.5, y: 8, z: 3.5, w: 0.6, h: 1.95, colour: [255, 0, 255] };     // beyond the wall
  const seen = drawEntities(s, [zombie, hidden]);
  const p = at(s, [18.5, 9, 11.5]);
  assert.equal(s.who[p], 1);
  assert.ok(Math.abs(s.depth[p] - Math.hypot(2, 0.62, 5)) < 0.5);
  assert.ok(seen[0].dots > 20);
  assert.ok(seen[0].x > 80);                // to the right of the middle: it stands to the north-east
  assert.equal(seen[1].dots, 0);
});

test('what is in the picture is told in words: what fills it, what is ahead, and water on the left', () => {
  const s = view({ pitch: -0.25 });
  const told = describe(s, (id) => NAMES[id]);
  const names = told.fills.map((f) => f.name);
  assert.ok(names.includes('grass_block') && names.includes('stone'));
  // Looking down a little, the middle of the picture meets the top of the slab 4 blocks off.
  assert.equal(told.ahead.block, 'oak_slab');
  assert.ok(told.ahead.distance > 4 && told.ahead.distance < 5, `the slab at ${told.ahead.distance}`);
  const water = told.remarks.find((r) => r.name === 'water');
  assert.equal(water.side, 'left');
  assert.ok(water.distance > 5 && water.distance < 9, `water at ${water.distance}`);
  const ore = told.remarks.find((r) => r.name === 'redstone_ore');
  assert.equal(ore.side, 'right');
});

test('a picture written to a PNG file reads back the same, and the letters are the right shape', () => {
  const s = view();
  const png = encodePng(s.rgb, s.width, s.height);
  const back = decodePng(png);
  assert.equal(back.width, 160);
  assert.equal(back.height, 90);
  for (let i = 0; i < 160 * 90; i += 7) for (let c = 0; c < 3; c++) assert.equal(back.rgba[i * 4 + c], s.rgb[i * 3 + c]);
  const page = new Uint8Array(20 * 10 * 3);
  write(page, 20, 10, 0, 0, 'I', 1, [255, 255, 255]);
  let white = 0;
  for (let i = 0; i < page.length; i += 3) if (page[i] === 255) white += 1;
  assert.equal(white, 11);                  // three dots, five down the middle, three dots
});

test('compass points and aiming agree with the game: yaw 0 is north, and east is a quarter turn right', () => {
  assert.equal(facing(0).name, 'north');
  assert.equal(facing(-Math.PI / 2).name, 'east');
  assert.equal(facing(Math.PI).name, 'south');
  assert.equal(facing(Math.PI / 2).name, 'west');
  const aim = aimAt([0, 0, 0], [10, 0, 0]);
  assert.equal(facing(aim.yaw).name, 'east');
  assert.ok(Math.abs(aimAt([0, 0, 0], [0, 10, -10]).pitch - Math.PI / 4) < 1e-9);
  assert.equal(skyAt(18000).day, 0);
  assert.equal(skyAt(6000).day, 1);
});

test('a chat line is read for what it asks the player to look at', async () => {
  const { askedFor } = await import('../claude_player/eyes.mjs');
  assert.deepEqual(askedFor('what do you see?', 'fogsift'), {});
  assert.deepEqual(askedFor('look north', 'fogsift'), { at: 'north' });
  assert.deepEqual(askedFor('Claude look around', 'fogsift'), { around: true });
  assert.deepEqual(askedFor('look at me', 'fogsift'), { at: 'fogsift' });
  assert.deepEqual(askedFor('take a picture of the crafting table', 'fogsift'), { at: 'crafting_table' });
  assert.deepEqual(askedFor('what is behind you', 'fogsift'), { at: 'behind' });
});
