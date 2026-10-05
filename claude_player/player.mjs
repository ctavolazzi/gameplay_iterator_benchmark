#!/usr/bin/env node
// Claude's own player in a local Minecraft world. One long-running process holds the
// connection and plays by itself: reflexes four times a second, and whenever nothing is
// running the brain is asked for the next step. Everything that is meant to improve
// (brain.mjs, planner.mjs, reflexes.mjs, lib.mjs, skills/) is loaded again whenever its file
// changes, so the player keeps playing while it is edited. Every step, hit taken, death and
// advancement goes to data/claude_player/journal.jsonl.
//
//   node claude_player/player.mjs serve [--port 25566] [--manual]   join and play
//   node claude_player/player.mjs status | observe | memory
//   node claude_player/player.mjs auto on|off      let the brain choose, or only do as told
//   node claude_player/player.mjs run collect '{"block":"log","count":3}'
//   node claude_player/player.mjs plan '[{"skill":"craft","args":{"item":"planks"}}]'
//   node claude_player/player.mjs wait 240         until idle or 240 s, then what happened
//   node claude_player/player.mjs events 20 | summary | stop | say hello | quit
//   node claude_player/player.mjs look [north|around|<player>|<creature>|<block>|x y z] [--open]
//                                                  a picture from the player's own eyes (eyes.mjs)

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
const MEMORY = join(DATA, 'memory.json');
const NAME = 'Claude';
const CONTROL_PORT = 8767;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const readJson = (path, fallback) => (existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : fallback);

// A file under this folder, loaded again only when it has changed on disk.
const fresh = (file) => {
  const path = join(HERE, file);
  return import(`${pathToFileURL(path).href}?v=${statSync(path).mtimeMs}`);
};

