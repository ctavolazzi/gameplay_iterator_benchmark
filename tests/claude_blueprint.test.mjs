import test from 'node:test';
import assert from 'node:assert/strict';

// BLUEPRINT lets a changed blueprint.mjs be checked beside the one the running player has loaded.
const { checkHall, hallPlan, keptWhole } = await import(process.env.BLUEPRINT ?? '../claude_player/blueprint.mjs');

const C = { x: -352, y: 59, z: 459 };
const key = ([x, y, z]) => `${x},${y},${z}`;

// A world built exactly to the plan: solid rock everywhere except what the plan digs out, the
// bedroom, and the open air over the top stair.
function built(plan, change = () => {}) {
  const air = new Set([...plan.interior, ...plan.entrance, ...plan.bedroomDoor, ...plan.stairs.flatMap((s) => s.clear)].map(key));
  for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) for (const dy of [0, 1]) air.add(key([C.x + dx, C.y + dy, C.z + dz]));
  const furniture = new Set();
  change({ air, furniture });
  return { open: (cell) => air.has(key(cell)) || furniture.has(key(cell)), solid: (cell) => !air.has(key(cell)) && !furniture.has(key(cell)), furniture: (cell) => furniture.has(key(cell)) };
}

test('the plan is a room 7 by 7 and 3 high east of the bedroom, with one way in from it and one from the stairs', () => {
  const plan = hallPlan(C, 8);
  assert.equal(plan.interior.length, 7 * 7 * 3);
  const xs = plan.interior.map(([x]) => x), zs = plan.interior.map(([, , z]) => z), ys = plan.interior.map(([, y]) => y);
  assert.deepEqual([Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys), Math.min(...zs), Math.max(...zs)], [-349, -343, 59, 61, 456, 462]);
  // The bedroom's doorway is the cell the bedroom's own code keeps open, and it meets the hall.
  assert.deepEqual(plan.bedroomDoor, [[-350, 59, 459], [-350, 60, 459]]);
  assert.deepEqual(plan.entrance, [[-346, 59, 463], [-346, 60, 463]]);
  // No way in is part of the shell, and nothing of the inside is.
  const shell = new Set(plan.shell.map(key));
  for (const cell of [...plan.bedroomDoor, ...plan.entrance, ...plan.interior]) assert.ok(!shell.has(key(cell)), `${cell} is in the shell`);
  // A floor, a ceiling and four walls: 2 * 49 + 4 * 21, less the four cells of the two ways in.
  assert.equal(plan.shell.length, 2 * 49 + 4 * 21 - 4);
  // The stairs go south from the entrance: one cell on the level, then up one for each one along.
  assert.deepEqual(plan.stairs[0].floor, [-346, 58, 464]);
  assert.deepEqual(plan.stairs[1].floor, [-346, 59, 465]);
  assert.deepEqual(plan.stairs[8].clear[2], [-346, 67, 472]);
  // Chests and torches stand inside, on the floor, and not in the row from the doorway to the entrance.
  const inside = new Set(plan.interior.map(key));
  for (const cell of [...plan.chests, ...plan.torches.slice(0, 4)]) { assert.ok(inside.has(key(cell))); assert.equal(cell[1], 59); }
  assert.ok(plan.chests.every(([x, , z]) => z === 456 && x !== -346));
});

test('built to the plan it has no faults, and every kind of fault is found', () => {
  const plan = hallPlan(C, 8);
  assert.deepEqual(checkHall(plan, built(plan)), []);
  // With the chests in, the floor under them is not a place to walk and that is no fault.
  const withChests = built(plan, ({ furniture }) => { for (const cell of plan.chests) furniture.add(key(cell)); });
  assert.deepEqual(checkHall(plan, withChests), []);
  // A block left in the middle of the floor.
  const blocked = checkHall(plan, built(plan, ({ air }) => air.delete(key([-346, 59, 459]))));
  assert.ok(blocked.some((f) => f.what === 'the inside is blocked'));
  // A hole in the ceiling.
  const holed = checkHall(plan, built(plan, ({ air }) => air.add(key([-346, 62, 459]))));
  assert.deepEqual(holed.map((f) => f.what), ['a gap in the shell']);
  // A stair with nothing under it: it cannot be stood on, and nothing above it can be reached.
  const gap = checkHall(plan, built(plan, ({ air }) => air.add(key(plan.stairs[3].floor))));
  assert.ok(gap.some((f) => f.what === 'stair 3 has nothing to stand on'));
  assert.ok(gap.some((f) => f.what === 'the top of the stairs cannot be walked to from the bedroom'));
  // A row of chests across the hall is climbed over: the hall is 3 high, where the bedroom is 2
  // and one chest there shut the player in on 2026-10-04. Two high, the row is a wall.
  const row = checkHall(plan, built(plan, ({ furniture }) => { for (let z = 456; z <= 462; z++) furniture.add(key([-347, 59, z])); }));
  assert.deepEqual(row, []);
  const walled = checkHall(plan, built(plan, ({ furniture }) => { for (let z = 456; z <= 462; z++) { furniture.add(key([-347, 59, z])); furniture.add(key([-347, 60, z])); } }));
  assert.ok(walled.some((f) => f.what === 'cannot be walked to from the bedroom'));
  assert.ok(walled.some((f) => f.what === 'the top of the stairs cannot be walked to from the bedroom'));
  // The entrance left closed.
  const shut = checkHall(plan, built(plan, ({ air }) => { air.delete(key(plan.entrance[0])); air.delete(key(plan.entrance[1])); }));
  assert.ok(shut.some((f) => f.what === 'the entrance is blocked'));
  assert.ok(shut.some((f) => f.what === 'the top of the stairs cannot be walked to from the bedroom'));
});

test('the shell and the blocks the stairs stand on are kept whole; the two ways in are not', () => {
  const plan = hallPlan(C, 8);
  const at = (x, y, z) => ({ x, y, z });
  assert.equal(keptWhole(plan, at(-346, 62, 459)), true);      // the ceiling
  assert.equal(keptWhole(plan, at(-342, 60, 459)), true);      // the east wall
  assert.equal(keptWhole(plan, at(-346, 59, 463)), false);     // the entrance
  assert.equal(keptWhole(plan, at(-350, 60, 459)), false);     // the bedroom's doorway
  assert.equal(keptWhole(plan, at(-346, 60, 466)), true);      // under the third stair
  assert.equal(keptWhole(plan, at(-346, 61, 466)), false);     // the air over it
  assert.equal(keptWhole(plan, at(-330, 60, 459)), false);     // rock that is none of the base's
});
