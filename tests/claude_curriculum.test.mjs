import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';

// CURRICULUM lets a changed curriculum.mjs be checked beside the one the running player has loaded.
const { itemsFor, next, requests, summary, survey } = await import(process.env.CURRICULUM ?? '../claude_player/curriculum.mjs');

// A small tree in the game's own shape: a few of the real advancements and what each asks for.
const item = (name, ...items) => ({ name, trigger: 'inventory_changed', items });
const one = (id, title, parent, criteria, more = {}) => ({ id, tab: id.split('/')[0], title, description: `${title}, described`, parent, hidden: false,
  criteria, groups: more.groups ?? criteria.map((c) => [c.name]), ...more });
const TREE = [
  one('story/root', 'Minecraft', null, [item('table', 'crafting_table')]),
  one('story/mine_stone', 'Stone Age', 'story/root', [item('stone', '#stone_tool_materials')]),
  one('story/smelt_iron', 'Acquire Hardware', 'story/mine_stone', [item('iron', 'iron_ingot')]),
  one('story/lava_bucket', 'Hot Stuff', 'story/smelt_iron', [item('lava_bucket', 'lava_bucket')]),
  one('story/form_obsidian', 'Ice Bucket Challenge', 'story/lava_bucket', [item('obsidian', 'obsidian')]),
  one('husbandry/root', 'Husbandry', null, [{ name: 'ate', trigger: 'consume_item', items: null }]),
  one('husbandry/tame_an_animal', 'Best Friends Forever', 'husbandry/root', [{ name: 'tamed', trigger: 'tame_animal', items: null }]),
  one('husbandry/breed_an_animal', 'The Parrots and the Bats', 'husbandry/root', [{ name: 'bred', trigger: 'bred_animals', items: null }]),
  one('husbandry/froglights', 'With Our Powers Combined!', 'husbandry/root', [item('ochre', 'ochre_froglight'), item('pearl', 'pearlescent_froglight'), item('verdant', 'verdant_froglight')]),
  one('nether/root', 'Nether', null, [{ name: 'entered', trigger: 'changed_dimension', items: null }]),
  one('nether/obtain_blaze_rod', 'Into Fire', 'nether/root', [item('rod', 'blaze_rod')]),
];
const EARNED = ['Stone Age', 'Acquire Hardware'];
const row = (rows, title) => rows.find((r) => r.title === title);
const step = (thing) => ({ skill: 'fill_bucket', args: { liquid: 'lava' }, why: thing });

test('what is open is what comes after something earned, and a step from the planner makes it ready', () => {
  const rows = survey(TREE, EARNED, { plan: (thing) => (thing === 'lava_bucket' ? step(thing) : { stuck: `no way to get ${thing}` }) });
  assert.equal(row(rows, 'Stone Age').status, 'earned');
  assert.equal(row(rows, 'Hot Stuff').status, 'ready');
  // The one after it is not open until it is earned, whatever the planner could do.
  assert.equal(row(rows, 'Ice Bucket Challenge').status, 'locked');
  assert.equal(row(rows, 'Ice Bucket Challenge').why, 'after Hot Stuff');
  // Nothing under the Nether is earned, so its first advancement is not: all of it is locked.
  assert.equal(row(rows, 'Into Fire').status, 'locked');
  // A goal the brain already has counts as a way; a thing nothing does is a request.
  assert.equal(row(rows, 'The Parrots and the Bats').status, 'ready');
  assert.equal(row(rows, 'Best Friends Forever').status, 'no way');
  assert.match(row(rows, 'Best Friends Forever').why, /tame_animal/);
  assert.deepEqual(next(rows), { id: 'story/lava_bucket', title: 'Hot Stuff', item: 'lava_bucket', step: step('lava_bucket') });
  assert.equal(rows[0].status, 'ready');
  const s = summary(rows);
  assert.deepEqual([s.total, s.earned, s.locked], [8, 2, 2]);
  assert.equal(s.next, 'Hot Stuff');
});

test('when the planner has no step, the reason is kept and the advancement is asked of the session, nearest first', () => {
  const rows = survey(TREE, EARNED, { plan: (thing) => ({ stuck: `no still lava in reach for ${thing}` }) });
  assert.equal(row(rows, 'Hot Stuff').status, 'waiting');
  assert.match(row(rows, 'Hot Stuff').why, /no still lava in reach/);
  assert.equal(next(rows), null);
  const asked = requests(rows, 3).map((r) => r.title);
  // Hot Stuff is next door (1), taming is further (3), the froglights are far (8).
  assert.deepEqual(asked, ['Hot Stuff', 'Best Friends Forever', 'With Our Powers Combined!']);
  assert.match(requests(rows, 1)[0].would, /bucket/);
});

test('earning one opens the next, and what is already carried is not asked for again', () => {
  const rows = survey(TREE, [...EARNED, 'Hot Stuff'], { plan: () => ({ stuck: 'nothing' }), have: { obsidian: 1 } });
  assert.equal(row(rows, 'Hot Stuff').status, 'earned');
  assert.equal(row(rows, 'Ice Bucket Challenge').status, 'ready');
  assert.match(row(rows, 'Ice Bucket Challenge').why, /nothing more/);
});

test('an advancement that asks for several things asks for each, and a family of items is not one item', () => {
  assert.deepEqual(itemsFor(row(TREE.map((a) => ({ ...a })), 'With Our Powers Combined!')), [['ochre_froglight'], ['pearlescent_froglight'], ['verdant_froglight']]);
  assert.equal(itemsFor(TREE[1]), null);                              // "#stone_tool_materials" is a tag
  assert.equal(itemsFor(TREE[6]), null);                              // taming is not an item
  // Any one of a group's criteria will do.
  const either = one('x/y', 'Either', 'story/root', [item('a', 'apple'), item('b', 'bread')], { groups: [['a', 'b']] });
  assert.deepEqual(itemsFor(either), [['apple', 'bread']]);
});

const JAR = new URL('../runtime/minecraft-coop-26.1/server.jar', import.meta.url);
test('the game\'s own list is read from the server jar: every advancement has its name and the one before it', { skip: !existsSync(JAR) && 'no server jar on this machine' }, async () => {
  const { fromJar } = await import('../claude_player/advancements.mjs');
  const list = fromJar();
  assert.ok(list.length >= 120, `${list.length} advancements`);
  const ids = new Set(list.map((a) => a.id));
  for (const a of list) {
    assert.ok(a.title && !a.title.startsWith('advancements.'), `${a.id} has no name`);
    assert.ok(a.parent === null || ids.has(a.parent), `${a.id} comes after ${a.parent}, which is not in the list`);
  }
  assert.deepEqual([...new Set(list.map((a) => a.tab))].sort(), ['adventure', 'end', 'husbandry', 'nether', 'story']);
  const hot = list.find((a) => a.id === 'story/lava_bucket');
  assert.equal(hot.title, 'Hot Stuff');
  assert.deepEqual(itemsFor(hot), [['lava_bucket']]);
});