async function serve(gamePort, startAuto) {
  const mineflayer = (await import('mineflayer')).default;
  const { pathfinder, Movements } = (await import('mineflayer-pathfinder')).default;
  mkdirSync(DATA, { recursive: true });
  // What this player has earned: { title: when }. If the file holds anything else (for 15
  // hours on 2026-10-04 it held the game's whole list, written there by advancements.mjs),
  // the record is begun again and filled from the server's log as each is announced.
  const read = readJson(EARNED, {});
  const earned = read && typeof read === 'object' && !Array.isArray(read) && Object.values(read).every((when) => typeof when === 'string') ? read : {};
  const memory = readJson(MEMORY, {});
  const saveMemory = () => writeFileSync(MEMORY, JSON.stringify(memory, null, 1));
  // Deaths are counted from the journal, which has all of them: the count kept in memory only
  // began with the memory file, and read 17 when the server's log had 21. CT sees this number.
  memory.pass = null;
  delete memory.nightPass;   // the two timestamps that passes used to be, set from five places
  delete memory.brave;
  if (existsSync(JOURNAL)) memory.deaths = readFileSync(JOURNAL, 'utf8').split('\n').filter((line) => line.includes('"kind":"death"')).length;
  const recent = [];
  let seq = 0;
  const event = (kind, detail = {}) => {
    const row = { n: ++seq, at: new Date().toISOString(), kind, ...detail };
    appendFileSync(JOURNAL, `${JSON.stringify(row)}\n`);
    recent.push(row);
    if (recent.length > 400) recent.shift();
    return row;
  };

  let bot = null;
  let ready = false;
  let quitting = false;
  let failures = 0;
  let auto = startAuto;
  let lastHealth = 20;
  let lastCarried = {};
  let current = null;      // the step running now
  let queue = [];          // steps asked for by hand, done before the brain is asked
  let lastSkill = null;
  let lastProblem = null;
  let stalls = 0;          // walks in a row that went nowhere
  let lastReconnect = 0;
  let diedAt = 0;          // when it last died, until the respawn has been given a new connection
  let forced = [];         // when the server last put the player back where it was
  let deliberate = false;  // the connection is being ended here, to begin a new one
  const reflexState = { holdUntil: 0 };
  const say = (text, to = null) => {
    const line = String(text).slice(0, 240);
    bot.chat(line);
    event('said', { text: line, to });
  };

  const carried = () => {
    const out = {};
    for (const item of bot?.inventory?.items() ?? []) out[item.name] = (out[item.name] ?? 0) + item.count;
    return out;
  };
  const where = () => (bot?.entity ? { x: Math.round(bot.entity.position.x), y: Math.round(bot.entity.position.y), z: Math.round(bot.entity.position.z) } : null);
  const halt = () => {
    bot.pathfinder?.setGoal(null);
    try { bot.stopDigging(); } catch { /* not digging */ }
    bot.clearControlStates?.();
  };
  const stopAll = (reason) => {
    const dropped = queue.length;
    queue = [];
    current?.controller.abort(new Error(reason));
    if (bot?.entity) halt();
    return { ok: true, stopped: current?.name ?? null, dropped };
  };
  // One line per kind of problem, not one per tick.
  const problem = (kind, error) => {
    const message = String(error?.message ?? error).slice(0, 300);
    if (`${kind}:${message}` !== lastProblem) event(kind, { message });
    lastProblem = `${kind}:${message}`;
  };
  // An error thrown out of a timer inside a library ended the process, and the player with
  // it, at 20:03 on 2026-10-04: the pathfinder's tick read a value it had just emptied, after
  // opening a fence gate. Such an error is journalled, what is running is stopped, and play
  // goes on. More than 5 in a minute is not a slip, and the process ends as it did before.
  const crashes = [];
  for (const kind of ['uncaughtException', 'unhandledRejection']) {
    process.on(kind, (error) => {
      const now = Date.now();
      crashes.push(now);
      while (crashes.length && now - crashes[0] > 60000) crashes.shift();
      console.error(error);
      try { problem('brain_error', `${kind} caught (${crashes.length} in the last minute): ${String(error?.stack ?? error).slice(0, 240)}`); } catch { /* the journal is not there */ }
      try { bot?.pathfinder?.setGoal(null); } catch { /* no pathfinder yet */ }
      try { stopAll(`an error inside a library: ${String(error?.message ?? error).slice(0, 80)}`); } catch { /* nothing running */ }
      if (crashes.length > 5) setTimeout(() => process.exit(3), 200);
    });
  }

  function connect() {
    const started = Date.now();
    const b = mineflayer.createBot({ host: '127.0.0.1', port: gamePort, username: NAME,
      version: '26.1', auth: 'offline', hideErrors: true });
    bot = b;
    b.loadPlugin(pathfinder);
    b.on('login', () => event('login', { port: gamePort }));
    b.on('spawn', () => {
      const movements = new Movements(b);
      movements.allowParkour = false;
      movements.maxDropDown = 4;
      b.pathfinder.setMovements(movements);
      lastHealth = b.health ?? 20;
      ready = true;
      event('spawn', { where: where() });
      // After a death, a fresh connection. After death 25 (22:17:37 on 2026-10-04) this
      // player's own idea of where it was and the server's came apart: here it climbed about
      // in a pit for 12 minutes, there it stood still at its door, and nothing it did took.
      // The same was seen after eight deaths on the first day. A new connection begins from
      // where the server has the player, and costs a few seconds.
      if (diedAt && Date.now() - diedAt < 60000 && !quitting) {
        diedAt = 0;
        setTimeout(() => {
          if (bot !== b || quitting) return;
          lastReconnect = Date.now();
          event('reconnect', { why: 'a fresh connection after a death', where: where() });
          deliberate = true;
          b.quit();
        }, 2500);
      }
    });
    // The server putting the player back where it was, again and again, is the two having
    // come apart while it is alive: 8 times in 15 s, and the connection is begun again.
    b.on('forcedMove', () => {
      const now = Date.now();
      forced = forced.filter((at) => now - at < 15000);
      forced.push(now);
      if (forced.length >= 8 && now - lastReconnect > 120000 && !quitting && !b.isSleeping) {
        forced = [];
        lastReconnect = now;
        event('reconnect', { why: 'the server put the player back 8 times in 15 s', where: where() });
        deliberate = true;
        b.quit();
      }
    });
    b.on('death', () => {
      diedAt = Date.now();
      event('death', { where: where(), lost: lastCarried, doing: current?.name ?? null, night: !b.time?.isDay });
      memory.lastDeath = { at: Date.now(), where: where(), lost: lastCarried };
      memory.deaths = (memory.deaths ?? 0) + 1;
      saveMemory();
      stopAll('died');
    });
    b.on('health', async () => {
      if (b.health < lastHealth - 0.01) {
        const lib = await fresh('lib.mjs');
        const foe = b.nearestEntity((e) => lib.isHostile(e) && e.position.distanceTo(b.entity.position) < 12);
        event('damage', { from: +lastHealth.toFixed(1), to: +b.health.toFixed(1), food: b.food,
          near: foe?.name ?? null, doing: current?.name ?? null, where: where() });
      }
      lastHealth = b.health;
    });
    b.on('message', async (message, position) => {
      const text = message.toString();
      const title = parseAdvancement(text, NAME);
      if (title && !earned[title]) {
        earned[title] = new Date().toISOString();
        writeFileSync(EARNED, JSON.stringify(earned, null, 1));
        event('advancement', { name: title, doing: current?.name ?? null });
      }
      // What the game itself says, not a player, goes to chat.mjs as well: how many are in a
      // bed, and every player's advancements and deaths.
      if (position === 'chat' || !ready) return;
      try {
        const chat = await fresh('chat.mjs');
        if (!chat.overheard) return;
        await chat.overheard({ bot: b, memory, text, position, status: status(), event,
          say: (line) => say(line, 'everyone'), stop: () => stopAll('the game asked') });
        saveMemory();
      } catch (error) {
        problem('chat_error', error);
      }
    });
    // Everything said in chat is journalled, and chat.mjs decides what to say back.
    b.on('chat', async (username, message) => {
      if (username === NAME) return;
      event('chat', { username, message });
      try {
        const chat = await fresh('chat.mjs');
        await chat.heard({ bot: b, memory, username, message, status: status(), event,
          say: (text) => say(text, username),
          stop: () => stopAll(`${username} asked`) });
        saveMemory();
      } catch (error) {
        problem('chat_error', error);
      }
    });
    b.on('kicked', (reason) => event('kicked', { reason: JSON.stringify(reason).slice(0, 300) }));
    b.on('error', (error) => problem('error', error));
    b.on('end', (reason) => {
      ready = false;
      event('end', { reason: String(reason) });
      stopAll('disconnected');
      // A connection this process ended on purpose is not a failure to connect: eight deaths
      // close together would otherwise count as eight and end the process.
      failures = deliberate || Date.now() - started > 60000 ? 0 : failures + 1;
      deliberate = false;
      if (quitting || failures > 8) return setTimeout(() => process.exit(quitting ? 0 : 2), 200);
      setTimeout(connect, Math.min(60000, 5000 * 2 ** failures));
    });
  }

  // Run one skill file. A skill may call others through ctx.skill.
  async function call(name, args, signal, notes, depth) {
    if (!/^[a-z][a-z0-9_]*$/.test(name)) throw new Error(`bad skill name ${name}`);
    if (depth > 4) throw new Error('skills nested too deep');
    if (!existsSync(join(HERE, 'skills', `${name}.mjs`))) throw new Error(`no skill called ${name}`);
    const [lib, skill] = [await fresh('lib.mjs'), await fresh(`skills/${name}.mjs`)];
    const ctx = { bot, api: lib.make(bot, signal, memory), signal, memory,
      note: (text) => notes.push(String(text).slice(0, 200)),
      skill: (other, otherArgs = {}) => call(other, otherArgs, signal, notes, depth + 1) };
    return skill.default(ctx, args ?? {});
  }

  async function execute(step) {
    const timeout = Math.max(5, Math.min(900, Number(step.timeout) || 180));
    const controller = new AbortController();
    const before = { carried: carried(), health: bot.health, where: bot.entity.position.clone(), earned: Object.keys(earned) };
    const started = Date.now();
    current = { name: step.skill, args: step.args ?? {}, started, controller, notes: [], goal: step.goal ?? null };
    // A step may carry a pass: leave to be out after dark (night), or to walk past what would be
    // run from (brave). It lasts exactly as long as the step. This is the only place it is set.
    memory.pass = step.pass ?? null;
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
      memory.pass = null;
      if (bot?.entity) halt();
    }
    const { gained, lost } = diffCarried(before.carried, carried());
    const row = event('skill', { skill: step.skill, args: step.args ?? {}, ok: !!result.ok,
      note: result.note ?? result.error ?? null, ms: Date.now() - started, gained, lost,
      health: [+before.health.toFixed(1), +(bot.health ?? 0).toFixed(1)],
      moved: bot.entity ? Math.round(bot.entity.position.distanceTo(before.where)) : null,
      advancements: Object.keys(earned).filter((name) => !before.earned.includes(name)),
      ...(step.goal && { goal: step.goal, why: step.why }),
      ...(step.pass && { pass: step.pass }),
      ...(current.notes.length && { notes: current.notes }) });
    lastSkill = row;
    current = null;
    return row;
  }

  // The driver: what was asked for by hand first, then whatever the brain says.
  async function drive() {
    for (;;) {
      await sleep(150);
      if (!ready || Date.now() < reflexState.holdUntil) continue;
      let step = queue.shift();
      if (!step && auto) {
        try {
          const [lib, brain] = [await fresh('lib.mjs'), await fresh('brain.mjs')];
          step = await brain.think({ bot, api: lib.make(bot, null, memory), observe: () => lib.observe(bot),
            memory, earned: Object.keys(earned), fresh });
        } catch (error) {
          problem('brain_error', error);
          await sleep(5000);
          continue;
        }
        if (!step) { await sleep(3000); continue; }
        if (!ready || Date.now() < reflexState.holdUntil) continue;
      }
      if (!step) continue;
      const row = await execute(step);
      // A body that has stopped answering. On 2026-10-04, after eight respawns in 131 s, the
      // player stood still for a whole game day: paths were found in 10 ms and nothing walked
      // them. A fresh connection moved at once. Three walks in a row that go nowhere, and the
      // connection is dropped; the reconnect below brings it back.
      // Only a walk that timed out counts. "No path" is the pathfinder saying there is no
      // way, which is true when the player has shut itself in: on its first day this fired 5
      // times in 12 minutes for that, and a new connection changes nothing about a wall.
      // "Nowhere" is 3 blocks or fewer: with the two apart, the player moves in its own idea
      // of the world and the count read 1, 3 and 0 for three walks to a bed 3 blocks off.
      const wentNowhere = !row.ok && (row.moved ?? 0) <= 3 && /took too long|out of time after/.test(row.note ?? '') && !/No path/.test(row.note ?? '');
      stalls = wentNowhere ? stalls + 1 : row.moved > 0 ? 0 : stalls;
      if (stalls >= 3 && Date.now() - lastReconnect > 600000) {
        lastReconnect = Date.now();
        stalls = 0;
        event('reconnect', { why: 'three walks in a row went nowhere', where: where() });
        deliberate = true;
        bot.quit();
        await sleep(3000);
        continue;
      }
      if (step.goal) {
        try { await (await fresh('brain.mjs')).learn({ row, memory, fresh }); } catch (error) { problem('brain_error', error); }
      }
      saveMemory();
      if (!row.ok && step.stopOnFail && queue.length) {
        event('plan_stopped', { after: step.skill, dropped: queue.length });
        queue = [];
      }
    }
  }

  // Reflexes run four times a second, whether or not a skill is running.
  let reflexBusy = false;
  setInterval(async () => {
    if (!ready || reflexBusy) return;
    reflexBusy = true;
    try {
      lastCarried = carried();
      const [lib, reflexes] = [await fresh('lib.mjs'), await fresh('reflexes.mjs')];
      await reflexes.tick({ bot, api: lib.make(bot, null, memory), state: reflexState, memory, busy: current?.name ?? null, event,
        makeApi: (signal) => lib.make(bot, signal, memory),
        interrupt: (reason) => current?.controller.abort(new Error(`reflex: ${reason}`)) });
    } catch (error) {
      problem('reflex_error', error);
    } finally {
      reflexBusy = false;
    }
  }, 250);

  const status = () => ({ ok: true, ready, auto, where: where(), health: bot?.health ?? null, food: bot?.food ?? null,
    carried: carried(), held: bot?.heldItem?.name ?? null,
    time: bot?.time ? { day: bot.time.day, timeOfDay: bot.time.timeOfDay } : null,
    doing: current && { skill: current.name, args: current.args, goal: current.goal, seconds: Math.round((Date.now() - current.started) / 1000) },
    waiting: queue.map((step) => step.skill), thought: memory.thought ?? null,
    held_back: Date.now() < reflexState.holdUntil, sheltered: !!reflexState.sheltered,
    earned: Object.keys(earned), deaths: memory.deaths ?? 0, lastSkill, eventCount: seq });

  async function command(action, args) {
    if (action === 'status') return status();
    if (action === 'observe') return { ...status(), ...(ready ? (await fresh('lib.mjs')).observe(bot) : {}) };
    if (action === 'memory') return { ok: true, memory };
    if (action === 'events') return { ok: true, events: recent.filter((row) => row.n > (args.since ?? 0)).slice(-(args.last ?? 30)) };
    if (action === 'stop') return stopAll('asked to stop');
    if (action === 'auto') { auto = !!args.on; if (!auto) stopAll('asked to stop'); return { ok: true, auto }; }
    if (action === 'say') { say(String(args.text ?? '').slice(0, 240), 'from the session'); return { ok: true }; }
    if (action === 'quit') { quitting = true; stopAll('quitting'); bot.quit(); return { ok: true }; }
    if (action === 'run' || action === 'plan') {
      const steps = action === 'run' ? [{ skill: args.skill, args: args.args, timeout: args.timeout }] : args.steps;
      if (!Array.isArray(steps) || !steps.length || steps.some((step) => typeof step?.skill !== 'string')) {
        throw new Error('expected steps like [{ "skill": "collect", "args": { } }]');
      }
      if (!ready) throw new Error('the player is not in the world yet');
      queue.push(...steps);
      return { ok: true, queued: steps.length, waiting: queue.length, eventCount: seq };
    }
    // Anything else is looked for in actions.mjs, which can be changed while the player plays.
    if (existsSync(join(HERE, 'actions.mjs'))) {
      const actions = await fresh('actions.mjs');
      if (typeof actions[action] === 'function') {
        if (!ready) throw new Error('the player is not in the world yet');
        return actions[action]({ bot, memory, status, event, fresh, say, stop: stopAll, saveMemory, earned: () => Object.keys(earned) }, args);
      }
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
  console.log(`${NAME} joining 127.0.0.1:${gamePort}; control on 127.0.0.1:${CONTROL_PORT}; the brain is ${auto ? 'on' : 'off'}`);
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => {
    quitting = true;
    stopAll('process stopping');
    saveMemory();
    bot?.quit();
    server.close();
    setTimeout(() => process.exit(0), 1000).unref();
  });
  connect();
  drive();
}

