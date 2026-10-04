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
