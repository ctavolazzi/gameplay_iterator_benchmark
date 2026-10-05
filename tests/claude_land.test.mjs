import test from 'node:test';
import assert from 'node:assert/strict';
const { asksFor, groundLevel, chooseSite, pieces, trees, MADE, insideOf } = await import(process.env.LAND ?? '../claude_player/land.mjs');
const { farmPlan } = await import('../claude_player/skills/build_farm.mjs');

// What CT typed to the session on 2026-10-04, and what the same wants would look like in chat.
test('a loose request is read for the jobs it asks for', () => {
  const order66 = 'I want you to get started building a farm for me\n\nsearch online for minecraft farm ideas, then choose a spot near spawn onto which you will build our farm\n\nflatten the surrounding terrain by dropping everything down to the 66th block level\n\nbasically...execute order 66 - except if order 66 was just building a badass farm';
  assert.deepEqual(asksFor(order66), [{ kind: 'farm' }, { kind: 'clear', standAt: 66 }]);
  assert.deepEqual(asksFor('continue farming, and please also eliminate all the surrounding trees entirely if they are slightly off the ground, they should be finished up and the wood harvested'), [{ kind: 'trees' }]);
  assert.deepEqual(asksFor('What do you guys think about doing some cleanup today? I was thinking we could flatten the surrounding area and prepare to get some crops going'), [{ kind: 'clear' }]);
  assert.deepEqual(asksFor('Claude can you make a farm over here'), [{ kind: 'farm' }]);
  assert.deepEqual(asksFor('how about we level this hill to y 70'), [{ kind: 'clear', standAt: 70 }]);
  assert.deepEqual(asksFor('chop down those trees please'), [{ kind: 'trees' }]);
  assert.deepEqual(asksFor('can you build a storehouse by the farm'), [{ kind: 'build', what: 'storehouse' }]);
  assert.deepEqual(asksFor('we need a shed for all this wood'), [{ kind: 'build', what: 'storehouse' }]);
});

test('talk about a farm, a tree or a level is not a request', () => {
  for (const said of ['nice farm', 'where is the farm?', 'did you cut the trees?', 'what level are you at', 'Claude can you build a bigger base?',
    'is the field flat yet', 'I went to sleep', 'follow me', 'execute order 66', 'how is the farm coming along',
    "don't cut the trees by my house", 'you can cut trees faster with an axe', 'stop flattening the hill', 'never build a farm on sand']) {
    assert.deepEqual(asksFor(said), [], said);
  }
});

// A made-up plain: ground at 65 everywhere, a hill three high in the west, a pond in the
// north-east, a chest in the middle, trees over the south.
function plain() {
  const columns = [], made = [{ x: 20, y: 66, z: 20, name: 'chest' }], wet = [];
  for (let x = 0; x < 60; x++) for (let z = 0; z < 50; z++) {
    const pond = x >= 48 && z < 10;
    const hill = x < 15;
    const wood = z >= 38;
    if (pond) wet.push({ x, y: 64, z, name: 'water' });
    columns.push({ x, z, ground: pond ? null : hill ? 68 : 65, coverName: pond ? 'water' : wood ? 'oak_leaves' : 'grass_block' });
  }
  return { columns, made, wet };
}

test('the level of a place is the height most of it is at', () => {
  assert.equal(groundLevel(plain().columns), 65);
  assert.equal(groundLevel([]), null);
});

test('a field goes on the flattest ground near, off water and off what is made', () => {
  const survey = plain();
  const site = chooseSite(survey, { w: 21, h: 11, level: 65, near: { x: 22, z: 22 }, margin: 2 });
  assert.ok(site, 'a site is found');
  assert.equal(site.cut, 0);
  assert.equal(site.fill, 0);
  assert.equal(site.trees, 0);
  // Not on the chest, nor within the margin of it.
  const onChest = site.x - 2 <= 20 && 20 <= site.x + 22 && site.z - 2 <= 20 && 20 <= site.z + 12;
  assert.equal(onChest, false, JSON.stringify(site));
  // Asked for by the hill it still prefers the flat beside it to cutting the hill down.
  const byHill = chooseSite(survey, { w: 21, h: 11, level: 65, near: { x: 8, z: 8 }, margin: 2 });
  assert.ok(byHill.x >= 15, JSON.stringify(byHill));
  // With made things everywhere there is nowhere, and it says so.
  const full = { ...survey, made: survey.columns.map((c) => ({ x: c.x, y: 66, z: c.z })) };
  assert.equal(chooseSite(full, { w: 21, h: 11, level: 65, near: { x: 22, z: 22 } }), null);
  // A plain that is all water has no site either.
  const sea = { columns: survey.columns.map((c) => ({ ...c, ground: null, coverName: 'water' })), made: [], wet: [] };
  assert.equal(chooseSite(sea, { w: 21, h: 11, level: 65, near: { x: 22, z: 22 } }), null);
});

