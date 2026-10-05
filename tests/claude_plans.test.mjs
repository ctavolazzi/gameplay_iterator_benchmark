import test from 'node:test';
import assert from 'node:assert/strict';
const { storehouse, planFaults, planMissing, standFor, ROLE } = await import(process.env.PLANS ?? '../claude_player/plans.mjs');

const { surplusOf } = await import('../claude_player/skills/store.mjs');

test('what goes into the storehouse: the bulk, not the tools in use, the food, the seeds or a working amount', () => {
  const pack = [
    { name: 'oak_log', count: 64 }, { name: 'oak_log', count: 47 }, { name: 'spruce_log', count: 51 }, { name: 'coal', count: 64 }, { name: 'coal', count: 64 },
    { name: 'diamond_pickaxe', count: 1 }, { name: 'iron_pickaxe', count: 1 }, { name: 'stone_pickaxe', count: 1 }, { name: 'diamond_hoe', count: 1 }, { name: 'wooden_hoe', count: 1 },
    { name: 'wheat_seeds', count: 9 }, { name: 'cooked_porkchop', count: 2 }, { name: 'apple', count: 1 }, { name: 'torch', count: 3 }, { name: 'bucket', count: 1 },
    { name: 'oak_sapling', count: 30 }, { name: 'white_banner', count: 1 }, { name: 'diorite', count: 18 }, { name: 'diamond', count: 20 }, { name: 'cobblestone', count: 62 },
  ];
  const got = Object.fromEntries(surplusOf(pack, ['diamond_pickaxe', 'diamond_hoe'], 14));
  assert.deepEqual(got, { oak_log: 95, spruce_log: 51, coal: 112, iron_pickaxe: 1, stone_pickaxe: 1, wooden_hoe: 1, oak_sapling: 30, white_banner: 1, diamond: 14, cobblestone: 30 });
  // With nothing to spare, nothing goes.
  assert.deepEqual(surplusOf([{ name: 'oak_log', count: 16 }, { name: 'diamond_pickaxe', count: 1 }, { name: 'bread', count: 5 }], ['diamond_pickaxe'], 0), []);
});

const origin = { x: -330, y: 66, z: 474 };
const whats = (faults) => [...new Set(faults.map((f) => f.what.replace(/ \(.*\)$/, '')))];

test('the storehouse can be built as planned: nothing floats, nothing is out of reach, the room can be walked', () => {
  const plan = storehouse(origin);
  assert.deepEqual(planFaults(plan), []);
  // 12 wall columns of 3 less the doorway's 2, and a roof of 25; 4 posts of 3.
  assert.deepEqual(plan.bill, { planks: 12 * 3 - 2 + 25, log: 12, torch: 1, chest: 3, door: 1 });
  assert.equal(plan.stages.map((s) => s.name).join(' '), 'walls inside roof door');
  // The door is in the south wall and the cells either side of it are one step apart through it.
  assert.deepEqual(plan.door, { cell: { x: -328, y: 66, z: 478 }, outside: { x: -328, y: 66, z: 479 }, inside: { x: -328, y: 66, z: 477 } });
});

test('a wall block is placed from the ground outside it, and never from inside the footprint', () => {
  const plan = storehouse(origin);
  const walls = plan.stages[0];
  for (const cell of walls.cells) {
    const stand = standFor(plan, walls, cell);
    const inside = stand.x >= origin.x && stand.x <= origin.x + 4 && stand.z >= origin.z && stand.z <= origin.z + 4;
    assert.equal(inside, false, JSON.stringify({ cell, stand }));
    assert.equal(stand.y, origin.y);
  }
});

test('the faults a plan can have are found before a block is placed', () => {
  // A chest in the cell inside the door: the room is shut off (the first base's chest did this).
  const shut = storehouse(origin);
  shut.stages[1].cells.push({ x: shut.door.inside.x, y: origin.y, z: shut.door.inside.z, role: 'chest' });
  assert.ok(whats(planFaults(shut)).includes('the cell inside the door is not free'));
  // The roof before the walls: its first block has nothing under it or beside it.
  const upside = storehouse(origin);
  upside.stages = [upside.stages[2], upside.stages[0], upside.stages[1], upside.stages[3]];
  assert.ok(whats(planFaults(upside)).includes('nothing to place it against when its turn comes'));
  // A chest with a block over it does not open.
  const lidded = storehouse(origin);
  const chest = lidded.chests[0];
  lidded.stages[1].cells.push({ x: chest.x, y: chest.y + 1, z: chest.z, role: 'planks' });
  assert.ok(whats(planFaults(lidded)).includes('a chest with a block over it will not open'));
  // A row of chests across the room: the back ones cannot be stood beside.
  const walled = storehouse(origin);
  for (const dx of [1, 2, 3]) walled.stages[1].cells.push({ x: origin.x + dx, y: origin.y, z: origin.z + 2, role: 'chest' });
  walled.chests.push(...[1, 2, 3].map((dx) => ({ x: origin.x + dx, y: origin.y, z: origin.z + 2 })));
  const found = whats(planFaults(walled));
  assert.ok(found.includes('a chest that cannot be stood beside') && found.includes('the middle of the floor cannot be walked to from the door'), found.join('; '));
  // A cell placed from too far away.
  const tall = storehouse(origin);
  tall.stages[2].cells.push({ x: origin.x + 2, y: origin.y + 9, z: origin.z + 2, role: 'planks' });
  assert.ok(whats(planFaults(tall)).includes('out of reach from where it is placed'));
  // The same cell twice.
  const twice = storehouse(origin);
  twice.stages[2].cells.push({ ...twice.stages[2].cells[0] });
  assert.ok(whats(planFaults(twice)).includes('a cell is used twice'));
});

test('the plan is read against the world: what is missing, in building order', () => {
  const plan = storehouse(origin);
  const world = new Map();
  const name = (cell) => world.get(`${cell.x},${cell.y},${cell.z}`) ?? 'air';
  assert.equal(planMissing(plan, name).length, 12 * 3 - 2 + 12 + 25 + 4 + 1);
  for (const stage of plan.stages) for (const cell of stage.cells) {
    world.set(`${cell.x},${cell.y},${cell.z}`, { planks: 'oak_planks', log: 'birch_log', chest: 'chest', torch: 'torch', door: 'oak_door' }[cell.role]);
  }
  assert.deepEqual(planMissing(plan, name), []);
  // A creeper takes a corner post and the block beside it: both are missing again, walls first.
  world.delete(`${origin.x},${origin.y},${origin.z}`);
  world.set(`${origin.x + 1},${origin.y},${origin.z}`, 'dirt');
  assert.deepEqual(planMissing(plan, name).map((c) => `${c.stage} ${c.role} ${c.x} ${c.z}`), [`walls log ${origin.x} ${origin.z}`, `walls planks ${origin.x + 1} ${origin.z}`]);
  assert.ok(ROLE.planks.test('spruce_planks') && !ROLE.planks.test('oak_log') && ROLE.door.test('birch_door'));
});
