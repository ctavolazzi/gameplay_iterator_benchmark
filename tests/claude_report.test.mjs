import test from 'node:test';
import assert from 'node:assert/strict';
import { digest, page } from '../claude_player/report.mjs';

const START = Date.parse('2026-10-04T14:49:00Z');
const at = (seconds) => new Date(START + seconds * 1000).toISOString();

// Ten minutes of journal like the ones around 07:49 on 2026-10-04: a climb that failed the same
// way over and over, a fight that stopped a step, a death, a request the player had no rule for.
const ROWS = [
  { at: at(0), kind: 'skill', skill: 'collect', args: { block: 'deepslate_diamond_ore', count: 3 }, ok: true, note: 'picked up 3 of 3', ms: 30000, goal: 'mining' },
  { at: at(31), kind: 'skill', skill: 'collect', args: { block: 'deepslate_diamond_ore', count: 3 }, ok: false, note: 'reflex: fighting a zombie', ms: 6000, goal: 'mining' },
  { at: at(40), kind: 'fight', foe: 'zombie' },
  { at: at(50), kind: 'chat', username: 'fogsift', message: 'Claude can you build a bigger base?' },
  { at: at(50), kind: 'chat_open', username: 'fogsift', message: 'Claude can you build a bigger base?' },
  { at: at(58), kind: 'skill', skill: 'surface', args: {}, ok: false, note: 'climbed 0 blocks to -3, still under ground', ms: 258, goal: 'asked' },
  { at: at(59), kind: 'skill', skill: 'surface', args: {}, ok: false, note: 'climbed 0 blocks to -3, still under ground', ms: 751, goal: 'asked' },
  { at: at(60), kind: 'skill', skill: 'surface', args: {}, ok: false, note: 'climbed 0 blocks to -4, still under ground', ms: 211, goal: 'asked' },
  { at: at(90), kind: 'damage', from: 20, to: 14.5 },
  { at: at(95), kind: 'death', where: { x: -394, y: -47, z: 436 }, doing: 'collect', night: true },
  { at: at(200), kind: 'advancement', name: 'Hot Stuff' },
];

test('the report puts what needs deciding first: a death, then what was asked, then what keeps failing', () => {
  const d = digest(ROWS, { from: START, to: START + 600000,
    status: { ready: true, thought: { stuck: { base: 'the walk home waits for morning' } } },
    asks: [{ who: 'fogsift', when: 'today', words: 'get some crops going', done: false }, { who: 'CT', when: 'yesterday', words: 'sleep in a bed', done: true }] });
  assert.match(d.decide[0], /^Died at .* at -394 -47 436 during collect, at night/);
  assert.match(d.decide[1], /fogsift said .* "Claude can you build a bigger base\?"/);
  // The same failure with a different number in it is the same failure.
  assert.match(d.decide[2], /^Failed 3 times the same way: surface/);
  assert.match(d.decide[3], /Goal "base" is stuck/);
  assert.match(d.decide[4], /^Stood still for \d+ s of 600 s/);
  assert.match(d.decide.at(-1), /get some crops going/);
  // A step a reflex stopped is not that step failing, and what is done is not asked for again.
  assert.ok(!d.decide.some((line) => /reflex|sleep in a bed/.test(line)));
  assert.equal(d.steps, 5);
  assert.equal(d.failed, 4);
  assert.equal(d.deaths, 1);
  assert.equal(d.damage, 5.5);
  assert.deepEqual(d.advancements, ['Hot Stuff']);
  assert.equal(d.byGoal.asked.failed, 3);
  const text = page(d, { look: { says: 'Looking north. I see stone.', file: '/tmp/x.png' } });
  assert.ok(text.indexOf('## To decide') < text.indexOf('## Numbers'));
  assert.match(text, /\| asked \| 3 \| 3 \| 1 \|/);
  assert.match(text, /picture: \/tmp\/x\.png/);
});

test('a quiet stretch with nothing wrong says so', () => {
  const d = digest([{ at: at(0), kind: 'skill', skill: 'collect', args: {}, ok: true, ms: 100000, goal: 'mining' }], { from: START, to: START + 110000, status: { ready: true } });
  assert.deepEqual(d.decide, []);
  assert.match(page(d), /Nothing asks for a decision/);
});

test('the watcher wakes the session when one step has failed six times the same way, and not at five', async () => {
  const { spawn } = await import('node:child_process');
  const { appendFileSync, mkdtempSync, writeFileSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const dir = mkdtempSync(join(tmpdir(), 'claude-watch-'));
  writeFileSync(join(dir, 'journal.jsonl'), '');
  writeFileSync(join(dir, 'control.json'), JSON.stringify({ pid: process.pid }));
  const watcher = spawn(process.execPath, [new URL('../claude_player/watch_events.mjs', import.meta.url).pathname, '30', '30'], { env: { ...process.env, CLAUDE_PLAYER_DATA: dir } });
  let said = '';
  watcher.stdout.on('data', (chunk) => { said += chunk; });
  const ended = new Promise((resolve) => watcher.on('exit', resolve));
  const row = (y) => `${JSON.stringify({ at: new Date().toISOString(), kind: 'skill', skill: 'surface', args: {}, ok: false, note: `climbed 0 blocks to ${y}, still under ground`, ms: 250 })}\n`;
  const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  // Rows written before the watcher has started are not its to count: on a busy machine half a
  // second was not always enough, and the test failed once for that.
  await new Promise((resolve) => watcher.stderr.once('data', resolve));
  for (let i = 0; i < 5; i++) appendFileSync(join(dir, 'journal.jsonl'), row(-3));
  // A step the reflexes stopped does not count toward the six.
  appendFileSync(join(dir, 'journal.jsonl'), `${JSON.stringify({ at: new Date().toISOString(), kind: 'skill', skill: 'surface', args: {}, ok: false, note: 'reflex: fighting a zombie', ms: 250 })}\n`);
  await pause(4500);
  assert.equal(said, '');
  appendFileSync(join(dir, 'journal.jsonl'), row(-4));
  await ended;
  assert.match(said, /failed 6 times the same way: surface \{\}: climbed N blocks to N, still under ground/);
});

test('the curriculum\'s nearest requests are put to the session in the report', () => {
  const curriculum = { total: 120, earned: 12, ready: 1, waiting: 3, noWay: 36, next: null, requests: [
    { title: 'Hot Stuff', id: 'story/lava_bucket', asks: 'Fill a Bucket with lava', status: 'waiting', why: 'lava_bucket: no bucket', would: 'the bucket filled at lava that lies open' },
    { title: 'Fishy Business', id: 'husbandry/fishy_business', asks: 'Catch a fish', status: 'no way', why: 'fishing_rod_hooked: nothing in the program does this', would: null },
    { title: 'Take Aim', id: 'adventure/shoot_arrow', asks: 'Shoot something with an Arrow', status: 'no way', why: 'x', would: null }] };
  const d = digest([], { from: START, to: START + 60000, status: { ready: true }, curriculum });
  assert.equal(d.decide.length, 2);                   // the two nearest, not the whole list
  assert.match(d.decide[0], /^The curriculum asks for a way to "Hot Stuff" \(Fill a Bucket with lava\)\. It has one that cannot be taken now: lava_bucket: no bucket\. It would take: the bucket filled/);
  assert.match(d.decide[1], /"Fishy Business".*Nothing in the program does this/);
  assert.match(page(d), /curriculum: 12 of 120 advancements earned; open: 1 with a way, 3 waiting, 36 with no way; next: nothing the planner can start on now/);
});
