import test from 'node:test';
import assert from 'node:assert/strict';
// REFLEXES lets a changed reflexes.mjs be checked beside the one the running player has loaded.
const { decide, pickWay } = await import(process.env.REFLEXES ?? '../claude_player/reflexes.mjs');
import { reaches, shutIn } from '../claude_player/pure.mjs';

// What the player senses on a quiet afternoon above ground, with a sword. Each test changes
// only what its situation needs. The situations are the ones in claude_player/NOTES.md that
// killed the player or stopped it, with the death's number.
const senses = (over = {}) => ({ now: 100000, health: 20, food: 20, breath: 20, underWater: false, night: false,
  exposed: true, enclosed: false, busy: null, armed: true, shielded: false, canEat: true, foe: null, archer: null,
  fightTarget: null, pass: {}, where: { x: 0, y: 64, z: 0 }, ...over });
const zombie = (distance, more = {}) => ({ id: 7, name: 'zombie', distance, visible: true, ...more });
const kinds = (out) => out.events.map(([kind]) => kind);

test('death 1: a zombie in reach while a skill runs stops the skill and is fought', () => {
  const out = decide(senses({ night: false, busy: 'collect', foe: zombie(2.4) }), {});
  assert.equal(out.act.kind, 'fight');
  assert.equal(out.interrupt, 'fighting a zombie');
  assert.ok(kinds(out).includes('fight'));
});

test('deaths 13 to 20: with no sword or axe it runs, from 10 blocks off, and never fights', () => {
  const far = decide(senses({ armed: false, foe: zombie(9.5), busy: 'goto' }), {});
  assert.equal(far.act.kind, 'run');
  assert.equal(far.interrupt, 'backing away from a zombie');
  const close = decide(senses({ armed: false, foe: zombie(2) }), {});
  assert.equal(close.act.kind, 'run');
  assert.notEqual(decide(senses({ armed: false, foe: zombie(11) }), {}).act.kind, 'run');
});

test('death 10: at night in the open with a zombie 5 blocks off it fights and does not dig in', () => {
  const out = decide(senses({ night: true, foe: zombie(5.4) }), {});
  assert.equal(out.act.kind, 'fight');
  // The same night with nothing near: into the ground.
  assert.equal(decide(senses({ night: true }), {}).act.kind, 'dig_in');
  // Something hostile within 8 blocks that cannot be seen yet: neither dug in beside nor fought.
  assert.equal(decide(senses({ night: true, foe: zombie(7, { visible: false }) }), {}).act.kind, 'none');
});

test('death 11: a pass for being brave does not cover a creeper', () => {
  const creeper = { id: 9, name: 'creeper', distance: 5, visible: true };
  const out = decide(senses({ pass: { brave: true, night: true }, foe: creeper, busy: 'recover' }), {});
  assert.equal(out.act.kind, 'run');
  assert.match(out.interrupt, /creeper/);
  // The same pass does let it walk past a zombie unarmed, which is what it was for.
  assert.notEqual(decide(senses({ pass: { brave: true }, armed: false, foe: zombie(6) }), {}).act.kind, 'run');
  // And a creeper is never fought, sword or not.
  assert.notEqual(decide(senses({ foe: { ...creeper, distance: 7 } }), {}).act.kind, 'fight');
});

test('death 21: a fight with no hit landed for 6 s is given up, run from, and the place marked', () => {
  const fight = { id: 7, name: 'cave_spider', started: 90000, hits: 0 };
  const out = decide(senses({ foe: { ...zombie(2), name: 'cave_spider' }, fightTarget: { distance: 2 } }), { fight, seen: { 7: 1 } });
  assert.ok(kinds(out).includes('fight_given_up'));
  assert.equal(out.set.fight, null);
  assert.ok(out.set.fleeing > 100000);
  assert.equal(out.danger.r, 28);
  // A fight that landed a hit 2 s ago goes on.
  const going = decide(senses({ foe: zombie(2), fightTarget: { distance: 2 } }), { fight: { ...fight, hits: 3, lastHitAt: 98000 }, seen: { 7: 1 } });
  assert.equal(going.act.kind, 'fight');
});

test('deaths 4, 7, 9, 12: out of breath under water comes before everything', () => {
  const out = decide(senses({ breath: 5, underWater: true, busy: 'collect', foe: zombie(2) }), {});
  assert.equal(out.act.kind, 'surface');
  assert.equal(out.interrupt, 'out of breath');
  // The reading stays low after a drowning death: out of the water it means nothing.
  assert.notEqual(decide(senses({ breath: 5, underWater: false }), {}).act.kind, 'surface');
  // Once started it goes on until the breath is back, not just over the line.
  assert.equal(decide(senses({ breath: 12, underWater: true }), { surfacing: 95000 }).act.kind, 'surface');
});

test('a pass for the night holds off the dig-in, and only that', () => {
  assert.equal(decide(senses({ night: true, pass: { night: true }, busy: 'goto' }), {}).act.kind, 'none');
  assert.equal(decide(senses({ night: true, pass: { night: true }, busy: 'goto' }), {}).interrupt, null);
  assert.equal(decide(senses({ night: true, busy: 'goto' }), {}).interrupt, 'night: digging in');
  // A failed try waits before the next.
  assert.equal(decide(senses({ night: true }), { nextDigIn: 200000 }).act.kind, 'none');
});

