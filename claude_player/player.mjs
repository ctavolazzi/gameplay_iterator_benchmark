#!/usr/bin/env node
// Claude's own player in a local Minecraft world. One long-running process holds the
// connection; everything that is meant to improve (skills/, lib.mjs, reflexes.mjs) is
// loaded again whenever its file changes, so the player keeps playing while it is edited.
// Every skill call, hit taken, death and advancement goes to data/claude_player/journal.jsonl.
//
//   node claude_player/player.mjs serve [--port 25566]     join and wait for requests
//   node claude_player/player.mjs status | observe
//   node claude_player/player.mjs run collect '{"block":"log","count":3}'
//   node claude_player/player.mjs plan '[{"skill":"craft","args":{"item":"planks"}}]'
//   node claude_player/player.mjs wait 240        until idle or 240 s, then what happened
//   node claude_player/player.mjs events 20 | summary | stop | say hello | quit

import http from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { diffCarried, parseAdvancement, summarize } from './pure.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const DATA = join(HERE, '..', 'data', 'claude_player');
const CONTROL = join(DATA, 'control.json');
const JOURNAL = join(DATA, 'journal.jsonl');
const EARNED = join(DATA, 'advancements.json');
const NAME = 'Claude';
const CONTROL_PORT = 8767;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// A file under this folder, loaded again only when it has changed on disk.
const fresh = (file) => {
  const path = join(HERE, file);
  return import(`${pathToFileURL(path).href}?v=${statSync(path).mtimeMs}`);
};

