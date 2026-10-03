#!/usr/bin/env -S node --disable-warning=ExperimentalWarning
// Try the real-window player one action at a time, with no model, and look at what happened.
//
//   tools/hands_stage.mjs [--shots DIR] step [step ...]
//
// A step is one of the game's own actions (collect:oak_log, craft:planks,
// place:crafting_table, explore:north), or one of:
//   log           collect whichever kind of log is nearest
//   think:N       what the player does while a model thinks, held for N seconds
//   wait:N        do nothing for N seconds
// After every step this prints the result, what is carried and what could be done next, and
// saves a picture of the game window to DIR (data/stage/ by default, which git ignores).
// Nothing is stored in the database: this is for finding out what works, not a run.
//
// The game window takes the keyboard and the mouse while this runs.

import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { createAdapter, defaults } from '../games/minecraft/adapter.mjs';
import { playerWindowPid, windowContent } from '../games/minecraft/hands.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const { values, positionals: steps } = parseArgs({
  allowPositionals: true,
  options: { shots: { type: 'string', default: join(ROOT, 'data', 'stage') } },
});
if (!steps.length) {
  console.error('give at least one step, for example: tools/hands_stage.mjs log craft:planks think:4');
  process.exit(2);
}
mkdirSync(values.shots, { recursive: true });

const started = Date.now();
const say = (text) => console.log(`[${((Date.now() - started) / 1000).toFixed(1).padStart(6)} s] ${text}`);
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let shots = 0;
function shot(name) {
  try {
    const c = windowContent(playerWindowPid());
    const file = join(values.shots, `${String(++shots).padStart(2, '0')}-${name.replace(/[^a-z0-9_]+/gi, '-')}.png`);
    execFileSync('screencapture', ['-x', '-R', `${c.x},${c.y},${c.width},${c.height}`, file]);
    return file;
  } catch (error) {
    return `no picture (${error.message.split('\n')[0]})`;
  }
}

const adapter = createAdapter({ root: ROOT, body: 'hands' });
let closing = false;
async function finish(code) {
  if (closing) return;
  closing = true;
  await adapter.close().catch(() => {});
  say('server stopped; the game window is left open');
  process.exit(code);
}
process.on('SIGINT', () => finish(130));
process.on('SIGTERM', () => finish(143));

let failures = 0;
try {
  say('starting the server and the game window');
  await adapter.reset({ seed: defaults.seed, options: {} });
  say(`in the world. ${shot('start')}`);
  for (const step of steps) {
    if (adapter.ended()) { say(`the game ended: ${adapter.ended()}`); break; }
    const [kind, arg] = step.split(':');
    if (kind === 'wait') {
      await pause(Number(arg) * 1000);
      say(`waited ${arg} s. ${shot(step)}`);
      continue;
    }
    if (kind === 'think') {
      await adapter.idle('start');
      await pause((Number(arg) * 1000) / 2);
      say(`thinking. ${shot('thinking')}`);
      await pause((Number(arg) * 1000) / 2);
      await adapter.idle('stop');
      say(`thought for ${arg} s. ${shot('after-thinking')}`);
      continue;
    }
    const possible = await adapter.actions();
    const name = step === 'log' ? possible.find((a) => /^collect:.*_log$/.test(a.name))?.name : step;
    if (!name || !possible.some((a) => a.name === name)) {
      failures += 1;
      say(`${step}: NOT POSSIBLE NOW. possible: ${possible.map((a) => a.name).join(' ')}`);
      continue;
    }
    const before = Date.now();
    const { result, events } = await adapter.act({ name });
    if (!result.ok) failures += 1;
    say(`${name}: ${result.ok ? 'ok' : 'FAILED'} in ${((Date.now() - before) / 1000).toFixed(1)} s  ${JSON.stringify(result)}`);
    for (const e of events) if (e.kind !== 'item') say(`    event ${e.kind} ${JSON.stringify(e.detail)}`);
    const seen = await adapter.observe();
    say(`    carrying ${JSON.stringify(seen.carrying)}  health ${seen.health}  at ${seen.pos.join(',')}`);
    say(`    ${shot(name)}`);
  }
  say(`RESULT: ${failures ? `${failures} step(s) did not work` : 'every step worked'}`);
} catch (error) {
  failures += 1;
  say(`STOPPED: ${error.stack ?? error}`);
}
await finish(failures ? 1 : 0);
