#!/usr/bin/env -S node --disable-warning=ExperimentalWarning
// The runner. It knows nothing about any game: config.json names one, and everything
// about that game comes from games/<name>/adapter.mjs and playbooks/<name>/.
//
//   ./iterate.mjs run [--game G] [--seed S] [--ticks N] [--calls N] [--player random|first|llama] [--playbook vNNN|latest|none] [--wait N] [--body B]
//   ./iterate.mjs coach <run>             hand a finished run to Claude; it may write the next playbook
//   ./iterate.mjs loop --runs N           run, coach, run again with the new playbook: N runs in all
//   ./iterate.mjs replay <run>            play a stored run again and check every step
//   ./iterate.mjs compare <a> <b>         the first step where two stored runs differ
//   ./iterate.mjs runs                    list the stored runs
//   ./iterate.mjs validate <game> <dir>   check that a playbook loads and its skills do not crash
//
// --data DIR puts the database and logs somewhere other than data/. --model FILE picks the
// local model for --player llama. replay, compare and validate exit 1 when the check fails.
// --body B picks which of a game's bodies plays, for a game that has more than one
// (Minecraft: bot, the hidden player, or hands, the real game window by keys and mouse).
// Machine settings go in config.local.json (not in git): llamaServer, claude, coachModel.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { askClaude, coachRun } from './harness/coach.mjs';
import { fileSha256, llamaPlayer, startLlamaServer } from './harness/players/llama.mjs';
import { firstLegal, seededRandom } from './harness/players/scripted.mjs';
import { compareRuns, replayRun } from './harness/replay.mjs';
import { codeCommit, runOnce } from './harness/runner.mjs';
import { latestVersion, loadPlaybook, playbookDir, withSkills } from './harness/skills.mjs';
import { openStore } from './harness/store.mjs';

const SELF = fileURLToPath(import.meta.url);
const ROOT = dirname(SELF);
const USAGE = readFileSync(SELF, 'utf8')
  .split('\n').filter((line) => line.startsWith('//   ./')).map((line) => line.slice(5)).join('\n');

const readJson = (name) => (existsSync(join(ROOT, name)) ? JSON.parse(readFileSync(join(ROOT, name), 'utf8')) : {});
const config = { ...readJson('config.json'), ...readJson('config.local.json') };

const SCRIPTED = { random: (seed) => seededRandom(seed), first: () => firstLegal() };

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    seed: { type: 'string' },
    ticks: { type: 'string' },
    calls: { type: 'string' },
    runs: { type: 'string', default: '3' },
    player: { type: 'string', default: 'random' },
    playbook: { type: 'string', default: 'latest' },
    model: { type: 'string' },
    game: { type: 'string' },
    wait: { type: 'string' },
    window: { type: 'boolean', default: false },
    body: { type: 'string' },
    data: { type: 'string', default: join(ROOT, 'data') },
  },
});
const [command, ...rest] = positionals;
const gameName = values.game ?? config.game;

const loadGame = (name) => import(pathToFileURL(join(ROOT, 'games', name, 'adapter.mjs')).href);

function wholeNumber(text, label) {
  const n = Number(text);
  if (!Number.isInteger(n) || n < 1) throw new Error(`${label} must be a whole number above 0, got '${text}'`);
  return n;
}

// A game, with a playbook's skills in front of it when there is one. wanted is a version
// name, 'latest', or 'none' for the game's own actions with no playbook.
async function openGame(name, wanted) {
  const game = await loadGame(name);
  const versionName = wanted === 'latest' ? latestVersion(ROOT, name) : wanted === 'none' ? null : wanted;
  const made = game.createAdapter({ root: ROOT, ...(values.body ? { body: values.body } : {}) });
  if (!versionName) return { game, adapter: made, playbook: null, version: null, versionName: null };
  const playbook = loadPlaybook(playbookDir(ROOT, name, versionName));
  return { game, adapter: withSkills(made, playbook), playbook, version: `${name}/${versionName}`, versionName };
}

async function openLlama() {
  const model = resolve(ROOT, values.model ?? config.model);
  if (!existsSync(model)) throw new Error(`no model file at ${model}; tools/fetch_runtime.sh fetches it`);
  const start = () => startLlamaServer({
    bin: config.llamaServer ?? 'llama-server', model, logFile: join(values.data, 'llama-server.log'),
  });
  let server = await start();
  return {
    url: server.url,
    label: basename(model, '.gguf'),
    modelHash: await fileSha256(model),
    stop: () => server.stop(),
    // Last resort, after a plain retry has also failed: start the model server again.
    restart: async () => {
      console.log('  the model server is not answering; starting it again');
      server.stop();
      server = await start();
    },
  };
}