async function serve(gamePort) {
  const mineflayer = (await import('mineflayer')).default;
  const { pathfinder, Movements } = (await import('mineflayer-pathfinder')).default;
  mkdirSync(DATA, { recursive: true });
  const earned = existsSync(EARNED) ? JSON.parse(readFileSync(EARNED, 'utf8')) : {};
  const recent = [];
  let seq = 0;
  const event = (kind, detail = {}) => {
    const row = { n: ++seq, at: new Date().toISOString(), kind, ...detail };
    appendFileSync(JOURNAL, `${JSON.stringify(row)}\n`);
    recent.push(row);
    if (recent.length > 400) recent.shift();
    return row;
  };

  const bot = mineflayer.createBot({ host: '127.0.0.1', port: gamePort, username: NAME,
    version: '26.1', auth: 'offline', hideErrors: true });
  bot.loadPlugin(pathfinder);

  let ready = false;
  let lastHealth = 20;
  let lastCarried = {};
  let current = null;      // the skill running now
  let queue = [];          // skill calls waiting their turn
  let pumping = false;
  let lastSkill = null;
  const reflexState = { holdUntil: 0 };

  const carried = () => {
    const out = {};
    for (const item of bot.inventory?.items() ?? []) out[item.name] = (out[item.name] ?? 0) + item.count;
    return out;
  };
  const where = () => bot.entity ? { x: Math.round(bot.entity.position.x), y: Math.round(bot.entity.position.y), z: Math.round(bot.entity.position.z) } : null;
  const halt = () => {
    bot.pathfinder?.setGoal(null);
    try { bot.stopDigging(); } catch { /* not digging */ }
    bot.clearControlStates?.();
  };
  const stopAll = (reason) => {
    const dropped = queue.length;
    queue = [];
    current?.controller.abort(new Error(reason));
    halt();
    return { ok: true, stopped: current?.name ?? null, dropped };
  };

  bot.on('login', () => event('login', { port: gamePort }));
  bot.on('spawn', () => {
    const movements = new Movements(bot);
    movements.allowParkour = false;
    movements.maxDropDown = 4;
    bot.pathfinder.setMovements(movements);
    lastHealth = bot.health ?? 20;
    ready = true;
    event('spawn', { where: where() });
  });
  bot.on('death', () => {
    event('death', { where: where(), lost: lastCarried, doing: current?.name ?? null });
    stopAll('died');
  });
  bot.on('health', async () => {
    if (bot.health < lastHealth - 0.01) {
      const lib = await fresh('lib.mjs');
      const foe = bot.nearestEntity((e) => lib.isHostile(e) && e.position.distanceTo(bot.entity.position) < 12);
      event('damage', { from: +lastHealth.toFixed(1), to: +bot.health.toFixed(1), food: bot.food,
        near: foe?.name ?? null, doing: current?.name ?? null, where: where() });
    }
    lastHealth = bot.health;
  });
  bot.on('message', (message) => {
    const title = parseAdvancement(message.toString(), NAME);
    if (!title || earned[title]) return;
    earned[title] = new Date().toISOString();
    writeFileSync(EARNED, JSON.stringify(earned, null, 1));
    event('advancement', { name: title, doing: current?.name ?? null });
  });
  bot.on('chat', (username, message) => { if (username !== NAME) event('chat', { username, message }); });
  bot.on('kicked', (reason) => event('kicked', { reason: JSON.stringify(reason).slice(0, 300) }));
  bot.on('error', (error) => event('error', { message: error.message }));
  bot.on('end', (reason) => {
    ready = false;
    event('end', { reason: String(reason) });
    setTimeout(() => process.exit(2), 200);
  });

  // Run one skill file. A skill may call others through ctx.skill.
  async function call(name, args, signal, notes, depth) {
    if (!/^[a-z][a-z0-9_]*$/.test(name)) throw new Error(`bad skill name ${name}`);
    if (depth > 4) throw new Error('skills nested too deep');
    if (!existsSync(join(HERE, 'skills', `${name}.mjs`))) throw new Error(`no skill called ${name}`);
    const [lib, skill] = [await fresh('lib.mjs'), await fresh(`skills/${name}.mjs`)];
    const ctx = { bot, api: lib.make(bot, signal), signal,
      note: (text) => notes.push(String(text).slice(0, 200)),
      skill: (other, otherArgs = {}) => call(other, otherArgs, signal, notes, depth + 1) };
    return skill.default(ctx, args ?? {});
  }

  async function execute(step) {
    const timeout = Math.max(5, Math.min(900, Number(step.timeout) || 180));
    const controller = new AbortController();
    const before = { carried: carried(), health: bot.health, where: bot.entity.position.clone(), earned: Object.keys(earned) };
    const started = Date.now();
    current = { name: step.skill, args: step.args ?? {}, started, controller, notes: [] };
    const timer = setTimeout(() => controller.abort(new Error(`out of time after ${timeout} s`)), timeout * 1000);
    let result;
    try {
      // A skill that does not stop by itself is left behind 3 s after it was told to.
      const abandoned = new Promise((_, reject) => controller.signal.addEventListener('abort',
        () => setTimeout(() => reject(controller.signal.reason), 3000), { once: true }));
      result = await Promise.race([call(step.skill, step.args, controller.signal, current.notes, 0), abandoned]);
      if (typeof result === 'string') result = { note: result };
      result = { ok: true, ...result };
    } catch (error) {
      result = { ok: false, error: String(error?.message ?? error).slice(0, 300) };
    } finally {
      clearTimeout(timer);
      halt();
    }
    const { gained, lost } = diffCarried(before.carried, carried());
    const row = event('skill', { skill: step.skill, args: step.args ?? {}, ok: !!result.ok,
      note: result.note ?? result.error ?? null, ms: Date.now() - started, gained, lost,
      health: [+before.health.toFixed(1), +(bot.health ?? 0).toFixed(1)],
      moved: bot.entity ? Math.round(bot.entity.position.distanceTo(before.where)) : null,
      advancements: Object.keys(earned).filter((name) => !before.earned.includes(name)),
      ...(current.notes.length && { notes: current.notes }) });
    lastSkill = row;
    current = null;
    return row;
  }

  async function pump() {
    if (pumping) return;
    pumping = true;
    try {
      while (queue.length) {
        while (!ready || Date.now() < reflexState.holdUntil) await sleep(250);
        const step = queue.shift();
        if (!step) break;
        const row = await execute(step);
        if (!row.ok && step.stopOnFail && queue.length) {
          event('plan_stopped', { after: step.skill, dropped: queue.length });
          queue = [];
        }
      }
    } finally {
      pumping = false;
    }
  }

  // Reflexes run twice a second, whether or not a skill is running.
  let reflexBusy = false;
  let lastReflexError = null;
  setInterval(async () => {
    if (!ready || reflexBusy) return;
    reflexBusy = true;
    try {
      lastCarried = carried();
      const [lib, reflexes] = [await fresh('lib.mjs'), await fresh('reflexes.mjs')];
      await reflexes.tick({ bot, api: lib.make(bot, null), state: reflexState, busy: current?.name ?? null, event,
        interrupt: (reason) => current?.controller.abort(new Error(`reflex: ${reason}`)) });
    } catch (error) {
      if (error.message !== lastReflexError) event('reflex_error', { message: error.message });
      lastReflexError = error.message;
    } finally {
      reflexBusy = false;
    }
  }, 500);

  const status = () => ({ ok: true, ready, where: where(), health: bot.health ?? null, food: bot.food ?? null,
    carried: carried(), held: bot.heldItem?.name ?? null,
    time: bot.time ? { day: bot.time.day, timeOfDay: bot.time.timeOfDay, isDay: bot.time.isDay } : null,
    doing: current && { skill: current.name, args: current.args, seconds: Math.round((Date.now() - current.started) / 1000), notes: current.notes },
    waiting: queue.map((step) => step.skill), earned: Object.keys(earned), lastSkill, eventCount: seq });

  async function command(action, args) {
    if (action === 'status') return status();
    if (action === 'observe') return { ...status(), ...(ready ? (await fresh('lib.mjs')).observe(bot) : {}) };
    if (action === 'events') return { ok: true, events: recent.filter((row) => row.n > (args.since ?? 0)).slice(-(args.last ?? 30)) };
    if (action === 'stop') return stopAll('asked to stop');
    if (action === 'say') { bot.chat(String(args.text ?? '').slice(0, 200)); return { ok: true }; }
    if (action === 'quit') { stopAll('quitting'); bot.quit(); return { ok: true }; }
    if (action === 'run' || action === 'plan') {
      const steps = action === 'run' ? [{ skill: args.skill, args: args.args, timeout: args.timeout }] : args.steps;
      if (!Array.isArray(steps) || !steps.length || steps.some((step) => typeof step?.skill !== 'string')) {
        throw new Error('expected steps like [{ "skill": "collect", "args": { } }]');
      }
      if (!ready) throw new Error('the player is not in the world yet');
      queue.push(...steps);
      pump();
      return { ok: true, queued: steps.length, waiting: queue.length, eventCount: seq };
    }
    throw new Error(`no action called ${action}`);
  }

  const token = randomBytes(24).toString('hex');
  const secret = Buffer.from(`Bearer ${token}`);
  const server = http.createServer(async (req, res) => {
    const reply = (code, body) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
    try {
      if (req.headers.origin !== undefined) return reply(403, { ok: false, error: 'browsers are not allowed' });
      const given = Buffer.from(req.headers.authorization ?? '');
      if (given.length !== secret.length || !timingSafeEqual(given, secret)) return reply(401, { ok: false, error: 'wrong token' });
      let body = '';
      for await (const chunk of req) { body += chunk; if (body.length > 65536) return reply(413, { ok: false, error: 'too large' }); }
      const { action, args = {} } = JSON.parse(body || '{}');
      reply(200, await command(action, args));
    } catch (error) {
      reply(400, { ok: false, error: error.message });
    }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(CONTROL_PORT, '127.0.0.1', resolve); });
  writeFileSync(CONTROL, JSON.stringify({ port: CONTROL_PORT, token, pid: process.pid }), { mode: 0o600 });
  console.log(`${NAME} joining 127.0.0.1:${gamePort}; control on 127.0.0.1:${CONTROL_PORT}`);
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => {
    stopAll('process stopping');
    bot.quit();
    server.close();
    setTimeout(() => process.exit(0), 1000).unref();
  });
}

