import test from 'node:test';
import assert from 'node:assert/strict';
import { hasTool, leaves, pickFuel, plan, signature } from '../claude_player/planner.mjs';

// A small recipe book in the shape the game's own is handed to the planner.
const woods = (make) => ['oak', 'birch'].map(make);
const BOOK = {
  oak_planks: [{ uses: { oak_log: 1 }, makes: 4, table: false }],
  birch_planks: [{ uses: { birch_log: 1 }, makes: 4, table: false }],
  // The order the live game lists them in (probed 2026-10-03): bamboo planks before oak.
  stick: [{ uses: { bamboo_planks: 2 }, makes: 4, table: false }, ...woods((w) => ({ uses: { [`${w}_planks`]: 2 }, makes: 4, table: false })), { uses: { bamboo: 2 }, makes: 1, table: false }],
  bamboo_planks: [{ uses: { bamboo_block: 1 }, makes: 2, table: false }],
  crafting_table: woods((w) => ({ uses: { [`${w}_planks`]: 4 }, makes: 1, table: false })),
  wooden_pickaxe: woods((w) => ({ uses: { [`${w}_planks`]: 3, stick: 2 }, makes: 1, table: true })),
  stone_pickaxe: ['blackstone', 'cobbled_deepslate', 'cobblestone'].map((s) => ({ uses: { [s]: 3, stick: 2 }, makes: 1, table: true })),
  furnace: [{ uses: { cobblestone: 8 }, makes: 1, table: true }],
  iron_pickaxe: [{ uses: { iron_ingot: 3, stick: 2 }, makes: 1, table: true }],
};
const DROPS = { stone: 'cobblestone', iron_ore: 'raw_iron', coal_ore: 'coal', log: 'oak_log' };

const IN_SIGHT = ['oak_log', 'log', 'stone', 'coal_ore', 'iron_ore'];
const world = (over = {}) => ({ have: {}, wood: 'oak', recipes: (name) => BOOK[name] ?? [], sees: (block) => IN_SIGHT.includes(block), creatures: [],
  near: { crafting_table: false, furnace: false }, night: false, exposed: true, y: 70, surfaceY: 64, blocked: () => false, ...over });

// Do what a step says to a made-up world, refusing anything the game would refuse.
function act(step, w) {
  const a = step.args;
  const take = (name, n) => { assert.ok((w.have[name] ?? 0) >= n, `${step.skill} needs ${n} ${name}, have ${w.have[name] ?? 0}`); w.have[name] -= n; };
  const give = (name, n) => { w.have[name] = (w.have[name] ?? 0) + n; };
  if (step.skill === 'collect') give(DROPS[a.block] ?? a.block, a.count);
  else if (step.skill === 'craft') {
    const recipe = BOOK[a.item].find((r) => Object.entries(r.uses).every(([name, n]) => (w.have[name] ?? 0) >= n * a.times));
    assert.ok(recipe, `asked to craft ${a.times} ${a.item} without the ingredients: ${JSON.stringify(w.have)}`);
    assert.ok(!recipe.table || w.near.crafting_table, `asked to craft ${a.item} with no crafting table near`);
    for (const [name, n] of Object.entries(recipe.uses)) take(name, n * a.times);
    give(a.item, recipe.makes * a.times);
  } else if (step.skill === 'place') { take(a.item, 1); w.near[a.item] = true; }
  else if (step.skill === 'smelt') {
    assert.ok(w.near.furnace, 'asked to smelt with no furnace near');
    take(a.input, a.count);
    take(a.fuel, a.fuel === 'coal' ? Math.ceil(a.count / 8) : Math.ceil(a.count / 1.5));
    give('iron_ingot', a.count);
  }
}

// Ask, act, ask again, until the item is had or the steps run out.
function play(item, w, most = 60) {
  const steps = [];
  for (let i = 0; i < most; i++) {
    const step = plan(item, 1, w);
    if (!step) return { done: true, steps };
    if (step.stuck) return { done: false, stuck: step.stuck, steps };
    steps.push(`${step.skill}:${step.args.block ?? step.args.item ?? step.args.input ?? ''}`);
    act(step, w);
  }
  return { done: false, steps };
}

test('from empty hands the first step toward a pickaxe is a log', () => {
  const step = plan('wooden_pickaxe', 1, world());
  assert.equal(step.skill, 'collect');
  assert.equal(step.args.block, 'oak_log');
  assert.match(step.why, /oak_log for oak_planks for wooden_pickaxe/);
});

