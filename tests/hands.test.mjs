// The planning half of the keys-and-mouse body. The screen positions are checked against a
// real screenshot of the game taken on 2026-10-03 (a 960 by 540 point window at interface
// scale 4), so a wrong offset here would have put a click on the wrong slot.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RECIPES } from '../games/minecraft/common.mjs';
import { aim, canMake, clickPlan, counts, parseInventory, screenLayout, step, turn } from '../games/minecraft/hands_plan.mjs';

const near = (a, b, tolerance = 0.01) => assert.ok(Math.abs(a - b) <= tolerance, `${a} is not within ${tolerance} of ${b}`);

test('aiming: the four compass points, up and down', () => {
  const feet = { x: 0, y: 64, z: 0 };
  const level = 64 + 1.62;
  near(aim(feet, { x: 0, y: level, z: 5 }).yaw, 0);        // south
  near(aim(feet, { x: -5, y: level, z: 0 }).yaw, 90);      // west
  near(Math.abs(aim(feet, { x: 0, y: level, z: -5 }).yaw), 180); // north
  near(aim(feet, { x: 5, y: level, z: 0 }).yaw, -90);      // east
  near(aim(feet, { x: 0, y: level, z: 5 }).pitch, 0);
  near(aim(feet, { x: 0, y: level - 5, z: 5 }).pitch, 45);   // looking down is positive
  near(aim(feet, { x: 0, y: level + 5, z: 5 }).pitch, -45);
});

test('turning takes the short way round, in steps', () => {
  assert.equal(turn(170, -170), 20);
  assert.equal(turn(-170, 170), -20);
  assert.equal(turn(0, 90), 90);
  assert.equal(step(0, 90, 30), 30);
  assert.equal(step(80, 90, 30), 90);
  assert.equal(step(170, -170, 12), 182);
});

test('the inventory the server prints is read slot by slot', () => {
  const printed = '[{count: 3, Slot: 0b, id: "minecraft:oak_log"}, {count: 1, Slot: 8b, components: {"minecraft:damage": 4}, id: "minecraft:wooden_pickaxe"}, {count: 12, Slot: 9b, id: "minecraft:oak_planks"}, {count: 2, Slot: 35b, id: "minecraft:stick"}]';
  const slots = parseInventory(printed);
  assert.deepEqual(slots, [
    { slot: 0, item: 'oak_log', count: 3 },
    { slot: 8, item: 'wooden_pickaxe', count: 1 },
    { slot: 9, item: 'oak_planks', count: 12 },
    { slot: 35, item: 'stick', count: 2 },
  ]);
  assert.deepEqual(counts(slots), { oak_log: 3, wooden_pickaxe: 1, oak_planks: 12, stick: 2 });
  assert.deepEqual(parseInventory('[]'), []);
});

test('screen positions match the real screenshot', () => {
  // The window's inside was 960 by 540 points; put its corner at 0, 0.
  const layout = screenLayout({ x: 0, y: 0, width: 960, height: 540 }, 4);
  // In the screenshot (1920 by 1080 pixels, 2 to a point) the first slot of the top carried
  // row began at pixel 640, 544 and was 64 wide, so its middle is point 336, 288.
  assert.deepEqual(layout.slot(9), { x: 336, y: 288 });
  // The hotbar row began at pixel y 776: middle 808, point 404.
  assert.deepEqual(layout.slot(0), { x: 336, y: 404 });
  assert.deepEqual(layout.slot(8), { x: 336 + 8 * 36, y: 404 });
  // The 2 by 2 grid began at pixel 1000, 280; the result slot at 1224, 320.
  assert.deepEqual(layout.grid(false, 0, 0), { x: 516, y: 156 });
  assert.deepEqual(layout.grid(false, 1, 1), { x: 552, y: 192 });
  assert.deepEqual(layout.result(false), { x: 628, y: 176 });
  assert.deepEqual(layout.centre, { x: 480, y: 270 });
  // The pointer sat at the centre in that screenshot and the fifth slot of the top row was
  // lit, so the centre must fall in that slot's column.
  assert.ok(Math.abs(layout.slot(9 + 4).x - layout.centre.x) <= 18);
  // A window somewhere else on screen moves every point with it.
  assert.deepEqual(screenLayout({ x: 240, y: 180, width: 960, height: 540 }).slot(9), { x: 576, y: 468 });
});

test('the clicks for planks, sticks, a table and a pickaxe', () => {
  const logs = [{ slot: 0, item: 'oak_log', count: 3 }];
  assert.deepEqual(clickPlan(RECIPES.planks, logs), [
    { click: 'left', on: 'slot', index: 0 },
    { click: 'right', on: 'grid', column: 0, row: 0 },
    { click: 'left', on: 'slot', index: 0 },           // put the other two logs back
    { click: 'left', on: 'result', shift: true },
  ]);
  const planks = [{ slot: 8, item: 'oak_planks', count: 12 }];
  assert.deepEqual(clickPlan(RECIPES.stick, planks).map((c) => `${c.click} ${c.on} ${c.column ?? c.index ?? ''},${c.row ?? ''}`), [
    'left slot 8,', 'right grid 0,0', 'right grid 0,1', 'left slot 8,', 'left result ,',
  ]);
  assert.equal(clickPlan(RECIPES.crafting_table, planks).filter((c) => c.on === 'grid').length, 4);
  const forPick = [{ slot: 8, item: 'oak_planks', count: 3 }, { slot: 7, item: 'stick', count: 4 }];
  const pick = clickPlan(RECIPES.wooden_pickaxe, forPick);
  assert.deepEqual(pick.filter((c) => c.on === 'grid').map((c) => [c.column, c.row]), [[0, 0], [1, 0], [2, 0], [1, 1], [1, 2]]);
  // Exactly 3 planks: all three go in the grid and nothing is left to put back.
  assert.equal(pick.filter((c) => c.on === 'slot' && c.index === 8).length, 1);
});

test('a recipe is refused when what is carried is not enough', () => {
  assert.equal(clickPlan(RECIPES.crafting_table, [{ slot: 0, item: 'oak_planks', count: 3 }]), null);
  assert.equal(clickPlan(RECIPES.stone_pickaxe, [{ slot: 0, item: 'cobblestone', count: 3 }]), null, 'no sticks');
  assert.equal(canMake(RECIPES.wooden_pickaxe, [{ slot: 0, item: 'oak_planks', count: 3 }, { slot: 1, item: 'stick', count: 2 }], false), false, 'no table near');
  assert.equal(canMake(RECIPES.wooden_pickaxe, [{ slot: 0, item: 'oak_planks', count: 3 }, { slot: 1, item: 'stick', count: 2 }], true), true);
});

test('planks of two kinds can be used together', () => {
  const mixed = [{ slot: 0, item: 'oak_planks', count: 2 }, { slot: 1, item: 'birch_planks', count: 2 }];
  const plan = clickPlan(RECIPES.crafting_table, mixed);
  assert.equal(plan.filter((c) => c.on === 'grid').length, 4);
  assert.deepEqual(plan.filter((c) => c.on === 'slot').map((c) => c.index), [0, 1]);
});
