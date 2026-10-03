// The loop: the model chooses among skills, skills act as code, the coach writes the next
// playbook. The model and Claude are stood in for here; the real ones are run by hand and
// their results are in the README.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertAdapter } from '../harness/adapter.mjs';
import { coachRun, parseCoachReply } from '../harness/coach.mjs';
import { llamaPlayer } from '../harness/players/llama.mjs';
import { fromList, seededRandom } from '../harness/players/scripted.mjs';
import { replayRun } from '../harness/replay.mjs';
import { runOnce } from '../harness/runner.mjs';
import { loadPlaybook, playbookDir, withSkills } from '../harness/skills.mjs';
import { openStore } from '../harness/store.mjs';
import { createAdapter } from '../games/testbed/adapter.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const tempDir = () => mkdtempSync(join(tmpdir(), 'gib-'));
const GRASS = ['.....', '.....', '.....', '.....', '.....'];
const firstPlaybook = () => loadPlaybook(playbookDir(ROOT, 'testbed', 'v001'));

function writePlaybook(code, briefing = 'test briefing') {
  const dir = tempDir();
  writeFileSync(join(dir, 'briefing.md'), briefing);
  writeFileSync(join(dir, 'skills.js'), code);
  return dir;
}

const BOOM = `skills = { boom: { about: 'always fails', async run() { throw new Error('bang'); } } };`;

test("the first playbook offers the game's own actions as skills", async () => {
  const game = withSkills(createAdapter(), firstPlaybook());
  await game.reset({ seed: 's', options: { map: GRASS } });
  assert.deepEqual((await game.actions()).map((a) => a.name), ['step:north', 'step:south', 'step:east', 'step:west']);
  const out = await game.act({ name: 'step:east' });
  assert.equal(out.result.ok, true);
  assert.equal(out.result.actions, 1);
  assert.deepEqual((await game.observe()).pos, { x: 3, y: 2 });
});

test('a run played through skills keeps its playbook version, its timings, and replays', async () => {
  const store = openStore(tempDir());
  const out = await runOnce({
    adapter: withSkills(createAdapter(), firstPlaybook()), player: seededRandom('p'), store, seed: 'w',
    budget: { ticks: 60, calls: 60 }, skillLibraryVersion: 'testbed/v001',
  });
  assert.equal(store.getRun(out.runId).skill_library_version, 'testbed/v001');
  for (const s of store.getSteps(out.runId)) {
    assert.ok(Number.isInteger(s.decideMs) && s.decideMs >= 0);
    assert.ok(Number.isInteger(s.actMs) && s.actMs >= 0);
    assert.ok(s.options.includes(s.action.name), 'the options offered are stored, and the choice is one of them');
  }
  assert.ok(Number.isInteger(out.metrics.decide_ms_median));
  assert.ok(out.metrics.options_median >= 2);
  assert.equal(out.metrics.forced_decisions, 0);
  const replay = await replayRun({ store, runId: out.runId, adapter: withSkills(createAdapter(), firstPlaybook()) });
  assert.deepEqual(replay, { ok: true, checked: out.steps, divergence: null });
});

test('a skill that crashes is recorded and the run goes on', async () => {
  const store = openStore(tempDir());
  const out = await runOnce({
    adapter: withSkills(createAdapter(), loadPlaybook(writePlaybook(BOOM))), player: fromList(['boom']), store,
    seed: 'w', options: { map: GRASS }, budget: { ticks: 100, calls: 3 },
  });
  assert.equal(out.endedReason, 'budget_calls');
  assert.equal(out.steps, 3);
  for (const s of store.getSteps(out.runId)) {
    assert.deepEqual(s.result, { ok: false, error: 'skill crashed: bang', actions: 0 });
  }
});

test('a skill that never stops is cut off at 300 actions', async () => {
  const pace = `skills = { pace: { about: 'walks forever', async run(api) { for (;;) { await api.act('north'); await api.act('south'); } } } };`;
  const store = openStore(tempDir());
  const out = await runOnce({
    adapter: withSkills(createAdapter(), loadPlaybook(writePlaybook(pace))), player: fromList(['pace']), store,
    seed: 'w', options: { map: GRASS }, budget: { ticks: 1000, calls: 1 },
  });
  const [step] = store.getSteps(out.runId);
  assert.equal(step.result.actions, 300);
  assert.match(step.result.error, /skill crashed: used more than 300 actions/);
});

