import test from 'node:test';
import assert from 'node:assert/strict';
import { diffCarried, fuelNeeded, parseAdvancement, summarize } from '../claude_player/pure.mjs';

test('an advancement is read from the game\'s own line, and only for this player', () => {
  assert.equal(parseAdvancement('Claude has made the advancement [Stone Age]', 'Claude'), 'Stone Age');
  assert.equal(parseAdvancement('Claude has completed the challenge [Adventuring Time]', 'Claude'), 'Adventuring Time');
  assert.equal(parseAdvancement('Claude has reached the goal [Sky\'s the Limit]', 'Claude'), 'Sky\'s the Limit');
  assert.equal(parseAdvancement('fogsift has made the advancement [Stone Age]', 'Claude'), null);
  // Someone typing the sentence in chat does not earn it.
  assert.equal(parseAdvancement('<fogsift> Claude has made the advancement [Stone Age]', 'Claude'), null);
  assert.equal(parseAdvancement('Claude joined the game', 'Claude'), null);
});

test('carried items are compared both ways', () => {
  assert.deepEqual(diffCarried({ oak_log: 3, stick: 2 }, { oak_log: 1, oak_planks: 8, stick: 2 }),
    { gained: { oak_planks: 8 }, lost: { oak_log: 2 } });
  assert.deepEqual(diffCarried({}, {}), { gained: {}, lost: {} });
});

test('fuel is counted up, never short', () => {
  assert.equal(fuelNeeded('coal', 1), 1);
  assert.equal(fuelNeeded('coal', 9), 2);
  assert.equal(fuelNeeded('oak_planks', 3), 2);
  assert.equal(fuelNeeded('oak_log', 1), 1);
  assert.equal(fuelNeeded('cobblestone', 1), null);
});

test('a journal is summed by skill, with the reasons for failure', () => {
  const summary = summarize([
    { kind: 'login' },
    { kind: 'skill', skill: 'collect', ok: true, ms: 4000 },
    { kind: 'skill', skill: 'collect', ok: false, ms: 2000, note: 'no log within reach' },
    { kind: 'skill', skill: 'collect', ok: false, ms: 1000, note: 'no log within reach' },
    { kind: 'damage', from: 20, to: 17.5 },
    { kind: 'death' },
    { kind: 'advancement', name: 'Stone Age' },
  ]);
  assert.deepEqual(summary.skills.collect, { ok: 1, failed: 2, seconds: 7, errors: { 'no log within reach': 2 } });
  assert.equal(summary.deaths, 1);
  assert.equal(summary.damage, 2.5);
  assert.deepEqual(summary.advancements, ['Stone Age']);
  assert.equal(summary.sessions, 1);
});

test('after a death the chest gives back what makes the player fit to go out', async () => {
  const { kitFrom } = await import('../claude_player/lib.mjs');
  // 09:05 on 2026-10-04: a wooden and a stone pickaxe and a stone sword in the pack; in the chest
  // 97 diamonds, the iron set, three hoes and some redstone.
  const have = { wooden_pickaxe: 1, stone_pickaxe: 1, stone_sword: 1, oak_log: 4 };
  const there = { diamond: 97, iron_helmet: 1, iron_chestplate: 1, iron_leggings: 1, iron_boots: 1, wooden_hoe: 3, redstone: 5, cooked_beef: 12 };
  const take = Object.fromEntries(kitFrom(have, there));
  assert.deepEqual(take, { iron_helmet: 1, iron_chestplate: 1, iron_leggings: 1, iron_boots: 1, diamond: 29, cooked_beef: 8 });
  // In full diamond with diamond tools and food, nothing is taken.
  const dressed = { diamond_pickaxe: 1, diamond_sword: 1, diamond_helmet: 1, diamond_chestplate: 1, diamond_leggings: 1, diamond_boots: 1, cooked_beef: 6 };
  assert.deepEqual(kitFrom(dressed, there), []);
  // Worse armour than it has on is left where it is, and diamonds are counted against what it carries.
  assert.deepEqual(Object.fromEntries(kitFrom({ ...dressed, diamond_pickaxe: 0, diamond: 1 }, { iron_chestplate: 1, diamond: 50, iron_pickaxe: 1 })), { iron_pickaxe: 1, diamond: 2 });
  // An empty chest gives nothing.
  assert.deepEqual(kitFrom(have, {}), []);
});

test('diamonds taken for armour are not spares: what the missing diamond things take is kept', async () => {
  const { diamondsWanted, kitFrom } = await import('../claude_player/lib.mjs');
  // 09:21:53 on 2026-10-04, after the kit: the iron set on, a diamond pickaxe, an iron sword.
  const dressed = { iron_helmet: 1, iron_chestplate: 1, iron_leggings: 1, iron_boots: 1, diamond_pickaxe: 1, iron_sword: 1 };
  assert.equal(diamondsWanted(dressed), 26);          // a sword and four pieces of armour
  assert.equal(diamondsWanted({ ...dressed, diamond_sword: 1, diamond_chestplate: 1 }), 16);
  // With those 26 on it, the chest is asked for no more; with 20, for the 6 it is short.
  assert.deepEqual(kitFrom({ ...dressed, diamond: 26 }, { diamond: 90 }), []);
  assert.deepEqual(kitFrom({ ...dressed, diamond: 20 }, { diamond: 90 }), [['diamond', 6]]);
});