async function playOne(store, llama) {
  const { game, adapter, playbook, version } = await openGame(gameName, values.playbook);
  if (version) store.addSkillVersion({ version });
  const seed = values.seed ?? game.defaults.seed;
  let player;
  if (values.player === 'llama') {
    player = llamaPlayer({
      url: llama.url, label: llama.label, modelHash: llama.modelHash, briefing: playbook?.briefing ?? '', recover: llama.restart,
    });
  } else if (SCRIPTED[values.player]) {
    player = SCRIPTED[values.player](seed);
  } else {
    throw new Error(`no player '${values.player}'; there are: random, first, llama`);
  }
  // What a person watching the terminal sees: a header, a line per decision as it happens,
  // and each milestone as it is reached.
  const colour = (code, text) => (process.stdout.isTTY ? `\x1b[${code}m${text}\x1b[0m` : text);
  const reached = [];
  console.log(colour('1', `\n▶ ${gameName}   seed ${seed}   playbook ${version ?? 'none'}   player ${player.id}`));
  console.log(colour('2', '  starting the game (a Minecraft world takes about 25 seconds to come up)'));
  const out = await runOnce({
    adapter,
    player,
    store,
    seed,
    // --wait N: a game that can be watched holds the start up to N seconds for a viewer.
    // --window: the game opens its own window to watch in, and waits for it to join.
    options: {
      ...(values.body ? { body: values.body } : {}),
      ...(values.window ? { window: true } : {}),
      ...(values.wait || values.window ? { waitForViewer: wholeNumber(values.wait ?? '240', '--wait') } : {}),
    },
    budget: {
      ticks: wholeNumber(values.ticks ?? game.defaults.budget.ticks, '--ticks'),
      calls: wholeNumber(values.calls ?? game.defaults.budget.calls, '--calls'),
    },
    commit: codeCommit(ROOT),
    skillLibraryVersion: version,
    // One line per decision as it happens, so a run can be watched where it was started.
    onStep: (s) => {
      const failed = s.result.ok === false;
      const said = s.result.error ?? s.result.note ?? '';
      const outcome = (typeof said === 'string' ? said : JSON.stringify(said)).slice(0, 100);
      const seconds = (ms) => `${(ms / 1000).toFixed(1)}s`;
      console.log([
        failed ? colour('31', '  ✗') : colour('32', '  ✓'),
        colour('2', `#${String(s.seq + 1).padStart(2)}`),
        colour('1', s.action.name.padEnd(22)),
        colour('2', `1 of ${s.options.length} options, thought ${seconds(s.decideMs)}, acted ${seconds(s.actMs)}`.padEnd(46)),
        failed ? colour('31', outcome) : outcome,
      ].join(' '));
      for (const e of s.events) {
        if (e.kind === 'milestone') {
          reached.push(e.detail.name);
          console.log(colour('33', `      ★ ${e.detail.name}`) + colour('2', `   so far: ${reached.join(' → ')}`));
        }
        if (e.kind === 'damage') console.log(colour('31', `      ♥ took ${e.detail.amount} damage, health ${e.detail.health}`));
        if (e.kind === 'death') console.log(colour('31', '      ☠ died'));
      }
    },
  });
  console.log(colour('1', `\nrun ${out.runId}: ${gameName}, seed ${seed}, ${version ?? 'no playbook'}, ended by ${out.endedReason} after ${out.steps} steps`));
  for (const [name, value] of Object.entries(out.metrics)) console.log(`  ${name} = ${value}`);
  console.log(`  trace ${out.traceHash}`);
  console.log(`  log ${store.logPath(out.runId)}`);
  return { ...out, version };
}

// Validation runs in its own process with a time limit, so a skill that never returns
// cannot hang the runner. Returns null for a good playbook, or the reason it is not.
function validateInChild(game, dir) {
  try {
    execFileSync(process.execPath, ['--disable-warning=ExperimentalWarning', SELF, 'validate', game, dir], {
      encoding: 'utf8', timeout: 420000, stdio: ['ignore', 'pipe', 'pipe'],
    });
    return null;
  } catch (error) {
    if (error.code === 'ETIMEDOUT' || error.killed) return 'the playbook did not finish its test run within 7 minutes';
    return (error.stdout || error.stderr || error.message).trim().slice(0, 600);
  }
}

async function coachOne(store, runId) {
  const stored = store.getRun(runId);
  if (!stored) throw new Error(`no run ${runId} in the database`);
  const versionName = stored.skill_library_version?.split('/')[1];
  if (!versionName) throw new Error(`run ${runId} was played without a playbook, so there is nothing for the coach to change`);
  const game = await loadGame(stored.game);
  const adapter = game.createAdapter({ root: ROOT });
  const out = await coachRun({
    store,
    runId,
    root: ROOT,
    game: stored.game,
    version: versionName,
    playbook: loadPlaybook(playbookDir(ROOT, stored.game, versionName)),
    rules: adapter.describe(),
    vocabulary: adapter.vocabulary?.() ?? [],
    validate: (dir) => validateInChild(stored.game, dir),
    ask: (prompt) => askClaude(prompt, { bin: config.claude ?? 'claude', model: config.coachModel ?? null }),
  });
  console.log(`coach on run ${runId}: score ${out.score} of 10`);
  console.log(`  ${out.reasons.replace(/\n+/g, '\n  ')}`);
  if (out.newVersion) console.log(`  new playbook ${out.newVersion}: ${out.summary}`);
  else if (out.rejected) console.log(`  no new playbook, the change was rejected: ${out.rejected}`);
  else console.log('  the coach kept the playbook as it is');
  return out;
}