test('skills.js runs with no process, require, fetch or timers in reach', async () => {
  const probe = `skills = { probe: { about: 'reports what it can reach', async run() {
    return [typeof process, typeof require, typeof fetch, typeof setTimeout].join(' '); } } };`;
  const game = withSkills(createAdapter(), loadPlaybook(writePlaybook(probe)));
  await game.reset({ seed: 's', options: { map: GRASS } });
  assert.equal((await game.act({ name: 'probe' })).result.note, 'undefined undefined undefined undefined');
});

test('a playbook that is not written as the contract says is refused by name', () => {
  assert.throws(() => loadPlaybook(writePlaybook('skills = {')), /Unexpected/);
  assert.throws(() => loadPlaybook(writePlaybook(`skills = { x: { about: 'no run' } };`)), /x: run must be a function/);
  assert.throws(() => loadPlaybook(writePlaybook('const y = 1;')), /did not set skills/);
  assert.throws(() => loadPlaybook(writePlaybook(`skills = { 'Bad Name': { about: 'a', run() {} } };`)), /must be lowercase/);
  const declared = loadPlaybook(writePlaybook(`const skills = { fine: { about: 'a', async run() { return 'ok'; } } };`));
  assert.deepEqual(Object.keys(declared.skills), ['fine']);
});

test('the model player sends the offered options and reads the choice', async () => {
  const seen = [];
  let reply = '{"do":"step:east"}';
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      seen.push(JSON.parse(body));
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ choices: [{ message: { content: reply } }], timings: { prompt_ms: 5 } }));
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const player = llamaPlayer({ url: `http://127.0.0.1:${server.address().port}`, label: 'stub', modelHash: 'abc', briefing: 'Go east.' });
    const input = {
      observation: { pos: { x: 1, y: 1 } },
      actions: [{ name: 'step:east', about: 'walk east' }, { name: 'gather', about: 'collect' }],
      rules: 'A game.',
      previous: [{ action: { name: 'gather' }, result: { ok: true } }],
    };
    const first = await player.decide(input);
    assert.deepEqual(first.action, { name: 'step:east' });
    assert.match(first.promptHash, /^[0-9a-f]{64}$/);
    assert.deepEqual(first.response.timings, { prompt_ms: 5 });
    const [sent] = seen;
    assert.equal(sent.temperature, 0);
    assert.equal(sent.cache_prompt, true);
    assert.deepEqual(sent.response_format.json_schema.schema.properties.do.enum, ['step:east', 'gather']);
    assert.match(sent.messages[0].content, /Rules: A game\./);
    assert.match(sent.messages[0].content, /Go east\./);
    assert.match(sent.messages[1].content, /- gather: collect/);
    assert.match(sent.messages[1].content, /gather -> \{"ok":true\}/);
    reply = 'I think east';
    assert.deepEqual((await player.decide(input)).action, { name: null }, 'an answer that is not the JSON asked for is no action');
  } finally {
    server.close();
  }
});

// A copy of the repo's first playbook in a scratch root, and one stored run to coach.
async function coachSetup() {
  const root = tempDir();
  cpSync(join(ROOT, 'playbooks', 'testbed', 'v001'), join(root, 'playbooks', 'testbed', 'v001'), { recursive: true });
  const playbook = loadPlaybook(playbookDir(root, 'testbed', 'v001'));
  const store = openStore(tempDir());
  const run = await runOnce({
    adapter: withSkills(createAdapter(), playbook), player: seededRandom('p'), store, seed: 'w',
    budget: { ticks: 40, calls: 20 }, skillLibraryVersion: 'testbed/v001',
  });
  const prompts = [];
  const coach = (reply, validate) => coachRun({
    store, runId: run.runId, root, game: 'testbed', version: 'v001', playbook, rules: 'rules here',
    vocabulary: [{ name: 'north', about: 'walk north' }], validate,
    ask: async (prompt) => { prompts.push(prompt); return { text: reply, costUsd: 0.01 }; },
  });
  return { root, store, run, playbook, prompts, coach };
}

const reply = (briefing, skills) =>
  `<score>4</score>\n<reasons>It wandered.</reasons>\n<summary>Told it to find trees first.</summary>\n<briefing>${briefing}</briefing>\n<skills>${skills}</skills>`;