test('a clearing is cut into pieces that cover it once, nearest first', () => {
  const box = { xa: -10, xb: 20, za: 5, zb: 30 };
  const list = pieces(box, { x: 20, z: 30 }, 12);
  const seen = new Map();
  for (const p of list) for (let x = p.xa; x <= p.xb; x++) for (let z = p.za; z <= p.zb; z++) seen.set(`${x},${z}`, (seen.get(`${x},${z}`) ?? 0) + 1);
  assert.equal(seen.size, 31 * 26);
  assert.ok([...seen.values()].every((n) => n === 1));
  assert.ok(list[0].xb === 20 && list[0].zb === 30, 'the piece by the player comes first');
});

test('logs are gathered into trees: standing, left floating, and holding a build', () => {
  const trunk = (x, z, from, to) => Array.from({ length: to - from + 1 }, (_, i) => ({ x, y: from + i, z }));
  const logs = [
    ...trunk(0, 0, 66, 70),                    // a tree standing on the ground
    ...trunk(10, 0, 69, 71),                   // what is left of one cut from below
    ...trunk(20, 0, 66, 72), { x: 21, y: 72, z: 1 },   // one with a platform in it, and a branch
  ];
  const made = [{ x: 21, y: 73, z: 0, name: 'oak_planks' }];
  const ground = 65;
  const found = trees(logs, made, (log) => log.y - 1 === ground);
  assert.equal(found.length, 3);
  const at = (x) => found.find((t) => t.base.x === x);
  assert.deepEqual([at(0).floating, at(0).kept, at(0).logs.length], [false, false, 5]);
  assert.deepEqual([at(10).floating, at(10).kept], [true, false]);
  assert.deepEqual([at(20).kept, at(20).logs.length], [true, 8]);
  // The lowest log comes first, so a tree is cut from the bottom.
  assert.ok(at(0).logs.every((log, i, all) => i === 0 || log.y >= all[i - 1].y));
});

test('inside the farm or the storehouse is known, with the way out; outside, on the fence and on the path to the gate are not', () => {
  const memory = { farmField: { x: -342, z: 460, level: 65 }, store: { origin: { x: -330, y: 66, z: 474 },
    door: { cell: { x: -328, y: 66, z: 478 }, inside: { x: -328, y: 66, z: 477 }, outside: { x: -328, y: 66, z: 479 } } } };
  const farm = insideOf(memory, { x: -324, y: 66, z: 462 });
  assert.deepEqual([farm.kind, farm.barrier, farm.from, farm.to], ['farm', { x: -332, y: 66, z: 470 }, { x: -332, y: 66, z: 469 }, { x: -332, y: 66, z: 471 }]);
  assert.equal(insideOf(memory, { x: -332, y: 66, z: 471 }), null, 'the cell outside the gate');
  assert.equal(insideOf(memory, { x: -342, y: 66, z: 465 }), null, 'on the line of the fence');
  assert.equal(insideOf(memory, { x: -324, y: 59, z: 462 }), null, 'under the field, in a mine');
  assert.equal(insideOf(memory, { x: -328, y: 66, z: 476 }).kind, 'storehouse');
  assert.equal(insideOf(memory, { x: -328, y: 66, z: 479 }), null, 'the cell outside the door');
  assert.equal(insideOf({}, { x: 0, y: 64, z: 0 }), null);
});

test('what is made is known as made', () => {
  for (const name of ['oak_fence', 'chest', 'white_bed', 'wall_torch', 'farmland', 'wheat', 'oak_planks', 'ladder']) assert.ok(MADE.test(name), name);
  for (const name of ['oak_log', 'oak_leaves', 'dirt', 'grass_block', 'stone', 'cobblestone']) assert.ok(!MADE.test(name), name);
});

test('the farm plan: every tilled block is wet, the gate is on the ring, the path is not tilled', () => {
  const plan = farmPlan(-342, 460, 65);
  assert.equal(plan.plots.length, 160);
  assert.equal(plan.ring.length, 59);
  assert.equal(plan.waters.length, 2);
  // Water wets the earth level with it for 4 blocks each way.
  const dry = plan.plots.filter(([x, , z]) => !plan.waters.some(([wx, , wz]) => Math.abs(x - wx) <= 4 && Math.abs(z - wz) <= 4));
  assert.equal(dry.length, 0);
  // A plan with its second water one block out of place leaves a column dry: this check can fail.
  const moved = [[plan.waters[0][0], 65, plan.waters[0][2]], [plan.waters[1][0] + 1, 65, plan.waters[1][2]]];
  assert.ok(plan.plots.filter(([x, , z]) => !moved.some(([wx, , wz]) => Math.abs(x - wx) <= 4 && Math.abs(z - wz) <= 4)).length > 0);
  const keys = new Set([...plan.plots, ...plan.path, ...plan.waters].map(String));
  assert.equal(keys.size, 160 + 9 + 2, 'plots, path and water do not overlap');
  assert.ok(plan.torches.every(([x, y, z]) => plan.path.some(([px, py, pz]) => px === x && pz === z && py + 1 === y)), 'torches stand on the path');
  // The way out: the cell outside the gate is next to the gate, and the gate is next to the path.
  assert.deepEqual(plan.gate, [-332, 66, 470]);
  assert.deepEqual(plan.outside, [-332, 66, 471]);
  assert.ok(plan.path.some(([x, , z]) => x === plan.gate[0] && z === plan.gate[2] - 1));
  assert.ok(!plan.ring.some((cell) => String(cell) === String(plan.gate)), 'no fence where the gate goes');
});