async function run(store) {
  const llama = values.player === 'llama' ? await openLlama() : null;
  try {
    await playOne(store, llama);
  } finally {
    llama?.stop();
  }
  return true;
}

async function loop(store) {
  const total = wholeNumber(values.runs, '--runs');
  const llama = values.player === 'llama' ? await openLlama() : null;
  const rows = [];
  try {
    for (let i = 1; i <= total; i++) {
      const out = await playOne(store, llama);
      const coached = i < total ? await coachOne(store, out.runId) : null;
      rows.push({ out, coached });
    }
  } finally {
    llama?.stop();
  }
  console.log('\nrun  playbook        ended by       steps  milestones  median decision  coach score');
  for (const { out, coached } of rows) {
    console.log([
      String(out.runId).padEnd(4), String(out.version).padEnd(15), String(out.endedReason).padEnd(14),
      String(out.steps).padEnd(6), String(out.metrics.milestones ?? '').padEnd(11),
      `${out.metrics.decide_ms_median} ms`.padEnd(16), coached ? coached.score : '',
    ].join(' '));
  }
  return true;
}

async function coach(store) {
  await coachOne(store, wholeNumber(rest[0], 'the run id'));
  return true;
}

async function replay(store) {
  const runId = wholeNumber(rest[0], 'the run id');
  const stored = store.getRun(runId);
  if (!stored) throw new Error(`no run ${runId} in the database`);
  const { adapter } = await openGame(stored.game, stored.skill_library_version?.split('/')[1] ?? 'none');
  const out = await replayRun({ store, runId, adapter });
  if (out.ok) {
    console.log(`replay of run ${runId}: all ${out.checked} steps match the database`);
    return true;
  }
  const d = out.divergence;
  console.log(`replay of run ${runId}: DIVERGES at step ${d.seq}, in ${d.field}`);
  console.log(`  stored   ${JSON.stringify(d.stored)}`);
  console.log(`  replayed ${JSON.stringify(d.replayed)}`);
  return false;
}

function compare(store) {
  const a = wholeNumber(rest[0], 'the first run id');
  const b = wholeNumber(rest[1], 'the second run id');
  for (const id of [a, b]) if (!store.getRun(id)) throw new Error(`no run ${id} in the database`);
  const out = compareRuns(store, a, b);
  if (out.same) {
    console.log(`runs ${a} and ${b}: identical, ${out.steps[0]} steps`);
    return true;
  }
  const d = out.divergence;
  console.log(`runs ${a} and ${b}: DIFFER at step ${d.seq}, in ${d.field}`);
  console.log(`  run ${a}  ${JSON.stringify(d.a)}`);
  console.log(`  run ${b}  ${JSON.stringify(d.b)}`);
  return false;
}

function runs(store) {
  const all = store.listRuns();
  for (const r of all) {
    console.log([
      `run ${r.id}`, r.game, `seed ${r.seed}`, r.skill_library_version ?? 'no playbook', r.player,
      r.ended_reason ?? 'UNFINISHED', `${r.step_count ?? '?'} steps`, r.started_at, (r.trace_hash ?? '').slice(0, 12),
    ].join('  '));
  }
  console.log(`${all.length} runs in ${store.dir}`);
  return true;
}

// Load the playbook and play it with a scripted player on test worlds. Any skill that
// crashes fails the playbook. Runs in a scratch database, never the real one. A game may
// say which worlds and how long (validation); the default is three short ones.
async function validate() {
  const [name, dir] = rest;
  const game = await loadGame(name);
  const playbook = loadPlaybook(resolve(dir));
  const plan = game.validation ?? { seeds: ['validate-1', 'validate-2', 'validate-3'], budget: { ticks: 400, calls: 40 } };
  for (const seed of plan.seeds) {
    const store = openStore(mkdtempSync(join(tmpdir(), 'gib-validate-')));
    const out = await runOnce({
      adapter: withSkills(game.createAdapter({ root: ROOT }), playbook), player: seededRandom(seed), store, seed,
      budget: plan.budget,
    });
    const crashed = store.getSteps(out.runId).find((s) => String(s.result?.error ?? '').startsWith('skill crashed'));
    store.close();
    if (crashed) {
      console.log(`INVALID: skill ${crashed.action.name} crashed on world ${seed}: ${crashed.result.error}`);
      return false;
    }
  }
  console.log('VALID');
  return true;
}

const COMMANDS = { run, coach, loop, replay, compare, runs };

if (command === 'validate') {
  try {
    process.exitCode = (await validate()) ? 0 : 1;
  } catch (error) {
    console.log(`INVALID: ${error.message}`);
    process.exitCode = 1;
  }
} else if (!COMMANDS[command]) {
  console.log(USAGE);
  process.exitCode = command ? 2 : 0;
} else {
  const store = openStore(values.data);
  try {
    process.exitCode = (await COMMANDS[command](store)) ? 0 : 1;
  } catch (error) {
    console.error(`error: ${error.message}`);
    process.exitCode = 2;
  } finally {
    store.close();
  }
}
