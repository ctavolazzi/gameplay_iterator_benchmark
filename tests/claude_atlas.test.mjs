import test from 'node:test';
import assert from 'node:assert/strict';
const { note, forget, nearest, summary, BLOCKS, CREATURES } = await import(process.env.ATLAS ?? '../claude_player/atlas.mjs');
const { plan } = await import('../claude_player/planner.mjs');

const here = { x: 0, y: 64, z: 0 };
const T = 1_000_000;

test('what one look finds becomes places: a vein is one place, two stands of trees are two', () => {
  const atlas = {};
  note(atlas, [
    { name: 'coal_ore', x: 20, y: 60, z: 5 }, { name: 'coal_ore', x: 21, y: 60, z: 5 }, { name: 'coal_ore', x: 21, y: 61, z: 6 },
    { name: 'spruce_log', x: -30, y: 66, z: 40 }, { name: 'spruce_log', x: 70, y: 66, z: -90 },
  ], T, here);
  assert.equal(atlas.coal_ore.length, 1);
  assert.deepEqual({ x: atlas.coal_ore[0].x, n: atlas.coal_ore[0].n, seen: atlas.coal_ore[0].seen }, { x: 20, n: 3, seen: T });
  assert.equal(atlas.spruce_log.length, 2);
  // Seen again later with less of it left: the place stays one place, and the time moves on.
  note(atlas, [{ name: 'coal_ore', x: 21, y: 61, z: 6 }], T + 5000, here);
  assert.equal(atlas.coal_ore.length, 1);
  assert.equal(atlas.coal_ore[0].seen, T + 5000);
});

test('the nearest known place is given, not what is close enough to see, and not another layer of the world', () => {
  const atlas = {};
  note(atlas, [{ name: 'sand', x: 100, y: 63, z: 0 }, { name: 'sand', x: 40, y: 62, z: 30 }, { name: 'sand', x: 5, y: 63, z: 5 },
    { name: 'diamond_ore', x: 30, y: -50, z: 0 }], T, here);
  const sand = nearest(atlas, ['sand', 'red_sand'], here, { now: T });
  assert.deepEqual([sand.x, sand.z, sand.far], [40, 30, 50]);
  assert.equal(nearest(atlas, ['diamond_ore'], here, { now: T }), null, 'an ore 114 blocks down is not a walk');
  assert.equal(nearest(atlas, ['diamond_ore'], { x: 0, y: -48, z: 0 }, { now: T }).x, 30);
  assert.equal(nearest(atlas, ['clay'], here, { now: T }), null);
  assert.equal(nearest({}, ['sand'], here), null);
});

test('a place is forgotten when the player stands by it and it is not there, and only then', () => {
  const atlas = {};
  note(atlas, [{ name: 'pumpkin', x: 10, y: 64, z: 10 }, { name: 'pumpkin', x: 200, y: 64, z: 200 }, { name: 'sugar_cane', x: 8, y: 63, z: -6 }], T, here);
  // A look from the same spot that finds the cane and no pumpkin: the near pumpkin goes, the far one stays.
  const dropped = forget(atlas, [{ name: 'sugar_cane', x: 8, y: 63, z: -6 }], T + 1000, here);
  assert.equal(dropped, 1);
  assert.deepEqual(atlas.pumpkin.map((p) => p.x), [200]);
  assert.equal(atlas.sugar_cane.length, 1);
  // A kind the look did not search for is not judged.
  note(atlas, [{ name: 'bamboo', x: 3, y: 64, z: 3 }], T, here);
  forget(atlas, [], T + 2000, here, 24, ['pumpkin']);
  assert.equal(atlas.bamboo.length, 1);
});

test('creatures move: a flock is remembered for ten minutes', () => {
  const atlas = {};
  note(atlas, [{ name: 'sheep', x: 50, y: 64, z: 0 }, { name: 'sheep', x: 52, y: 64, z: 1 }], T, here);
  assert.equal(nearest(atlas, ['sheep'], here, { now: T + 60000 }).n, 2);
  assert.equal(nearest(atlas, ['sheep'], here, { now: T + 11 * 60000 }), null);
  forget(atlas, [], T + 11 * 60000, { x: 500, y: 64, z: 500 });
  assert.equal(atlas.sheep, undefined);
});

test('each kind keeps its ten places nearest home', () => {
  const atlas = {};
  for (let i = 0; i < 25; i++) note(atlas, [{ name: 'oak_log', x: i * 40, y: 64, z: 0 }], T + i, { x: i * 40, y: 64, z: 0 }, here);
  assert.equal(atlas.oak_log.length, 10);
  assert.ok(atlas.oak_log.every((p) => p.x <= 9 * 40), atlas.oak_log.map((p) => p.x).join(' '));
  const list = summary(atlas, here);
  assert.deepEqual([list[0].name, list[0].places, list[0].far], ['oak_log', 10, 0]);
  assert.ok(BLOCKS.includes('deepslate_diamond_ore') && BLOCKS.includes('sand') && CREATURES.includes('sheep'));
});

// The planner asks where a thing was seen before it wanders.
test('with nothing in sight the planner walks to where the thing was seen, and wanders only when nothing is known', () => {
  const world = (knows) => ({ have: { stone_pickaxe: 1 }, wood: 'oak', recipes: () => [], sees: () => false, liquid: () => false, creatures: [],
    near: {}, tableKnown: null, night: false, exposed: true, y: 64, surfaceY: 64, blocked: () => false, ...(knows && { knows }) });
  const lost = plan('oak_log', 3, world(null));
  assert.equal(lost.skill, 'explore');
  const asked = [];
  const found = plan('oak_log', 3, world((names) => { asked.push(names); return { name: 'oak_log', x: -60, y: 66, z: 120, far: 134 }; }));
  assert.deepEqual([found.skill, found.args.x, found.args.z], ['goto', -60, 120]);
  assert.ok(asked[0].includes('oak_log'));
  // Known, and the walk there is held back after failing: it wanders as before.
  const held = plan('oak_log', 3, { ...world(() => ({ name: 'oak_log', x: -60, y: 66, z: 120 })), blocked: (step) => step.skill === 'goto' });
  assert.equal(held.skill, 'explore');
});
