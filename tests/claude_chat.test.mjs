import test from 'node:test';
import assert from 'node:assert/strict';
const { events, line, news, parseLine, tally } = await import(process.env.SCORE ?? '../claude_player/score.mjs');

// CHAT lets a new chat.mjs be checked beside the one the running player has loaded.
const { reads, heard, bedTrip } = await import(process.env.CHAT ?? '../claude_player/chat.mjs');

// Lines as they were said in the co-op world on 2026-10-04, with what each was asking for.
test('what was really said in the game is read for what it asked', () => {
  const said = {
    'I went to sleep': 'bed',
    'Come on everybody sleep plz': 'bed',
    'no no go to bed go to sleep in your own bed': 'bed',
    'Everybody go to sleep': 'bed',
    'Claude go to bed': 'bed',
    "Well it's almost morning anyway so I guess everybody rise and shine": 'morning',
    'Claude can you build a bigger base?': 'open',
    'What do you guys think about doing some cleanup today?': 'open',
    'I was thinking we could flatten the surrounding area and prepare to get some crops going': 'open',
    "Hey claude, if there's already a crafting table near you, you can use that one instead": 'note',
    'you can also totally destroy crafting tables and furnaces and take them with you': 'note',
  };
  for (const [message, want] of Object.entries(said)) assert.equal(reads(message), want, message);
});

test('a question about the bed is not a request to get into it, and come on is not come here', () => {
  assert.equal(reads('did you sleep?'), 'race');
  assert.equal(reads('where is your bed'), 'where');
  assert.equal(reads('nice bed'), 'race');
  assert.equal(reads('come here'), 'come');
  assert.equal(reads('follow me'), 'come');
  assert.equal(reads('Claude come'), 'come');
  assert.notEqual(reads('come on man'), 'come');
  assert.equal(reads('you should go to bed'), 'bed');
  assert.equal(reads('sleep'), 'bed');
  assert.equal(reads('stop'), 'wait');
  assert.equal(reads('resume'), 'resume');
  assert.equal(reads('what do you see?'), 'look');
  assert.equal(reads('take a look at that cave'), 'look');
  assert.equal(reads("what's the score"), 'score');
  assert.equal(reads('what are you doing'), 'greeting');
  assert.equal(reads('Claude plant the crops here'), 'farm');
  assert.equal(reads('we could put the farm by me'), 'farm');
});

// A player as chat.mjs needs it: where it is, the time, who is on line.
const vec = (x, y, z) => ({ x, y, z, distanceTo: (o) => Math.hypot(x - o.x, y - o.y, z - o.z) });
const world = (over = {}) => {
  const out = [];
  const journal = [];
  const memory = { places: { bed: { x: -352, y: 59, z: 460 } }, slept: true, ...over.memory };
  const call = (username, message) => heard({
    bot: { username: 'Claude', isSleeping: false, time: { timeOfDay: over.hour ?? 14000, day: 51 },
      entity: { position: over.at ?? vec(-352, 59, 459) },
      players: { Claude: {}, fogsift: { entity: { position: vec(-340, 64, 460) } }, Codex: {}, CodexAstra: {} } },
    memory, username, message,
    status: { where: { x: -352, y: 59, z: 459 }, doing: null, carried: {}, earned: ['Stone Age'], deaths: 21, health: 20, thought: {} },
    event: (kind, detail) => journal.push([kind, detail]), say: (text) => out.push(text), stop: () => { memory.stopped = true; },
  });
  return { call, out, journal, memory };
};

test('asked to sleep beside its bed at night, it goes; from deep in the mine it says it cannot', async () => {
  const near = world({ hour: 14000 });
  await near.call('fogsift', 'Everybody go to sleep');
  assert.equal(near.memory.order?.kind, 'bed');
  assert.equal(near.out[0], 'Going to bed.');

  // 07:34 on 2026-10-04: 113 blocks under the bed with 143 s of night left. It said "Going to bed."
  const deep = world({ hour: 20600, at: vec(-335, -54, 496) });
  await deep.call('fogsift', 'Everybody go to sleep');
  assert.equal(deep.memory.order, undefined);
  assert.match(deep.out[0], /113 blocks under my bed/);
  assert.match(deep.out[0], /would not make it/);
  assert.equal(deep.memory.stopped, undefined);

  // The same depth with most of the night ahead: it comes up, and says how long.
  const early = world({ hour: 13000, at: vec(-335, -54, 496) });
  await early.call('fogsift', 'go to bed please');
  assert.equal(early.memory.order?.kind, 'bed');
  assert.match(early.out[0], /about \d+ s from it/);
  assert.ok(bedTrip(vec(-335, -54, 496), { x: -352, y: 59, z: 460 }, 13000).need > 200);

  const day = world({ hour: 6000 });
  await day.call('fogsift', 'go to sleep');
  assert.equal(day.memory.order, undefined);
  assert.match(day.out[0], /day by my clock/);
});

