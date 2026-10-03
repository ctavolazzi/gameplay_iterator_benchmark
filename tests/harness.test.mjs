// The spine: a run is reset, played to a budget, stored, and can be replayed from the
// database. Several of these tests plant a fault and require the check to catch it, since
// a comparison that has never reported a difference proves nothing.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertAdapter } from '../harness/adapter.mjs';
import { canon } from '../harness/canon.mjs';
import { compareRuns, replayRun } from '../harness/replay.mjs';
import { runOnce } from '../harness/runner.mjs';
import { openStore } from '../harness/store.mjs';
import { firstLegal, fromList, seededRandom } from '../harness/players/scripted.mjs';
import { createAdapter } from '../games/testbed/adapter.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const tempDir = () => mkdtempSync(join(tmpdir(), 'gib-'));
const freshStore = () => openStore(tempDir());
const GRASS = ['.....', '.....', '.....', '.....', '.....'];

// A fresh adapter and a fresh player every time, as a real run gets.
const play = (store, over = {}) =>
  runOnce({
    adapter: createAdapter(),
    player: seededRandom('p1'),
    store,
    seed: 'world-1',
    budget: { ticks: 60, calls: 60 },
    ...over,
  });

test('a run lands in the database with its inputs and its result', async () => {
  const store = freshStore();
  const out = await play(store, { commit: 'abc123' });
  const row = store.getRun(out.runId);
  assert.equal(row.game, 'testbed');
  assert.equal(row.game_version, '1');
  assert.equal(row.seed, 'world-1');
  assert.equal(row.code_commit, 'abc123');
  assert.equal(row.player, 'scripted:random:p1');
  assert.equal(row.budget_ticks, 60);
  assert.equal(row.budget_calls, 60);
  assert.equal(row.ended_reason, out.endedReason);
  assert.match(row.trace_hash, /^[0-9a-f]{64}$/);
  assert.ok(out.steps > 0);
  assert.equal(store.getSteps(out.runId).length, out.steps);
  assert.equal(row.step_count, out.steps);
  assert.equal(store.getMetrics(out.runId).steps, out.steps);
});

test('a 64-bit seed is stored exactly', async () => {
  const seed = '7040093665601660210';
  assert.notEqual(String(Number(seed)), seed, 'this seed must be one a number cannot hold');
  const store = freshStore();
  const out = await play(store, { seed });
  assert.equal(store.getRun(out.runId).seed, seed);
});

test('the tick budget ends a run', async () => {
  const out = await play(freshStore(), {
    player: firstLegal(), options: { map: GRASS }, budget: { ticks: 5, calls: 1000 },
  });
  assert.equal(out.endedReason, 'budget_ticks');
  assert.equal(out.steps, 5);
  assert.equal(out.metrics.ticks, 5);
});

test('the call budget ends a run', async () => {
  const out = await play(freshStore(), {
    player: firstLegal(), options: { map: GRASS }, budget: { ticks: 1000, calls: 7 },
  });
  assert.equal(out.endedReason, 'budget_calls');
  assert.equal(out.steps, 7);
  assert.equal(out.metrics.calls, 7);
});

test('an action the game did not offer is recorded, costs a call and moves nothing', async () => {
  const store = freshStore();
  const out = await play(store, {
    player: fromList(['fly']), options: { map: GRASS }, budget: { ticks: 1000, calls: 3 },
  });
  assert.equal(out.endedReason, 'budget_calls');
  assert.equal(out.metrics.illegal_actions, 3);
  const steps = store.getSteps(out.runId);
  assert.equal(steps.length, 3);
  for (const s of steps) {
    assert.equal(s.tick, 0);
    assert.deepEqual(s.result, { ok: false, error: 'illegal action' });
    assert.deepEqual(s.observation.pos, { x: 2, y: 2 });
  }
});

test('north is up and east is right', async () => {
  for (const [name, pos] of [['north', { x: 2, y: 1 }], ['south', { x: 2, y: 3 }], ['east', { x: 3, y: 2 }], ['west', { x: 1, y: 2 }]]) {
    const store = freshStore();
    const out = await play(store, {
      player: fromList([name]), options: { map: GRASS }, budget: { ticks: 1000, calls: 1 },
    });
    assert.deepEqual(store.getSteps(out.runId)[0].result.pos, pos, name);
  }
});