test('played out step by step, empty hands reach an iron pickaxe', () => {
  const w = world();
  const run = play('iron_pickaxe', w);
  assert.ok(run.done, `did not finish: ${run.stuck ?? 'out of steps'} after ${run.steps.join(' ')}`);
  assert.equal(w.have.iron_pickaxe, 1);
  assert.ok(run.steps.includes('smelt:raw_iron'));
  assert.ok(run.steps.indexOf('craft:wooden_pickaxe') < run.steps.indexOf('collect:stone'), 'stone before a pickaxe to dig it');
  assert.ok(run.steps.indexOf('craft:stone_pickaxe') < run.steps.indexOf('collect:iron_ore'), 'iron before a stone pickaxe');
  assert.ok(!run.steps.includes('collect:deepslate'), 'stone in sight is used, not deepslate that has to be dug down to');
  assert.ok(run.steps.filter((step) => step === 'collect:oak_log').length <= 2, `one trip per log: ${run.steps.join(' ')}`);
  assert.ok(run.steps.length < 30, `took ${run.steps.length} steps`);
});

test('the play-through can fail: with nothing in sight it only looks around', () => {
  const run = play('iron_pickaxe', world({ sees: () => false }), 12);
  assert.equal(run.done, false);
  assert.ok(run.steps.every((step) => step === 'explore:'), run.steps.join(' '));
});

test('wood waits for morning, and stone does not', () => {
  assert.match(plan('wooden_pickaxe', 1, world({ night: true })).stuck, /morning/);
  const dig = plan('furnace', 1, world({ night: true, exposed: false, y: 50, have: { stone_pickaxe: 1 } }));
  assert.equal(dig.skill, 'collect');
  assert.equal(dig.args.block, 'stone');
});

test('the reason given for being stuck is the best recipe\'s, not bamboo\'s', () => {
  assert.match(plan('stick', 2, world({ night: true })).stuck, /morning/);
});

test('wood wanted from under ground means climbing out first', () => {
  const step = plan('wooden_pickaxe', 1, world({ exposed: false, y: 30 }));
  assert.equal(step.skill, 'surface');
});

test('a step that keeps failing is passed over for the next way', () => {
  const blocked = (step) => step.skill === 'collect';
  const deep = plan('iron_ingot', 1, world({ have: { stone_pickaxe: 1 }, blocked, y: 70 }));
  assert.equal(deep.skill, 'descend');
  assert.equal(deep.args.toY, 46);
  const there = plan('iron_ingot', 1, world({ have: { stone_pickaxe: 1 }, blocked, y: 18 }));
  assert.equal(there.skill, 'explore');
});

test('a recipe in stone that is carried is chosen over one that is not', () => {
  const have = { cobbled_deepslate: 3, stick: 2 };
  const step = plan('stone_pickaxe', 1, world({ have, near: { crafting_table: true, furnace: false } }));
  assert.equal(step.skill, 'craft');
  assert.equal(step.args.item, 'stone_pickaxe');
});

test('tools count at their tier or better', () => {
  assert.equal(hasTool({ iron_pickaxe: 1 }, 'wooden_pickaxe'), true);
  assert.equal(hasTool({ wooden_pickaxe: 1 }, 'stone_pickaxe'), false);
  assert.equal(hasTool({ stone_sword: 1 }, 'stone_pickaxe'), false);
});

test('fuel is coal first, then enough wood, else none', () => {
  assert.equal(pickFuel({ coal: 1, oak_planks: 8 }, 8), 'coal');
  assert.equal(pickFuel({ oak_planks: 2 }, 3), 'oak_planks');
  assert.equal(pickFuel({ oak_planks: 1 }, 3), null);
});

test('a failing step is remembered by what it was after, not how many', () => {
  assert.equal(signature({ skill: 'collect', args: { block: 'stone', count: 3 } }), signature({ skill: 'collect', args: { block: 'stone', count: 8 } }));
  assert.notEqual(signature({ skill: 'explore', args: { direction: 'north' } }), signature({ skill: 'explore', args: { direction: 'east' } }));
});

test('a table or furnace is picked up only before a step that really leaves', () => {
  // What the first version did wrong, from the journal: coal dug 5 blocks from the furnace.
  assert.equal(leaves({ skill: 'collect', args: { block: 'coal_ore' } }, 5), false);
  assert.equal(leaves({ skill: 'collect', args: { block: 'iron_ore' } }, 30), true);
  assert.equal(leaves({ skill: 'collect', args: { block: 'iron_ore' } }, null), false);
  for (const skill of ['craft', 'smelt', 'place', 'wear', 'sleep', 'build_base', 'take_back']) assert.equal(leaves({ skill, args: {} }), false, skill);
  for (const skill of ['explore', 'goto', 'descend', 'surface', 'hunt', 'recover']) assert.equal(leaves({ skill, args: {} }), true, skill);
});
