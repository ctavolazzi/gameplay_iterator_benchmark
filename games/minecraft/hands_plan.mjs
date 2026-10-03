// The thinking part of playing through the real game window, kept apart from the part that
// presses keys so it can be tested without a game: where to look, where on the screen each
// inventory slot is, what the player carries, and which clicks make a recipe.

import { fits, needs } from './common.mjs';

const EYE_HEIGHT = 1.62;

// Minecraft's angles, in degrees. Yaw 0 faces south (+z), 90 west (-x), 180 north, -90
// east. Pitch is positive looking down. from is where the feet are.
export function aim(from, target) {
  const dx = target.x - from.x;
  const dy = target.y - (from.y + EYE_HEIGHT);
  const dz = target.z - from.z;
  const flat = Math.hypot(dx, dz);
  return {
    yaw: (-Math.atan2(dx, dz) * 180) / Math.PI,
    pitch: (-Math.atan2(dy, flat) * 180) / Math.PI,
  };
}

// The shortest way round from one yaw to another, as a signed number of degrees.
export function turn(from, to) {
  return ((((to - from) % 360) + 540) % 360) - 180;
}

// One step of a turn, no more than limit degrees, so the camera sweeps and does not snap.
export function step(from, to, limit) {
  const delta = turn(from, to);
  return Math.abs(delta) <= limit ? to : from + Math.sign(delta) * limit;
}

// What the server prints for `data get entity <player> Inventory`, as a list of slots.
// Slots 0 to 8 are the hotbar, 9 to 35 the three rows above it.
export function parseInventory(text) {
  const slots = [];
  const entry = /\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}/g;
  for (const [body] of text.matchAll(entry)) {
    const slot = body.match(/Slot:\s*(-?\d+)b/);
    const id = body.match(/id:\s*"minecraft:([a-z0-9_]+)"/);
    const count = body.match(/count:\s*(\d+)/);
    if (slot && id) slots.push({ slot: Number(slot[1]), item: id[1], count: count ? Number(count[1]) : 1 });
  }
  return slots.filter((s) => s.slot >= 0 && s.slot <= 35).sort((a, b) => a.slot - b.slot);
}

export function counts(slots) {
  const out = {};
  for (const s of slots) out[s.item] = (out[s.item] ?? 0) + s.count;
  return out;
}

// Where things are on screen. The inventory and the crafting table are both a panel 176 by
// 166 interface pixels, centred in the window. An interface pixel is guiScale screen
// pixels, and this display has 2 screen pixels to a point, so it is guiScale / 2 points.
// content is the inside of the game window in screen points: { x, y, width, height }.
export function screenLayout(content, guiScale = 4) {
  const unit = guiScale / 2;
  const left = (content.width / unit - 176) / 2;
  const top = (content.height / unit - 166) / 2;
  const at = (gx, gy) => ({ x: content.x + (left + gx) * unit, y: content.y + (top + gy) * unit });
  return {
    centre: { x: content.x + content.width / 2, y: content.y + content.height / 2 },
    // A carried slot, 0 to 35. The same place in the inventory and the crafting table.
    slot(index) {
      if (index < 9) return at(8 + 18 * index + 8, 142 + 8);
      const i = index - 9;
      return at(8 + 18 * (i % 9) + 8, 84 + 18 * Math.floor(i / 9) + 8);
    },
    // A cell of the crafting grid: 2 by 2 in the inventory, 3 by 3 at a table.
    grid(table, column, row) {
      return table ? at(30 + 18 * column + 8, 17 + 18 * row + 8) : at(98 + 18 * column + 8, 18 + 18 * row + 8);
    },
    result(table) {
      return table ? at(124 + 8, 35 + 8) : at(154 + 8, 28 + 8);
    },
    // A thin strip of screen down the panel's left side, just inside its border. When the
    // inventory or the crafting table is showing, both ends of it are the panel's plain grey.
    probe: { x: at(4, 4).x, y: at(4, 4).y, width: 2, height: 156 * unit + 2 },
  };
}

// One pixel of an uncompressed BMP picture, as { r, g, b }. x and y count from the top left.
export function bmpPixel(buffer, x, y) {
  const start = buffer.readUInt32LE(10);
  const width = buffer.readInt32LE(18);
  const tall = buffer.readInt32LE(22);          // above zero: the rows are stored bottom first
  const bytes = buffer.readUInt16LE(28) / 8;
  const row = Math.ceil((width * bytes) / 4) * 4;
  const line = tall > 0 ? tall - 1 - y : y;
  const at = start + line * row + x * bytes;
  return { r: buffer[at + 2], g: buffer[at + 1], b: buffer[at] };
}

export const bmpHeight = (buffer) => Math.abs(buffer.readInt32LE(22));

// The inventory and the crafting table are drawn on a light grey panel. Read off real
// pictures of both on 2026-10-03, its plain grey is exactly 198, 198, 198; the forest behind
// was 25, 49, 12 with no screen open.
export function isPanelGrey({ r, g, b }) {
  return [r, g, b].every((v) => Math.abs(v - 198) <= 6);
}

// The clicks that make a recipe once, as a person would do them: pick a stack up, put one
// in each cell that needs it with the right button, put the rest back, then shift-click
// the result. Returns null when what is carried is not enough.
//   { click: 'left' | 'right', on: 'slot' | 'grid' | 'result', index | column,row, shift }
export function clickPlan(recipe, slots) {
  const cells = [];
  recipe.grid.forEach((row, r) => row.forEach((ingredient, c) => { if (ingredient) cells.push({ ingredient, column: c, row: r }); }));
  const left = slots.map((s) => ({ ...s }));
  const plan = [];
  for (const ingredient of Object.keys(needs(recipe))) {
    let waiting = cells.filter((cell) => cell.ingredient === ingredient);
    const stacks = left.filter((s) => fits(ingredient, s.item) && s.count > 0).sort((a, b) => b.count - a.count);
    for (const stack of stacks) {
      if (!waiting.length) break;
      const take = Math.min(stack.count, waiting.length);
      plan.push({ click: 'left', on: 'slot', index: stack.slot });
      for (const cell of waiting.slice(0, take)) plan.push({ click: 'right', on: 'grid', column: cell.column, row: cell.row });
      if (stack.count > take) plan.push({ click: 'left', on: 'slot', index: stack.slot });
      stack.count -= take;
      waiting = waiting.slice(take);
    }
    if (waiting.length) return null;
  }
  plan.push({ click: 'left', on: 'result', shift: true });
  return plan;
}

// Can this recipe be made from what is carried? tableNear says whether a crafting table is
// close enough to use.
export function canMake(recipe, slots, tableNear) {
  if (recipe.table && !tableNear) return false;
  return clickPlan(recipe, slots) !== null;
}