test('following a person at night it does not dig in: the one who leads decides', () => {
  assert.equal(decide(senses({ night: true, busy: 'follow' }), {}).act.kind, 'none');
  assert.equal(decide(senses({ night: true, busy: 'follow' }), {}).interrupt, null);
  // It still fights what comes close, and still runs from a creeper.
  assert.equal(decide(senses({ night: true, busy: 'follow', foe: zombie(2) }), {}).act.kind, 'fight');
  assert.equal(decide(senses({ night: true, busy: 'follow', foe: { id: 9, name: 'creeper', distance: 4, visible: true } }), {}).act.kind, 'run');
  // Any other step at night is still stopped for the dig-in.
  assert.equal(decide(senses({ night: true, busy: 'explore' }), {}).interrupt, 'night: digging in');
});

test('closed in at night nothing outside is fought, and the shelter is noted once', () => {
  const first = decide(senses({ night: true, exposed: false, enclosed: true, foe: zombie(2) }), {});
  assert.equal(first.act.kind, 'none');
  assert.deepEqual(kinds(first).filter((kind) => kind === 'sheltered'), ['sheltered']);
  const again = decide(senses({ night: true, exposed: false, enclosed: true, foe: zombie(2) }), { sheltered: true, seen: { 7: 1 } });
  assert.deepEqual(kinds(again), []);
});

test('the shield goes up against a skeleton that is seen and out of reach, and comes down to fight', () => {
  const skeleton = { id: 4, name: 'skeleton', distance: 12, visible: true };
  const up = decide(senses({ shielded: true, archer: skeleton, foe: skeleton }), {});
  assert.equal(up.shield, 'up');
  assert.ok(kinds(up).includes('shield_up'));
  // Behind a wall, or with no shield, nothing.
  assert.equal(decide(senses({ shielded: true, archer: { ...skeleton, visible: false } }), {}).shield, null);
  assert.equal(decide(senses({ shielded: false, archer: skeleton }), {}).shield, null);
  // Gone again: the shield comes down.
  assert.equal(decide(senses({ shielded: true, archer: null }), { blocking: true }).shield, 'down');
});

test('it eats when hungry and idle, stops a skill only when starving, and never without food', () => {
  assert.equal(decide(senses({ food: 12 }), {}).act.kind, 'eat');
  assert.equal(decide(senses({ food: 17, health: 9 }), {}).act.kind, 'eat');
  assert.equal(decide(senses({ food: 12, busy: 'collect' }), {}).act.kind, 'none');
  assert.equal(decide(senses({ food: 5, busy: 'collect' }), {}).interrupt, 'starving');
  assert.equal(decide(senses({ food: 5, canEat: false }), {}).act.kind, 'none');
  assert.equal(decide(senses({ food: 12 }), { lastEat: 98000 }).act.kind, 'none');
});

test('a fight ends when the one fought is gone, and the walk after it is cleared', () => {
  const out = decide(senses({ fightTarget: null }), { fight: { id: 7, name: 'zombie', started: 96000, hits: 4, lastHitAt: 99000 } });
  assert.ok(kinds(out).includes('fight_over'));
  assert.equal(out.set.fight, null);
  assert.equal(out.flags.clearGoal, true);
});

test('turn 13: a chest beside the bed shuts the corner off from the doorway, and the check sees it', () => {
  // The room is 3 by 3, the doorway at 2,0. The bed lies on 0,1 and 1,1; table and furnaces on the north wall.
  const room = (taken) => new Set(['-1,0', '0,0', '1,0', '-1,1', '2,0'].filter((cell) => !taken.includes(cell)));
  assert.deepEqual(shutIn(room([]), [2, 0]), []);
  // The chest at -1,0: the corner at -1,1 is where the game stands a waking player.
  assert.deepEqual(shutIn(room(['-1,0']), [2, 0]), [[-1, 1]]);
  assert.equal(reaches(room([]), [-1, 1], [2, 0]), true);
  assert.equal(reaches(room(['0,0']), [-1, 1], [2, 0]), false);
});

test('death 22: it runs only where there is room, and a fall or a wall is not room', () => {
  // Straight away from the creeper was its own mine shaft, 32 blocks deep, one step off; a sixth of a turn aside was open.
  assert.equal(pickWay([0, 4, 4, 2, 4]), 1);
  assert.equal(pickWay([4, 0, 0, 0, 0]), 0);
  // Two blocks to a wall is not a way; three is.
  assert.equal(pickWay([2, 3, 4, 4, 4]), 1);
  // In a pit, or on a pillar: no way at all.
  assert.equal(pickWay([1, 0, 2, 0, 1]), -1);
});

test('death 23: cornered with a sword in hand it fights the creeper, and with room it still runs', () => {
  const creeper = (distance) => ({ id: 9, name: 'creeper', distance, visible: true });
  // 09:20:57 on 2026-10-04: a creeper 3.2 blocks off in the pit by its own doorway, a stone sword in the pack.
  const pit = decide(senses({ armed: true, cornered: true, foe: creeper(3.2), busy: 'goto' }), {});
  assert.equal(pit.act.kind, 'fight');
  assert.equal(pit.interrupt, 'fighting a creeper');
  assert.equal(pit.set.fleeing, 0);
  // It was already running when the walls closed in: the run is dropped for the fight.
  assert.equal(decide(senses({ armed: true, cornered: true, foe: creeper(2.5) }), { fleeing: 105000 }).act.kind, 'fight');
  // With room to run, a creeper is still run from, sword or not.
  assert.equal(decide(senses({ armed: true, cornered: false, foe: creeper(3.2) }), {}).act.kind, 'run');
  // Cornered with nothing in hand there is no fight to have: it makes what way it can.
  assert.equal(decide(senses({ armed: false, cornered: true, foe: creeper(3.2) }), {}).act.kind, 'run');
  // A creeper 9 blocks off is not yet a reason for either.
  assert.equal(decide(senses({ armed: true, cornered: true, foe: creeper(9) }), {}).act.kind, 'none');
});