test('another program is answered when it asks this player something, three times in ten minutes, and never obeyed', async () => {
  const w = world();
  await w.call('CodexAstra', 'Nice, I slept in my own bed too! My base near spawn is finished.');
  assert.deepEqual(w.out, []);                       // not said to this player
  await w.call('CodexAstra', 'Claude, go to bed now');
  assert.deepEqual(w.out, []);                       // an order from a program, with no question in it
  assert.equal(w.memory.order, undefined);
  await w.call('CodexAstra', 'Claude, can you go to bed now?');
  assert.equal(w.memory.order, undefined);           // a question: passed to the session, not obeyed
  assert.equal(w.out.length, 1);
  assert.match(w.out[0], /for my Claude session/);
  assert.equal(w.journal.at(-1)[0], 'chat_open');
  await w.call('CodexAstra', 'Claude, where are you?');
  await w.call('CodexAstra', 'Claude, what is your progress?');
  assert.equal(w.out.length, 3);
  await w.call('CodexAstra', 'Claude, where are you now?');
  assert.equal(w.out.length, 3);                     // the fourth in ten minutes is left for the session
  assert.match(w.journal.at(-1)[1].unanswered, /three answers/);
});

test('a line meant for another player is left alone', async () => {
  const w = world();
  await w.call('fogsift', "Astra, can you please actually play the game? You're basically doing nothing");
  assert.deepEqual(w.out, []);
});

test('renamed Codex and legacy CodexAstra receive replies addressed to their actual incoming name', async () => {
  for (const peer of ['Codex', 'CodexAstra']) {
    const w = world();
    await w.call(peer, 'Claude, where are you?');
    assert.equal(w.out.length, 1);
    assert.ok(w.out[0].startsWith(`${peer}: I am at -352 59 459`));
    await w.call(peer, 'Claude, can you stop and come to me?');
    assert.equal(w.memory.order, undefined);
    assert.equal(w.memory.stopped, undefined);
    assert.ok(w.out[1].startsWith(`${peer}:`));
  }
});

test('self and unapproved bot identities cannot use the narrow competitive chat exception', async () => {
  const w = world();
  for (const name of ['Claude', 'CodexBot', 'CodexAstraBot', 'HelperBot', 'codex']) {
    await w.call(name, 'Claude, where are you?');
  }
  assert.deepEqual(w.out, []);
  assert.deepEqual(w.journal, []);
  assert.equal(w.memory.toPrograms, undefined);
});

const LOG = [
  '[07:33:32] [Server thread/INFO]: [Not Secure] <CodexAstra> Claude has made the advancement [Cheating]',
  '[07:59:59] [Server thread/INFO]: CodexAstra has made the advancement [Stone Age]',
  '[08:00:00] [Server thread/INFO]: Claude has made the advancement [Hot Stuff]',
  '[08:10:00] [Server thread/INFO]: <Claude> Claude drowned',
  '[08:12:00] [Server thread/INFO]: CodexAstra was shot by Skeleton',
  '[08:13:00] [Server thread/INFO]: CodexAstra has made the advancement [Getting an Upgrade]',
  '[08:14:00] [Server thread/INFO]: CodexAstra has completed the challenge [Something Hard]',
  '[08:15:00] [Server thread/INFO]: CodexAstra discovered the floor was lava',
  '[08:16:00] [Server thread/INFO]: Claude joined the game',
  '[08:17:00] [Server thread/INFO]: Claude did something the game has no word for here',
  '[08:18:00] [Server thread/INFO]: fogsift was slain by Zombie',
  '[00:05:00] [Server thread/INFO]: Claude was slain by Zombie',
];

test('the score counts only what the game said, since the start, for the players in the challenge', () => {
  const players = ['Claude', 'CodexAstra'];
  const rows = events(LOG, '2026-10-04', players);
  const since = new Date('2026-10-04T08:00:00');
  const score = tally(rows, { players, since });
  // A chat line that quotes the game's sentence is not the game speaking.
  assert.deepEqual(score.Claude.advancements, ['Hot Stuff']);
  // 00:05 after 08:18 is the next day: after the start, and a death.
  assert.equal(score.Claude.deaths, 1);
  assert.equal(score.Claude.points, 0);
  assert.deepEqual(score.Claude.unread, ['did something the game has no word for here']);
  // Stone Age at 07:59:59 was before the start.
  assert.deepEqual(score.CodexAstra.advancements, ['Getting an Upgrade', 'Something Hard']);
  assert.equal(score.CodexAstra.deaths, 2);
  assert.equal(score.CodexAstra.points, 0);
  assert.equal(score.fogsift, undefined);
  assert.equal(line({ score, since }), 'Score since 08:00: Claude 0 (1 advancement, 1 death); CodexAstra 0 (2 advancements, 2 deaths).');
  assert.equal(parseLine('[08:10:00] [Server thread/INFO]: <Claude> Claude drowned', players), null);
  assert.equal(news('CodexAstra was blown up by Creeper', players).kind, 'death');
  assert.equal(news('CodexAstra joined the game', players), null);
  // A player that changed its name is still the same player in the challenge.
  const renamed = tally(events(['[08:39:11] [Server thread/INFO]: Codex was shot by Skeleton', '[08:40:00] [Server thread/INFO]: CodexAstra drowned'],
    '2026-10-04', ['Claude', 'Codex'], { CodexAstra: 'Codex' }), { players: ['Claude', 'Codex'], since });
  assert.equal(renamed.Codex.deaths, 2);
  assert.equal(news('Codex was shot by Skeleton', ['Claude', 'Codex']).kind, 'death');
});