async function send(action, args = {}, seconds = 10) {
  const { port, token } = JSON.parse(readFileSync(CONTROL, 'utf8'));
  const response = await fetch(`http://127.0.0.1:${port}/command`, { method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ action, args }), signal: AbortSignal.timeout(seconds * 1000) });
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
    return serve(at >= 0 ? Number(rest[at + 1]) : 25566, !rest.includes('--manual'));
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
    } while (Date.now() < deadline && (state.auto || state.doing || state.waiting.length));
    const { events } = await send('events', { since: from, last: 200 });
    console.log(events.map(brief).join('\n'));
    const { doing, waiting, where, health, food, carried, thought, earned, deaths } = state;
    return console.log(JSON.stringify({ doing, waiting, where, health, food, carried, thought, earned, deaths }));
  }
  if (action === 'look') {
    // The game's own textures are read from the installed game the first time (a few seconds).
    const textures = await import('./textures.mjs');
    if (!existsSync(join(textures.CACHE, 'index.json')) && textures.findJar()) {
      const { execFileSync } = await import('node:child_process');
      execFileSync(process.execPath, [join(HERE, 'textures.mjs')], { stdio: 'inherit' });
    }
    const valued = new Set(['--far', '--width', '--height', '--tag']);
    const words = rest.filter((word, i) => !word.startsWith('--') && !valued.has(rest[i - 1]));
    const flag = (name) => { const at = rest.indexOf(`--${name}`); return at >= 0 ? rest[at + 1] : undefined; };
    const numbers = words.map(Number);
    const args = { ...(words[0]?.startsWith('{') ? JSON.parse(words[0]) : words[0] === 'around' ? { around: true }
      : numbers.length === 3 && numbers.every(Number.isFinite) ? { at: { x: numbers[0], y: numbers[1], z: numbers[2] } } : words[0] ? { at: words.join('_') } : {}),
      ...(flag('far') && { far: Number(flag('far')) }), ...(flag('width') && { width: Number(flag('width')) }), ...(flag('height') && { height: Number(flag('height')) }),
      ...(flag('tag') && { tag: flag('tag') }), ...(rest.includes('--plain') && { plain: true }), ...(rest.includes('--still') && { turn: false }) };
    const seen = await send('look', args, 120);
    if (seen.ok === false) { console.error(seen.error); process.exitCode = 1; return; }
    const { told, seen: creatures, ...short } = seen;
    console.log(JSON.stringify({ ...short, seen: creatures, told: rest.includes('--all') ? told : undefined }, null, 1));
    if (rest.includes('--open')) (await import('node:child_process')).spawn('open', [seen.file], { detached: true, stdio: 'ignore' }).unref();
    return;
  }
  let args = {};
  if (action === 'say') args = { text: rest.join(' ') };
  else if (rest[0]?.startsWith('{')) args = JSON.parse(rest[0]);
  else if (action === 'auto') args = { on: rest[0] !== 'off' };
  else if (action === 'run') args = { skill: rest[0], args: rest[1] ? JSON.parse(rest[1]) : {}, timeout: rest[2] && Number(rest[2]) };
  else if (action === 'plan') args = { steps: JSON.parse(rest[0]) };
  const result = await send(action, args);
  console.log(JSON.stringify(result));
  if (result.ok === false) process.exitCode = 1;
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; });
