// The planning half of the keys-and-mouse body. The screen positions are checked against a
// real screenshot of the game taken on 2026-10-03 (a 960 by 540 point window at interface
// scale 4), so a wrong offset here would have put a click on the wrong slot.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RECIPES, dropOf, heightAboveGround } from '../games/minecraft/common.mjs';
import { aim, bmpHeight, bmpPixel, canMake, clickPlan, counts, isPanelGrey, parseInventory, screenLayout, step, turn } from '../games/minecraft/hands_plan.mjs';

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

// A picture as the screen recorder writes it: 24 bits a pixel, rows stored bottom first,
// each row padded to a multiple of 4 bytes.
function bmp(rows) {
  const width = rows[0].length;
  const row = Math.ceil((width * 3) / 4) * 4;
  const buffer = Buffer.alloc(54 + row * rows.length);
  buffer.write('BM');
  buffer.writeUInt32LE(54, 10);
  buffer.writeInt32LE(width, 18);
  buffer.writeInt32LE(rows.length, 22);
  buffer.writeUInt16LE(24, 28);
  rows.forEach((pixels, y) => pixels.forEach(([r, g, b], x) => {
    const at = 54 + (rows.length - 1 - y) * row + x * 3;
    buffer[at] = b; buffer[at + 1] = g; buffer[at + 2] = r;
  }));
  return buffer;
}

test('a pixel is read from the right place in a picture', () => {
  const picture = bmp([
    [[1, 2, 3], [4, 5, 6], [7, 8, 9]],
    [[10, 11, 12], [13, 14, 15], [16, 17, 18]],
  ]);
  assert.equal(bmpHeight(picture), 2);
  assert.deepEqual(bmpPixel(picture, 0, 0), { r: 1, g: 2, b: 3 }, 'top left');
  assert.deepEqual(bmpPixel(picture, 2, 0), { r: 7, g: 8, b: 9 }, 'top right');
  assert.deepEqual(bmpPixel(picture, 0, 1), { r: 10, g: 11, b: 12 }, 'bottom left: a flipped picture would give the top row');
  assert.deepEqual(bmpPixel(picture, 2, 1), { r: 16, g: 17, b: 18 });
});

test('the inventory panel is told from the world behind it by its grey', () => {
  // Read off real pictures of the game on 2026-10-03, at the two ends of the strip below.
  assert.equal(isPanelGrey({ r: 198, g: 198, b: 198 }), true, 'inventory open, and crafting table open');
  assert.equal(isPanelGrey({ r: 25, g: 49, b: 12 }), false, 'forest, nothing open');
  assert.equal(isPanelGrey({ r: 63, g: 63, b: 63 }), false, 'a dark grey that is not the panel');
  assert.equal(isPanelGrey({ r: 176, g: 204, b: 255 }), false, 'sky');
  // The strip sits where those pictures were measured: pixel 624, 224 to 624, 848 of a
  // 1920 by 1080 picture is point 312, 112 to 312, 424.
  const { probe } = screenLayout({ x: 0, y: 0, width: 960, height: 540 }, 4);
  assert.deepEqual(probe, { x: 312, y: 112, width: 2, height: 314 });
  assert.ok(probe.y + probe.height - 1 >= 424 && probe.y + probe.height - 1 <= 426);
});

test('a trunk is told from a branch by how far the log stands above the ground', () => {
  // A small world, as columns of names from y 0 up. x 0: a trunk, 5 logs on dirt. x 1: a
  // branch log with leaves and air under it, 6 above the grass. x 2: the world not loaded.
  const columns = {
    0: ['stone', 'dirt', 'oak_log', 'oak_log', 'oak_log', 'oak_log', 'oak_log', 'oak_leaves'],
    1: ['stone', 'grass_block', 'air', 'air', 'air', 'air', 'oak_leaves', 'oak_leaves', 'oak_log'],
  };
  const blockAt = (x, y, z) => (z === 0 && columns[x] ? columns[x][y] ?? 'air' : null);
  assert.equal(heightAboveGround(blockAt, { x: 0, y: 2, z: 0 }), 0, 'the foot of the trunk');
  assert.equal(heightAboveGround(blockAt, { x: 0, y: 5, z: 0 }), 3, 'the fourth log up, still in reach from the ground');
  assert.equal(heightAboveGround(blockAt, { x: 0, y: 6, z: 0 }), 4, 'the fifth is out of reach');
  assert.equal(heightAboveGround(blockAt, { x: 1, y: 8, z: 0 }), 6, 'a branch counts from the forest floor, not from the leaves under it');
  assert.equal(heightAboveGround(blockAt, { x: 2, y: 5, z: 0 }), Infinity, 'nothing is known where the world is not loaded');
});

test('a dig is finished by what the block leaves behind', () => {
  assert.equal(dropOf('stone'), 'cobblestone');
  assert.equal(dropOf('iron_ore'), 'raw_iron');
  assert.equal(dropOf('coal_ore'), 'coal');
  assert.equal(dropOf('oak_log'), 'oak_log');
});