test('death ends a run early, and the dice roll is in the log', async () => {
  const store = freshStore();
  const out = await play(store, {
    player: fromList(['east']), options: { map: ['.PPPP'], start: [0, 0] }, budget: { ticks: 1000, calls: 1000 },
  });
  assert.equal(out.endedReason, 'death');
  assert.ok(out.steps <= 3, 'three pits at most can be survived with 3 health');
  const events = store.getSteps(out.runId).flatMap((s) => s.events);
  const damage = events.filter((e) => e.kind === 'damage');
  assert.ok(damage.length >= 2);
  for (const e of damage) {
    assert.ok(e.detail.roll === 0 || e.detail.roll === 1);
    assert.equal(e.detail.amount, 1 + e.detail.roll);
  }
  const total = damage.reduce((sum, e) => sum + e.detail.amount, 0);
  assert.ok(total >= 3);
  assert.equal(out.metrics.damage_taken, total);
  assert.equal(events.at(-1).kind, 'death');
});

test('crafting the pick completes the run, with every milestone at its tick', async () => {
  const out = await play(freshStore(), {
    player: fromList(['east', 'gather', 'east', 'gather', 'east', 'gather', 'east', 'gather', 'craft_table', 'craft_pick']),
    options: { map: ['.TTTS'], start: [0, 0] },
    budget: { ticks: 1000, calls: 1000 },
  });
  assert.equal(out.endedReason, 'complete');
  assert.equal(out.steps, 10);
  assert.equal(out.metrics.milestones, 4);
  assert.equal(out.metrics.unique_items, 4);
  assert.equal(out.metrics.cells_visited, 5);
  // 4 walks at 1 tick, 4 gathers at 2, 2 crafts at 3.
  assert.equal(out.metrics.tick_of_first_wood, 3);
  assert.equal(out.metrics.tick_of_first_stone, 12);
  assert.equal(out.metrics.tick_of_table, 15);
  assert.equal(out.metrics.tick_of_pick, 18);
  assert.equal(out.metrics.ticks, 18);
});

test('the same inputs give the same run, step for step', async () => {
  const store = freshStore();
  const a = await play(store);
  const b = await play(store);
  assert.equal(a.traceHash, b.traceHash);
  assert.deepEqual(compareRuns(store, a.runId, b.runId), { same: true, steps: [a.steps, a.steps], divergence: null });
});

test('planted fault: a different seed or a different player is reported as a difference', async () => {
  const store = freshStore();
  const a = await play(store);
  const otherWorld = await play(store, { seed: 'world-2' });
  const otherPlayer = await play(store, { player: seededRandom('p2') });
  for (const b of [otherWorld, otherPlayer]) {
    assert.notEqual(a.traceHash, b.traceHash);
    const diff = compareRuns(store, a.runId, b.runId);
    assert.equal(diff.same, false);
    assert.ok(Number.isInteger(diff.divergence.seq));
    assert.ok(['tick', 'observation', 'action', 'result', 'events', 'length'].includes(diff.divergence.field));
  }
});

test('a stored run replays from the database and matches at every step', async () => {
  const store = freshStore();
  const out = await play(store);
  const replay = await replayRun({ store, runId: out.runId, adapter: createAdapter() });
  assert.deepEqual(replay, { ok: true, checked: out.steps, divergence: null });
});

test('planted fault: replay catches a changed action', async () => {
  const store = freshStore();
  const out = await play(store, { player: firstLegal(), options: { map: GRASS } });
  assert.deepEqual(store.getSteps(out.runId)[0].action, { name: 'north' });
  store.db.prepare('UPDATE steps SET action = ? WHERE run_id = ? AND seq = 0').run(canon({ name: 'south' }), out.runId);
  const replay = await replayRun({ store, runId: out.runId, adapter: createAdapter() });
  assert.equal(replay.ok, false);
  assert.equal(replay.divergence.seq, 0);
  assert.equal(replay.divergence.field, 'result');
  assert.deepEqual(replay.divergence.stored.pos, { x: 2, y: 1 });
  assert.deepEqual(replay.divergence.replayed.pos, { x: 2, y: 3 });
});

