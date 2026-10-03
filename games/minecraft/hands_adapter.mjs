// Minecraft played through the real game window. The player is the game itself, with keys
// and the mouse pressed from outside (hands.mjs), so what the window shows is a player
// walking, swinging, and opening the inventory and crafting table. It takes the same action
// names as the hidden bot in adapter.mjs, so one playbook serves both.
//
// The screen cannot tell this program where the trees are. A silent helper does: a second,
// headless player named Eyes, in spectator mode with its camera on the real player. It sees
// the blocks around the player and plans paths; it never acts in the world.

import mineflayer from 'mineflayer';
import pathfinderPackage from 'mineflayer-pathfinder';
import vec3Package from 'vec3';
import {
  BOT_NAME, COLLECTIBLE, CRAFTABLE, DIRECTIONS, NEEDS_PICKAXE, NEEDS_STONE_PICKAXE, NOTICED_SINGLY, RECIPES, TOOL_TIERS,
  TRUNK_REACH, describeText, dropOf, gainEvents, heightAboveGround, runMetrics, vocabularyList,
} from './common.mjs';
import { KEY, openHands } from './hands.mjs';
import { aim, canMake, counts, step, turn } from './hands_plan.mjs';
import { MC_VERSION, startServer } from './server.mjs';

const { pathfinder, Movements, goals } = pathfinderPackage;
const { Vec3 } = vec3Package;

const EYES = 'Eyes';
const EYE_HEIGHT = 1.62;
const REACH = 4.3;
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const within = (promise, ms, what) =>
  Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error(`${what} took more than ${ms / 1000} seconds`)), ms))]);

// Death messages all begin with the player's name; these are the words that follow it.
const DIED = new RegExp(`: ${BOT_NAME} (was |fell|drowned|died|burned|went up in|tried to swim|hit the ground|blew up|starved|suffocated|withered|froze|walked into|experienced|discovered the floor|went off with)`);

