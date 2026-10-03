import { execFileSync } from 'node:child_process';
import { assertAdapter } from './adapter.mjs';
import { canon, sha256 } from './canon.mjs';

export const ILLEGAL = Object.freeze({ ok: false, error: 'illegal action' });

// Each step's hash covers the hash before it, so one value stands for the whole run.
export function traceLink(previous, step) {
  return sha256(previous + canon(step));
}

// The commit a run was played on. A dirty tree is marked, since its code is not in git.
export function codeCommit(cwd) {
  try {
    const git = (...args) =>
      execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    return git('rev-parse', 'HEAD') + (git('status', '--porcelain') ? '+dirty' : '');
  } catch {
    return 'unknown';
  }
}

// Apply one chosen action. An action the game did not offer is recorded, not sent: the
// game does not move, and the call is still spent. Replay uses this same function, so a
// run and its replay cannot treat an action differently.
export async function applyAction(adapter, legal, action) {
  if (!legal.some((a) => a.name === action?.name)) return { result: ILLEGAL, events: [], illegal: true };
  const out = await adapter.act(action);
  const now = adapter.tick();
  const events = (out.events ?? []).map((e) => ({ tick: e.tick ?? now, kind: e.kind, detail: e.detail ?? {} }));
  return { result: out.result, events, illegal: false };
}

function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

// One run: reset the game from its seed, let the player act until the game ends or a
// budget runs out, and store every step as it happens. budget is { ticks, calls }:
// game ticks and player calls, whichever is reached first. How long each decision and
// each action took is stored beside the step; it is never part of the trace hash.
export async function runOnce({
  adapter, player, store, seed, options = {}, budget, commit = 'unknown', skillLibraryVersion = null, onStep = null,
}) {
  assertAdapter(adapter);
  seed = String(seed);
  await adapter.reset({ seed, options });
  const runId = store.beginRun({
    game: adapter.name,
    gameVersion: adapter.version,
    startedAt: new Date().toISOString(),
    seed,
    options,
    commit,
    player: player.id,
    modelHash: player.modelHash ?? null,
    promptVersion: player.promptVersion ?? null,
    skillLibraryVersion,
    budget,
  });

  const log = { steps: [], events: [] };
  const decideTimes = [];
  const optionCounts = [];
  let calls = 0;
  let illegalCount = 0;
  let trace = '';
  let reason = null;
  let metrics = {};
  try {
    for (;;) {
      reason = adapter.ended();
      if (reason) break;
      const tick = adapter.tick();
      if (tick >= budget.ticks) { reason = 'budget_ticks'; break; }
      if (calls >= budget.calls) { reason = 'budget_calls'; break; }

      const observation = await adapter.observe();
      const legal = await adapter.actions();
      const startedDeciding = performance.now();
      const decision = await player.decide({
        observation,
        actions: legal,
        rules: adapter.describe(),
        seq: log.steps.length,
        previous: log.steps.slice(-3).map((s) => ({ action: s.action, result: s.result })),
      });
      const startedActing = performance.now();
      calls += decision.calls ?? 1;
      const action = decision.action ?? { name: null };
      const { result, events, illegal } = await applyAction(adapter, legal, action);
      const finished = performance.now();
      if (illegal) illegalCount += 1;

      const step = { seq: log.steps.length, tick, observation, action, result, events };
      trace = traceLink(trace, step);
      const decideMs = Math.round(startedActing - startedDeciding);
      store.step(runId, {
        ...step,
        promptHash: decision.promptHash ?? null,
        response: decision.response ?? null,
        decideMs,
        actMs: Math.round(finished - startedActing),
        options: legal.map((a) => a.name),
      });
      decideTimes.push(decideMs);
      optionCounts.push(legal.length);
      onStep?.({ ...step, options: legal.map((a) => a.name), decideMs, actMs: Math.round(finished - startedActing) });
      log.steps.push(step);
      log.events.push(...events);
    }
    metrics = {
      steps: log.steps.length,
      calls,
      ticks: adapter.tick(),
      illegal_actions: illegalCount,
      decide_ms_median: median(decideTimes),
      decide_ms_total: decideTimes.reduce((sum, ms) => sum + ms, 0),
      // A decision with one option is no decision. These two say how much the player chose.
      options_median: median(optionCounts),
      forced_decisions: optionCounts.filter((n) => n === 1).length,
      ...adapter.metrics(log),
    };
  } catch (error) {
    store.endRun(runId, {
      endedAt: new Date().toISOString(),
      endedReason: 'error',
      steps: log.steps.length,
      traceHash: trace,
      metrics: {},
      error: String(error?.message ?? error),
    });
    throw error;
  } finally {
    await adapter.close();
  }

  store.endRun(runId, {
    endedAt: new Date().toISOString(),
    endedReason: reason,
    steps: log.steps.length,
    traceHash: trace,
    metrics,
  });
  return { runId, endedReason: reason, steps: log.steps.length, traceHash: trace, metrics };
}