test('planted fault: replay catches a changed observation', async () => {
  const store = freshStore();
  const out = await play(store);
  const changed = { ...store.getSteps(out.runId)[2].observation, health: 1 };
  store.db.prepare('UPDATE steps SET observation_json = ? WHERE run_id = ? AND seq = 2').run(canon(changed), out.runId);
  const replay = await replayRun({ store, runId: out.runId, adapter: createAdapter() });
  assert.equal(replay.ok, false);
  assert.equal(replay.divergence.seq, 2);
  assert.equal(replay.divergence.field, 'observation');
});

test('planted fault: replay catches a changed trace hash', async () => {
  const store = freshStore();
  const out = await play(store);
  store.db.prepare('UPDATE runs SET trace_hash = ? WHERE id = ?').run('0'.repeat(64), out.runId);
  const replay = await replayRun({ store, runId: out.runId, adapter: createAdapter() });
  assert.equal(replay.ok, false);
  assert.equal(replay.divergence.field, 'trace_hash');
});

test('the JSONL log holds the same run as the database', async () => {
  const store = freshStore();
  const out = await play(store);
  const lines = readFileSync(store.logPath(out.runId), 'utf8').trim().split('\n').map((line) => JSON.parse(line));
  assert.equal(lines.length, out.steps + 2);
  assert.equal(lines[0].type, 'run');
  assert.equal(lines[0].seed, 'world-1');
  assert.equal(lines.at(-1).type, 'end');
  assert.equal(lines.at(-1).traceHash, out.traceHash);
  const stored = store.getSteps(out.runId);
  lines.slice(1, -1).forEach((line, i) => {
    assert.equal(line.type, 'step');
    for (const field of ['seq', 'tick', 'observation', 'action', 'result', 'events']) {
      assert.equal(canon(line[field]), canon(stored[i][field]), `step ${i} ${field}`);
    }
  });
});

test('a run that crashes is stored as an error, never as a finished run', async () => {
  const store = freshStore();
  let asked = 0;
  const player = {
    id: 'scripted:crashes',
    async decide({ actions }) {
      asked += 1;
      if (asked === 3) throw new Error('the model went away');
      return { action: { name: actions[0].name } };
    },
  };
  await assert.rejects(play(store, { player, options: { map: GRASS } }), /the model went away/);
  const row = store.getRun(1);
  assert.equal(row.ended_reason, 'error');
  assert.equal(row.step_count, 2);
  assert.equal(store.getSteps(1).length, 2);
});

test('an incomplete adapter is refused by name', () => {
  assert.throws(() => assertAdapter({ name: 'half', reset() {} }), /missing: version, observe\(\), actions\(\)/);
  assert.equal(assertAdapter(createAdapter()).name, 'testbed');
});

test('nothing in harness/ imports from a game folder', () => {
  const importsGame = /(from\s+|import\s*\(?\s*)['"`][^'"`]*games\//;
  assert.match("import { x } from '../games/testbed/adapter.mjs';", importsGame, 'the pattern must catch a planted import');
  assert.match("import '../games/testbed/adapter.mjs';", importsGame, 'and a planted import with no names');
  assert.match("await import(`../games/${name}/adapter.mjs`)", importsGame, 'and a planted dynamic import');
  const files = readdirSync(join(ROOT, 'harness'), { recursive: true }).filter((f) => f.endsWith('.mjs'));
  assert.ok(files.length >= 6, `expected the harness files, found ${files.length}`);
  for (const file of files) {
    assert.doesNotMatch(readFileSync(join(ROOT, 'harness', file), 'utf8'), importsGame, file);
  }
});

test('the command line runs, replays and compares', () => {
  const data = tempDir();
  const cli = (...args) =>
    execFileSync(process.execPath, ['--disable-warning=ExperimentalWarning', join(ROOT, 'iterate.mjs'), ...args, '--data', data], { encoding: 'utf8' });
  // Pinned to the first playbook: 'latest' moves every time the coach writes a new one.
  const play = (seed) => cli('run', '--seed', seed, '--ticks', '30', '--playbook', 'v001');
  assert.match(play('cli-1'), /^run 1: testbed, seed cli-1, testbed\/v001, ended by \w+ after \d+ steps/m);
  play('cli-1');
  play('cli-2');
  assert.match(cli('replay', '1'), /all \d+ steps match the database/);
  assert.match(cli('compare', '1', '2'), /identical/);
  assert.match(cli('runs'), /3 runs in /);
  assert.throws(() => cli('compare', '1', '3'), (error) => error.status === 1 && /DIFFER at step \d+/.test(error.stdout));
});