export function createHandsAdapter({ root }) {
  let server = null;
  let eyes = null;
  let hands = null;
  let movements = null;
  let lines = [];
  let online = false;
  let dead = false;
  let startAge = 0;
  let startedAt = 0;
  let lastHealth = 20;
  let pending = [];
  let reached = new Set();
  let walked = 0;
  let lastSpot = null;
  let watcher = null;
  let selected = -1;      // which hotbar place is in hand, when known

  const say = (text) => server?.command(`say ${text}`);

  function onLine(line) {
    lines.push(line);
    if (line.includes(`${BOT_NAME} joined the game`)) online = true;
    if (line.includes(`${BOT_NAME} left the game`)) online = false;
    if (DIED.test(line)) { dead = true; pending.push({ kind: 'death', detail: { how: line.split(`${BOT_NAME} `)[1]?.slice(0, 80) ?? '' } }); }
    const advancement = line.match(new RegExp(`${BOT_NAME} has (?:made the advancement|completed the challenge|reached the goal) \\[(.+?)\\]`));
    if (advancement) pending.push({ kind: 'advancement', detail: { name: advancement[1] } });
  }

  // Send the server a command and wait for the log line that answers it.
  async function ask(command, pattern, ms = 3000) {
    const from = lines.length;
    server.command(command);
    const deadline = Date.now() + ms;
    while (Date.now() < deadline) {
      for (let i = from; i < lines.length; i++) {
        const hit = lines[i].match(pattern);
        if (hit) return hit;
      }
      await pause(40);
    }
    return null;
  }

  const me = () => eyes?.players?.[BOT_NAME]?.entity ?? null;
  const feet = () => me().position.clone();
  const nearest = (name, distance) => eyes.findBlock({ point: feet(), matching: (block) => block.name === name, maxDistance: distance });

  async function vitals() {
    const health = await ask(`data get entity ${BOT_NAME} Health`, /entity data: (-?[\d.]+)f/);
    const food = await ask(`data get entity ${BOT_NAME} foodLevel`, /entity data: (-?\d+)/);
    return { health: health ? Number(health[1]) : lastHealth, food: food ? Number(food[1]) : 20 };
  }

  function noteHealth(health) {
    if (health < lastHealth) pending.push({ kind: 'damage', detail: { amount: Math.round((lastHealth - health) * 10) / 10, health: Math.round(health) } });
    if (health <= 0) dead = true;
    lastHealth = health;
  }

  function around() {
    const from = feet();
    const best = {};
    const note = (at) => {
      const name = eyes.blockAt(at).name;
      const distance = Math.round(at.distanceTo(from));
      if (best[name] === undefined || distance < best[name]) best[name] = distance;
    };
    for (const at of eyes.findBlocks({ point: from, matching: (block) => block.name.endsWith('_log'), maxDistance: 32, count: 300 })) note(at);
    for (const name of NOTICED_SINGLY) {
      const block = nearest(name, 32);
      if (block) note(block.position);
    }
    return Object.fromEntries(Object.entries(best).sort((a, b) => a[1] - b[1]).slice(0, 8));
  }

  const nameAt = (x, y, z) => eyes.blockAt(new Vec3(x, y, z))?.name ?? null;

  function reachable(name) {
    const from = feet();
    const level = Math.floor(from.y);
    const found = eyes.findBlocks({ point: from, matching: (block) => block.name === name, maxDistance: 48, count: 128 });
    const nearestOf = (list) => list.sort((a, b) => a.distanceTo(from) - b.distanceTo(from))[0] ?? null;
    if (name.endsWith('_log')) {
      // The foot of a trunk, as a person would take it, and not a branch up in the leaves:
      // going after those walks the player up into the canopy, where little else works.
      const trunk = nearestOf(found.filter((at) => heightAboveGround(nameAt, at) <= TRUNK_REACH));
      if (trunk) return trunk;
    }
    const lowest = NEEDS_PICKAXE.test(name) ? level - 20 : level - 6;
    return nearestOf(found.filter((at) => at.y <= level + 2 && at.y >= lowest));
  }

  // Put the best tool for a block in hand, if one is carried in the hotbar.
  async function toolFor(name, slots) {
    const ending = NEEDS_PICKAXE.test(name) || /stone|ore|andesite|diorite|granite|deepslate|cobble/.test(name) ? '_pickaxe'
      : /_log$|_planks$|crafting_table/.test(name) ? '_axe' : null;
    if (!ending) return;
    const tools = slots.filter((s) => s.item.endsWith(ending))
      .sort((a, b) => TOOL_TIERS.findIndex((t) => a.item.startsWith(t)) - TOOL_TIERS.findIndex((t) => b.item.startsWith(t)));
    const tool = tools[0];
    if (!tool) return;
    let place = tool.slot;
    if (place > 8) { place = 8; await hands.toHotbar(tool.slot, place); }
    if (selected !== place) { await hands.hotbar(place); selected = place; }
  }

  // The first block along the crosshair from where the player stands, within its reach.
  function sight(from, yaw, pitch) {
    const y = (yaw * Math.PI) / 180;
    const p = (pitch * Math.PI) / 180;
    const direction = new Vec3(-Math.sin(y) * Math.cos(p), -Math.sin(p), Math.cos(y) * Math.cos(p));
    return eyes.world.raycast(from.offset(0, EYE_HEIGHT, 0), direction, REACH + 0.2);
  }

  // Break one block with the left button held, the way a player does. If something else is
  // in the way of the crosshair, that is what gets broken first.
  async function breakBlock(at, limit = 14000) {
    const slots = await hands.carried();
    for (let tries = 0; tries < 5; tries++) {
      const block = eyes.blockAt(at);
      if (!block || block.name === 'air') return true;
      const from = feet();
      const { yaw, pitch } = aim(from, at.offset(0.5, 0.5, 0.5));
      await hands.look(yaw, pitch, 220);
      const hit = sight(from, yaw, pitch);
      if (!hit) return false;                       // nothing in reach along that line
      const victim = hit.position;
      const name = eyes.blockAt(victim).name;
      await toolFor(name, slots);
      await hands.press('left');
      const deadline = Date.now() + limit;
      while (Date.now() < deadline && eyes.blockAt(victim)?.name === name && !dead) await pause(80);
      await hands.unpress();
      if (eyes.blockAt(victim)?.name === name) return false;
      if (victim.equals(at)) return true;
    }
    return eyes.blockAt(at)?.name === 'air';
  }

  function plan(goal, ms = 5000) {
    const { value } = eyes.pathfinder.getPathFromTo(movements, feet(), goal, { timeout: ms, tickTimeout: ms }).next();
    return value.result;
  }

  // Walk a planned path with the W key held, turning as it goes.
  async function follow(path, limit) {
    const deadline = Date.now() + limit;
    try {
      for (const node of path) {
        for (const b of node.toBreak ?? []) {
          await hands.release(KEY.w);
          if (!(await breakBlock(new Vec3(b.x, b.y, b.z)))) return 'blocked';
        }
        // A planned step is a block, or a point already in the middle of one.
        const target = new Vec3(Math.floor(node.x) + 0.5, node.y, Math.floor(node.z) + 0.5);
        let best = Infinity;
        let progressAt = Date.now();
        let hops = 0;
        for (;;) {
          if (dead) return 'dead';
          if (Date.now() > deadline) return 'timeout';
          const p = feet();
          const flat = Math.hypot(target.x - p.x, target.z - p.z);
          if (flat < 0.4 && Math.abs(p.y - node.y) < 1.3) break;
          if (flat < best - 0.04) { best = flat; progressAt = Date.now(); }
          const want = aim(p, new Vec3(target.x, p.y + EYE_HEIGHT, target.z)).yaw;
          const now = hands.direction();
          if (Math.abs(turn(now.yaw, want)) > 55) {
            await hands.release(KEY.w);
            await hands.look(want, 14, 200);
          } else {
            hands.face(step(now.yaw, want, 14), now.pitch + (14 - now.pitch) * 0.3);
          }
          await hands.hold(KEY.w);
          // In water a player holds the jump key to stay up.
          if (eyes.blockAt(p.floored())?.name === 'water') await hands.hold(KEY.space);
          else await hands.release(KEY.space);
          if (Date.now() - progressAt > 1300) {
            if (++hops > 3) return 'stuck';
            await hands.tap(KEY.space, 140);
            progressAt = Date.now() - 500;
          }
          await pause(50);
        }
      }
      return 'arrived';
    } finally {
      await hands.release(KEY.w);
      await hands.release(KEY.space);
    }
  }

  async function walkTo(goal, limit) {
    const deadline = Date.now() + limit;
    let why = 'no path';
    for (let leg = 0; leg < 5 && Date.now() < deadline; leg++) {
      const from = feet().floored();
      if (goal.isEnd(from)) return { ok: true };
      const result = plan(goal);
      if (!result.path.length) { why = `no path (${result.status})`; break; }
      const status = await follow(result.path, deadline - Date.now());
      const p = feet();
      if (lastSpot) walked += p.distanceTo(lastSpot);
      lastSpot = p;
      if (status === 'arrived' && result.status === 'success') return { ok: true };
      if (status === 'dead') return { ok: false, why: 'died on the way' };
      why = status;
    }
    return goal.isEnd(feet().floored()) ? { ok: true } : { ok: false, why };
  }

  // A few steps straight at a point close by, with no plan: turn to it and hold W.
  async function stepToward(point, limit) {
    const deadline = Date.now() + limit;
    try {
      while (Date.now() < deadline && !dead) {
        const p = feet();
        if (Math.hypot(point.x - p.x, point.z - p.z) < 0.5) break;
        const want = aim(p, new Vec3(point.x, p.y + EYE_HEIGHT, point.z)).yaw;
        if (Math.abs(turn(hands.direction().yaw, want)) > 20) await hands.look(want, 20, 160);
        await hands.hold(KEY.w);
        await pause(60);
      }
    } finally {
      await hands.release(KEY.w);
    }
  }

  const gains = (before, after) =>
    Object.fromEntries(Object.keys(after).filter((k) => after[k] > (before[k] ?? 0)).map((k) => [k, after[k] - (before[k] ?? 0)]));

  async function collect(name) {
    const target = reachable(name);
    if (!target) return { ok: false, error: `no ${name} within reach of the ground nearby` };
    const before = counts(await hands.carried());
    // Done when what the block leaves behind is carried. One of the same kind dug out of
    // the way while walking counts; dirt picked up on the way does not.
    const wanted = dropOf(name);
    const have = async () => {
      const got = gains(before, counts(await hands.carried()));
      return got[wanted] ? got : null;
    };
    const walk = await walkTo(new goals.GoalLookAtBlock(target, eyes.world, { reach: REACH - 0.5 }), 45000);
    if (!walk.ok) {
      const got = await have();
      return got ? { ok: true, got } : { ok: false, error: `could not get to the ${name}: ${walk.why}` };
    }
    if (!(await breakBlock(target))) {
      const got = await have();
      return got ? { ok: true, got } : { ok: false, error: `could not break the ${name}` };
    }
    // The drop lies where the block was. Walk onto it, as a player does: by a planned path
    // where there is one, and straight at it where there is not.
    let seen = 'no drop in sight';
    for (let tries = 0; tries < 6; tries++) {
      await pause(450);
      const got = await have();
      if (got) return { ok: true, got };
      const from = feet();
      const drop = Object.values(eyes.entities)
        .filter((e) => e.name === 'item' && e.position.distanceTo(from) < 8)
        .sort((a, b) => a.position.distanceTo(from) - b.position.distanceTo(from))[0];
      if (!drop) continue;
      seen = `a drop lies ${drop.position.distanceTo(from).toFixed(1)} blocks off`;
      const spot = drop.position.floored();
      const walk = await walkTo(new goals.GoalBlock(spot.x, spot.y, spot.z), 6000);
      if (!walk.ok) await stepToward(drop.position, 1500);
    }
    return { ok: false, error: `dug the ${name} but did not pick up its ${wanted} (${seen})` };
  }

  async function craft(want) {
    const recipe = RECIPES[want];
    if (!recipe) return { ok: false, error: `no recipe for ${want}` };
    const before = counts(await hands.carried());
    if (recipe.table) {
      const table = nearest('crafting_table', 32);
      if (!table) return { ok: false, error: 'no crafting table nearby' };
      if (table.position.distanceTo(feet()) > 3) {
        const walk = await walkTo(new goals.GoalNear(table.position.x, table.position.y, table.position.z, 2), 75000);
        if (!walk.ok) return { ok: false, error: `could not get to the crafting table: ${walk.why}` };
      }
      // Right click the table, and see that its screen came up before clicking a recipe:
      // clicks meant for a screen that is not there would be swings and stray turns.
      let opened = false;
      for (let tries = 0; tries < 2 && !opened; tries++) {
        const { yaw, pitch } = aim(feet(), table.position.offset(0.5, 0.5, 0.5));
        await hands.look(yaw, pitch, 260);
        await hands.press('right');
        await pause(90);
        await hands.unpress();
        await pause(650);
        opened = (await hands.panelShowing()) !== false;
      }
      if (!opened) return { ok: false, error: 'could not open the crafting table' };
      hands.setScreen('table');
    } else if (!(await hands.openInventory())) {
      return { ok: false, error: 'could not open the inventory' };
    }
    const clicked = await hands.craftOnScreen(recipe, recipe.table);
    await hands.closeScreen();
    if (!clicked) return { ok: false, error: `cannot craft ${want} with what you carry` };
    await pause(300);
    const made = gains(before, counts(await hands.carried()));
    return Object.keys(made).length ? { ok: true, made } : { ok: false, error: `clicked the recipe for ${want} but nothing was made` };
  }

  async function placeTable() {
    const slots = await hands.carried();
    const table = slots.find((s) => s.item === 'crafting_table');
    if (!table) return { ok: false, error: 'you carry no crafting table' };
    let place = table.slot;
    if (place > 8) { place = 7; await hands.toHotbar(table.slot, place); }
    await hands.hotbar(place);
    selected = place;
    // The table is down when it is no longer carried, wherever it landed: a leaf or a
    // flower in the way of the crosshair takes it a block off the spot that was meant.
    const down = async () => !(await hands.carried()).some((s) => s.item === 'crafting_table');
    const base = feet().floored();
    const spots = [];
    for (const [dx, dz] of [[2, 0], [-2, 0], [0, 2], [0, -2], [2, 1], [1, 2], [-2, 1], [-1, 2], [2, -1], [1, -2], [-2, -1], [-1, -2], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
      for (const dy of [-1, 0, -2]) {
        const ground = eyes.blockAt(base.offset(dx, dy, dz));
        const above = eyes.blockAt(base.offset(dx, dy + 1, dz));
        const open = above && above.boundingBox === 'empty' && !/water|lava/.test(above.name);
        if (ground?.boundingBox !== 'block' || !open) continue;
        const from = feet();
        const { yaw, pitch } = aim(from, ground.position.offset(0.5, 1, 0.5));
        const hit = sight(from, yaw, pitch);
        spots.push({ yaw, pitch, clear: Boolean(hit && hit.position.equals(ground.position)) });
      }
    }
    // Spots the crosshair reaches with nothing in the way come first.
    spots.sort((a, b) => Number(b.clear) - Number(a.clear));
    let tried = 0;
    for (const spot of spots.slice(0, 5)) {
      tried += 1;
      await hands.look(spot.yaw, spot.pitch, 240);
      await hands.press('right');
      await pause(90);
      await hands.unpress();
      await pause(550);
      if (await down()) return { ok: true, placed: 'crafting_table' };
    }
    return { ok: false, error: `could not put the table down (${tried} spots tried)` };
  }

  async function explore(direction) {
    const [dx, dz] = DIRECTIONS[direction];
    const from = feet();
    await walkTo(new goals.GoalNearXZ(from.x + dx * 24, from.z + dz * 24, 3), 30000);
    const moved = Math.round(feet().distanceTo(from));
    return moved >= 3 ? { ok: true, moved } : { ok: false, error: `could not get far going ${direction}` };
  }

  async function actions() {
    if (!eyes || !me() || dead || !online) return [];
    const slots = await hands.carried();
    const carrying = counts(slots);
    const hasPickaxe = Object.keys(carrying).some((item) => item.endsWith('_pickaxe'));
    const hasGoodPickaxe = Object.keys(carrying).some((item) => /^(stone|iron|diamond|netherite)_pickaxe$/.test(item));
    const list = [];
    for (const name of Object.keys(around())) {
      if (!COLLECTIBLE.test(name)) continue;
      if (NEEDS_PICKAXE.test(name) && !hasPickaxe) continue;
      if (NEEDS_STONE_PICKAXE.test(name) && !hasGoodPickaxe) continue;
      const target = reachable(name);
      if (!target) continue;
      list.push({ name: `collect:${name}`, about: `walk ${Math.round(target.distanceTo(feet()))} blocks to the nearest ${name} and dig one` });
    }
    const tableNear = Boolean(nearest('crafting_table', 32));
    for (const want of CRAFTABLE) {
      if (canMake(RECIPES[want], slots, tableNear)) list.push({ name: `craft:${want}`, about: `make ${want} from what you carry` });
    }
    if (carrying.crafting_table && !nearest('crafting_table', 8)) {
      list.push({ name: 'place:crafting_table', about: 'put your crafting table on the ground so tools can be made' });
    }
    for (const direction of Object.keys(DIRECTIONS)) list.push({ name: `explore:${direction}`, about: `walk about 24 blocks ${direction}` });
    return list;
  }

  return {
    name: 'minecraft',
    version: MC_VERSION,

    async reset({ seed, options = {} }) {
      if (watcher) { clearInterval(watcher); watcher = null; }
      if (hands) await hands.close();
      if (eyes) { try { eyes.quit(); } catch { /* already gone */ } }
      if (server) await server.stop();
      lines = []; online = false; dead = false; pending = []; reached = new Set(); walked = 0; lastSpot = null; lastHealth = 20; selected = -1;

      server = await startServer({ root, seed, freshWorld: !options.keepWorld, log: onLine });
      hands = await openHands({ root, server, ask, online: () => online });

      eyes = mineflayer.createBot({ host: '127.0.0.1', port: server.port, username: EYES, auth: 'offline', version: MC_VERSION });
      eyes.loadPlugin(pathfinder);
      eyes.on('error', () => {});
      await within(new Promise((resolve) => eyes.once('spawn', resolve)), 60000, 'the helper joining the server');
      eyes.physicsEnabled = false;
      server.command(`gamemode spectator ${EYES}`);
      await pause(800);
      server.command(`spectate ${BOT_NAME} ${EYES}`);
      await within(eyes.waitForChunksToLoad(), 60000, 'loading the land');
      const seen = Date.now() + 20000;
      while (!me()) {
        if (Date.now() > seen) throw new Error('the helper cannot see the player');
        await pause(250);
      }
      movements = new Movements(eyes);
      movements.allow1by1towers = false;
      movements.allowParkour = false;
      movements.allowSprinting = false;
      movements.scafoldingBlocks = [];
      movements.maxDropDown = 3;
      movements.allowEntityDetection = false;
      eyes.pathfinder.setMovements(movements);

      server.command(`gamemode survival ${BOT_NAME}`);
      await hands.front();
      await hands.grab();
      startAge = Number(eyes.time.age);
      startedAt = Date.now();
      lastSpot = feet();
      say('The run begins. The local model chooses; keys and mouse act.');
    },

    async observe() {
      const p = feet();
      const { health, food } = await vitals();
      noteHealth(health);
      const mobs = {};
      for (const entity of Object.values(eyes.entities)) {
        if (entity.kind !== 'Hostile mobs') continue;
        const distance = Math.round(entity.position.distanceTo(p));
        if (distance <= 24 && (mobs[entity.name] === undefined || distance < mobs[entity.name])) mobs[entity.name] = distance;
      }
      return {
        time: eyes.time.timeOfDay < 12500 ? 'day' : 'night',
        health: Math.round(health),
        food,
        pos: [Math.round(p.x), Math.round(p.y), Math.round(p.z)],
        carrying: counts(await hands.carried()),
        nearest: around(),
        monsters: mobs,
      };
    },

    actions,

    // While the model thinks, the player looks in its inventory, as a person might. If it
    // is hurt meanwhile, the inventory closes at once.
    async idle(phase) {
      if (phase === 'start') {
        await hands.openInventory();
        let busy = false;
        watcher = setInterval(async () => {
          if (busy) return;
          busy = true;
          try {
            const { health } = await vitals();
            const hurt = health < lastHealth;
            noteHealth(health);
            if (hurt) await hands.closeScreen();
          } finally {
            busy = false;
          }
        }, 700);
      } else {
        if (watcher) { clearInterval(watcher); watcher = null; }
        await pause(150);
        await hands.closeScreen();
      }
    },

    async act(action) {
      const [kind, what] = String(action.name).split(':');
      const before = counts(await hands.carried());
      say(`chose ${action.name}`);
      let result;
      try {
        if (kind === 'collect') result = await collect(what);
        else if (kind === 'craft') result = await craft(what);
        else if (kind === 'place') result = await placeTable();
        else if (kind === 'explore' && DIRECTIONS[what]) result = await explore(what);
        else result = { ok: false, error: `no such action: ${action.name}` };
      } catch (error) {
        result = { ok: false, error: String(error?.message ?? error).slice(0, 160) };
        await hands.releaseAll();
      }
      await hands.settle().catch(() => {});
      const events = pending.splice(0);
      const after = counts(await hands.carried());
      events.push(...gainEvents(before, after, reached, (milestone) => say(`milestone: ${milestone}`)));
      if (result.placed && !reached.has('table_placed')) {
        reached.add('table_placed');
        events.push({ kind: 'milestone', detail: { name: 'table_placed' } });
      }
      say(result.ok ? `done: ${JSON.stringify(result.got ?? result.made ?? result.placed ?? result.moved)}` : `failed: ${result.error}`);
      return { result, events };
    },

    tick() {
      const age = eyes ? Number(eyes.time.age) - startAge : NaN;
      return Number.isFinite(age) && age >= 0 ? age : Math.floor((Date.now() - startedAt) / 50);
    },

    ended: () => (dead ? 'death' : server && !online ? 'disconnected' : null),
    // How the game window came to be in this world: 'opened', 'rejoined' or 'already'.
    window: () => hands?.arrived ?? null,
    // A server command, for setting up a test (tools/hands_stage.mjs). No skill can reach it.
    debugCommand: (text) => server?.command(text),

    metrics: ({ events }) => runMetrics(events, walked),
    describe: describeText,
    vocabulary: vocabularyList,

    async close() {
      if (watcher) { clearInterval(watcher); watcher = null; }
      if (server) say('The run is over.');
      await hands?.close();
      await pause(300);
      try { eyes?.quit(); } catch { /* already gone */ }
      await pause(300);
      await server?.stop();
      server = null;
      eyes = null;
      hands = null;
    },
  };
}