async function send(action, args = {}) {
  const { port, token } = JSON.parse(readFileSync(CONTROL, 'utf8'));
  const response = await fetch(`http://127.0.0.1:${port}/command`, { method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ action, args }), signal: AbortSignal.timeout(10000) });
  return response.json();
}

const brief = (row) => {
  const { n, at, kind, ...rest } = row;
  return `${n} ${at.slice(11, 19)} ${kind} ${JSON.stringify(rest)}`;
};

async function main() {
  const [action = 'status', ...rest] = process.argv.slice(2);
  if (action === 'serve') {
    const at = rest.indexOf('--port');
    return serve(at >= 0 ? Number(rest[at + 1]) : 25566);
  }
  if (action === 'summary') {
    const rows = readFileSync(JOURNAL, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line));
    return console.log(JSON.stringify(summarize(rows), null, 1));
  }
  if (action === 'events') {
    const { events } = await send('events', { last: Number(rest[0]) || 30 });
    return console.log(events.map(brief).join('\n'));
  }
  if (action === 'wait') {
    // Until nothing is running or waiting, or the time is up. Then everything since the call.
    const from = (await send('status')).eventCount;
    const deadline = Date.now() + (Number(rest[0]) || 120) * 1000;
    let state;
    do {
      await sleep(2000);
      state = await send('status');
    } while (Date.now() < deadline && (state.doing || state.waiting.length));
    const { events } = await send('events', { since: from, last: 200 });
    console.log(events.map(brief).join('\n'));
    const { doing, waiting, where, health, food, carried } = state;
    return console.log(JSON.stringify({ idle: !doing && !waiting.length, doing, waiting, where, health, food, carried }));
  }
  let args = {};
  if (action === 'say') args = { text: rest.join(' ') };
  else if (action === 'run') args = { skill: rest[0], args: rest[1] ? JSON.parse(rest[1]) : {}, timeout: rest[2] && Number(rest[2]) };
  else if (action === 'plan') args = { steps: JSON.parse(rest[0]) };
  const result = await send(action, args);
  console.log(JSON.stringify(result));
  if (result.ok === false) process.exitCode = 1;
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; });
