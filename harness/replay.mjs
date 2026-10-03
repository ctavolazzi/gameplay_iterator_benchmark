import { canon } from './canon.mjs';
import { applyAction, traceLink } from './runner.mjs';

const FIELDS = ['tick', 'observation', 'action', 'result', 'events'];

function firstDifference(a, b) {
  return FIELDS.find((field) => canon(a[field]) !== canon(b[field])) ?? null;
}

// Step by step diff of two stored runs: where they first differ, or that they never do.
export function compareRuns(store, idA, idB) {
  const a = store.getSteps(idA);
  const b = store.getSteps(idB);
  const steps = [a.length, b.length];
  for (let seq = 0; seq < Math.min(a.length, b.length); seq++) {
    const field = firstDifference(a[seq], b[seq]);
    if (field) return { same: false, steps, divergence: { seq, field, a: a[seq][field], b: b[seq][field] } };
  }
  if (a.length !== b.length) {
    return { same: false, steps, divergence: { seq: Math.min(a.length, b.length), field: 'length', a: a.length, b: b.length } };
  }
  return { same: true, steps, divergence: null };
}

// Play a stored run's actions again on a freshly reset game, and check at every step that
// the game shows and answers what the database says it did. A game with randomness of its
// own (Minecraft's mobs) will diverge somewhere; this reports the first place, it does not
// throw.
export async function replayRun({ store, runId, adapter }) {
  const run = store.getRun(runId);
  if (!run) throw new Error(`no run ${runId} in the database`);
  if (run.game !== adapter.name) throw new Error(`run ${runId} is a ${run.game} run, not ${adapter.name}`);
  const stored = store.getSteps(runId);

  await adapter.reset({ seed: run.seed, options: run.options });
  let trace = '';
  try {
    for (const want of stored) {
      const tick = adapter.tick();
      const observation = await adapter.observe();
      const legal = await adapter.actions();
      const { result, events } = await applyAction(adapter, legal, want.action);
      const got = { seq: want.seq, tick, observation, action: want.action, result, events };
      const field = firstDifference(want, got);
      if (field) {
        return { ok: false, checked: want.seq, divergence: { seq: want.seq, field, stored: want[field], replayed: got[field] } };
      }
      trace = traceLink(trace, got);
    }
  } finally {
    await adapter.close();
  }
  if (trace !== run.trace_hash) {
    return { ok: false, checked: stored.length, divergence: { seq: stored.length, field: 'trace_hash', stored: run.trace_hash, replayed: trace } };
  }
  return { ok: true, checked: stored.length, divergence: null };
}
