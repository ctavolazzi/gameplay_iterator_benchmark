import test from 'node:test';
import assert from 'node:assert/strict';
const { ripe } = await import('../claude_player/skills/tend.mjs');

test('a crop is cut when it is at its last age, and not before', () => {
  assert.equal(ripe('wheat', 7), true);
  assert.equal(ripe('wheat', '7'), true, 'the game gives the age as text');
  assert.equal(ripe('wheat', 6), false);
  assert.equal(ripe('wheat', 0), false);
  assert.equal(ripe('beetroots', 3), true);
  assert.equal(ripe('beetroots', 2), false);
  assert.equal(ripe('carrots', 7), true);
  assert.equal(ripe('potatoes', 5), false);
  // What is not a crop is never ripe: grass on the path, a torch, air.
  for (const name of ['short_grass', 'torch', 'air', 'farmland', undefined]) assert.equal(ripe(name, 7), false, String(name));
  assert.equal(ripe('wheat', undefined), false);
});