test('the coach writes the next playbook version, and the verdict is stored with the run', async () => {
  const { root, store, run, playbook, prompts, coach } = await coachSetup();
  const out = await coach(reply('Find a tree first.', 'KEEP'), async () => null);
  assert.equal(out.newVersion, 'v002');
  const next = loadPlaybook(playbookDir(root, 'testbed', 'v002'));
  assert.equal(next.briefing, 'Find a tree first.');
  assert.equal(next.code.trim(), playbook.code.trim());
  assert.equal(prompts.length, 1);
  for (const expected of [/rules here/, /- north: walk north/, /Ended by \w+ after \d+ decisions/, /chose (step|gather|craft)/, /No advice yet/, /skills = \{/]) {
    assert.match(prompts[0], expected);
  }
  const [evaluation] = store.getEvaluations(run.runId);
  assert.equal(evaluation.score, 4);
  assert.equal(evaluation.reasons_md, 'It wandered.');
  assert.equal(evaluation.suggestions.newVersion, 'testbed/v002');
  const versions = store.db.prepare('SELECT version, parent_version, created_by_run FROM skill_versions').all().map((row) => ({ ...row }));
  assert.deepEqual(versions, [{ version: 'testbed/v002', parent_version: 'testbed/v001', created_by_run: run.runId }]);
});

test('planted fault: a playbook that fails validation is not adopted, and the coach is told why', async () => {
  const { root, store, run, prompts, coach } = await coachSetup();
  const out = await coach(reply('Use boom.', BOOM), async () => 'INVALID: skill boom crashed');
  assert.equal(out.newVersion, null);
  assert.equal(out.rejected, 'INVALID: skill boom crashed');
  assert.equal(prompts.length, 2);
  assert.doesNotMatch(prompts[0], /YOUR LAST ANSWER WAS REJECTED/);
  assert.match(prompts[1], /YOUR LAST ANSWER WAS REJECTED: INVALID: skill boom crashed/);
  assert.equal(existsSync(playbookDir(root, 'testbed', 'v002')), false);
  assert.equal(existsSync(join(root, 'playbooks', 'testbed', '.candidate')), false);
  assert.equal(store.getEvaluations(run.runId)[0].suggestions.rejected, 'INVALID: skill boom crashed');
});

test('a coach that keeps everything makes no new version', async () => {
  const { root, coach } = await coachSetup();
  const out = await coach(reply('KEEP', 'KEEP'), async () => { throw new Error('nothing to validate'); });
  assert.equal(out.newVersion, null);
  assert.equal(out.rejected, null);
  assert.equal(existsSync(playbookDir(root, 'testbed', 'v002')), false);
});

test('a coach reply is read by its sections, and a missing one is an error', () => {
  const parsed = parseCoachReply(reply('Go.', '```js\nskills = {};\n```'));
  assert.deepEqual(parsed, { score: 4, reasons: 'It wandered.', summary: 'Told it to find trees first.', briefing: 'Go.', skills: 'skills = {};' });
  assert.throws(() => parseCoachReply('<score>5</score><reasons>fine</reasons>'), /missing one of/);
});

const botLibrary = existsSync(join(ROOT, 'node_modules', 'mineflayer'));
test('the Minecraft adapter meets the contract before anything is started', { skip: botLibrary ? false : 'the bot library is not installed; run npm install' }, async () => {
  const minecraft = await import('../games/minecraft/adapter.mjs');
  const adapter = assertAdapter(minecraft.createAdapter({ root: ROOT }));
  assert.equal(adapter.name, 'minecraft');
  assert.equal(adapter.version, '26.1');
  assert.equal(adapter.ended(), null);
  assert.deepEqual(adapter.actions(), [], 'with no bot in a world there is nothing to choose');
  assert.match(adapter.describe(), /Minecraft survival/);
  assert.ok(adapter.vocabulary().some((a) => a.name.startsWith('collect:')));
  assert.equal(minecraft.defaults.seed, '7040093665601660210');
  const first = loadPlaybook(playbookDir(ROOT, 'minecraft', 'v001'));
  assert.deepEqual(Object.keys(first.skills), ['collect', 'craft', 'place', 'explore']);
});

test('validate passes the first playbook and fails one whose skill crashes', () => {
  const cli = (...args) =>
    execFileSync(process.execPath, ['--disable-warning=ExperimentalWarning', join(ROOT, 'iterate.mjs'), ...args], { encoding: 'utf8' });
  assert.match(cli('validate', 'testbed', playbookDir(ROOT, 'testbed', 'v001')), /^VALID/);
  assert.throws(
    () => cli('validate', 'testbed', writePlaybook(BOOM)),
    (error) => error.status === 1 && /INVALID: skill boom crashed on world/.test(error.stdout),
  );
});
