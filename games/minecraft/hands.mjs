// The pressing half of playing through the real game window: find or open the window, hold
// and release keys and mouse buttons in it, turn the camera, and click through the
// inventory and crafting table screens. Everything it does shows on screen as a player
// doing it. What to press is decided in hands_plan.mjs and hands_adapter.mjs.

import { execFile, execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { BOT_NAME } from './common.mjs';
import { clickPlan, parseInventory, screenLayout, turn } from './hands_plan.mjs';

const run = promisify(execFile);
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Key codes of a US keyboard.
export const KEY = { w: 13, a: 0, s: 1, d: 2, e: 14, space: 49, escape: 53, shift: 56, control: 59 };
const HOTBAR_KEYS = [18, 19, 20, 21, 23, 22, 26, 28, 25];
const TITLE_BAR = 28;
const GUI_SCALE = 4;   // written into the player window's options.txt by tools/watch_client.mjs

export function playerWindowPid() {
  try {
    return execFileSync('pgrep', ['-f', `username ${BOT_NAME}`], { encoding: 'utf8' }).trim().split('\n')[0] || null;
  } catch {
    return null;
  }
}

// The inside of the game window in screen points, without its title bar.
export function windowContent(pid) {
  const text = execFileSync('osascript', ['-l', 'JavaScript', '-e', `
    ObjC.import("CoreGraphics");
    var all = ObjC.deepUnwrap(ObjC.castRefToObject($.CGWindowListCopyWindowInfo($.kCGWindowListOptionOnScreenOnly | $.kCGWindowListExcludeDesktopElements, 0)));
    var w = all.filter(function (w) { return w.kCGWindowOwnerPID == ${pid} && w.kCGWindowLayer === 0 && w.kCGWindowBounds.Width >= 600; })[0];
    w ? [w.kCGWindowBounds.X, w.kCGWindowBounds.Y, w.kCGWindowBounds.Width, w.kCGWindowBounds.Height].join(",") : "";`],
  { encoding: 'utf8' }).trim();
  if (!text) return null;
  const [x, y, width, height] = text.split(',').map(Number);
  return { x, y: y + TITLE_BAR, width, height: height - TITLE_BAR };
}

// server: the running game server. ask(command, pattern): send a console command and wait
// for the log line that answers it. online(): is the player in the world right now.
export async function openHands({ root, server, ask, online }) {
  const bin = join(root, 'runtime', 'bin', 'hands');

  // The window. One that is open but not in this world is closed and opened again; having
  // it rejoin by itself is not built yet.
  let pid = playerWindowPid();
  if (pid && !online()) {
    try { process.kill(Number(pid), 'SIGTERM'); } catch { /* already gone */ }
    await pause(2500);
    pid = null;
  }
  let fresh = false;
  if (!pid) {
    const { stdout } = await run(process.execPath, [join(root, 'tools', 'watch_client.mjs'), 'launch', '--player']);
    pid = (stdout.match(/process (\d+)/) ?? [])[1] ?? null;
    if (!pid) throw new Error(`the game window did not start: ${stdout.trim()}`);
    fresh = true;
  }
  const deadline = Date.now() + 150000;
  while (!online()) {
    if (Date.now() > deadline) throw new Error('the game window did not join the server within 150 seconds');
    await pause(500);
  }
  await pause(fresh ? 9000 : 2500);   // let the land load and draw
  const content = windowContent(pid);
  if (!content) throw new Error('the game window is not on screen');
  const layout = screenLayout(content, GUI_SCALE);
  const send = (...args) => run(bin, [pid, ...args.map(String)]);

  // What is held down, so it can always be let go: a key left down keeps the player walking.
  const held = new Set();
  let button = null;
  const hold = async (code) => { if (!held.has(code)) { held.add(code); await send('key', 'down', code); } };
  const release = async (code) => { if (held.has(code)) { held.delete(code); await send('key', 'up', code); } };
  const tap = (code, ms = 70) => send('tap', code, ms);
  const press = async (which = 'left') => { button = which; await send('mouse', 'down', which, layout.centre.x, layout.centre.y); };
  const unpress = async () => { if (button) { const which = button; button = null; await send('mouse', 'up', which, layout.centre.x, layout.centre.y); } };
  const releaseAll = async () => {
    for (const code of [...held]) await release(code).catch(() => {});
    await unpress().catch(() => {});
  };
  const letGoAtExit = () => {
    for (const code of held) { try { execFileSync(bin, [pid, 'key', 'up', String(code)]); } catch { /* window gone */ } }
    if (button) { try { execFileSync(bin, [pid, 'mouse', 'up', button, String(layout.centre.x), String(layout.centre.y)]); } catch { /* window gone */ } }
  };
  process.on('exit', letGoAtExit);

  // The camera. The server turns the player to an exact direction; many small turns make a
  // sweep. yaw and pitch are kept here because this is the only thing that turns it.
  let yaw = 0;
  let pitch = 0;
  const rotation = await ask(`data get entity ${BOT_NAME} Rotation`, /entity data: \[(-?[\d.]+)f, (-?[\d.]+)f\]/);
  if (rotation) { yaw = Number(rotation[1]); pitch = Number(rotation[2]); }
  const face = (toYaw, toPitch) => {
    yaw = ((((toYaw + 180) % 360) + 360) % 360) - 180;
    pitch = Math.max(-89, Math.min(89, toPitch));
    server.command(`rotate ${BOT_NAME} ${yaw.toFixed(1)} ${pitch.toFixed(1)}`);
  };
  async function look(toYaw, toPitch, ms = 260) {
    const steps = Math.max(1, Math.round(ms / 50));
    const fromYaw = yaw;
    const fromPitch = pitch;
    const swing = turn(yaw, toYaw);
    for (let i = 1; i <= steps; i++) {
      const k = i / steps;
      const eased = k * k * (3 - 2 * k);
      face(fromYaw + swing * eased, fromPitch + (toPitch - fromPitch) * eased);
      await pause(50);
    }
  }

  // Screens. Only one can be open; Escape with none open would bring up the game menu. The
  // note of what is open changes before the key is pressed, so two callers at the same
  // moment (the health watcher and the end of thinking) cannot both press Escape.
  let screen = null;
  async function openInventory() {
    if (screen) return;
    screen = 'inventory';
    await tap(KEY.e);
    await pause(450);
  }
  async function closeScreen() {
    if (!screen) return;
    screen = null;
    await tap(KEY.escape);
    await pause(300);
  }
  const click = async (point, { right = false, shift = false } = {}) => {
    await send('click', right ? 'right' : 'left', point.x, point.y, ...(shift ? ['shift'] : []));
    await pause(170);
  };

  const carried = async () => {
    const hit = await ask(`data get entity ${BOT_NAME} Inventory`, /entity data: (\[.*\])\s*$/);
    return hit ? parseInventory(hit[1]) : [];
  };

  // Click a recipe into whichever crafting grid is open, and take the result.
  async function craftOnScreen(recipe, table) {
    const plan = clickPlan(recipe, await carried());
    if (!plan) return false;
    for (const c of plan) {
      const point = c.on === 'slot' ? layout.slot(c.index) : c.on === 'grid' ? layout.grid(table, c.column, c.row) : layout.result(table);
      await click(point, { right: c.click === 'right', shift: c.shift });
    }
    await pause(250);
    return true;
  }

  return {
    pid,
    layout,
    look,
    face,
    direction: () => ({ yaw, pitch }),
    hold,
    release,
    tap,
    press,
    unpress,
    releaseAll,
    carried,
    openInventory,
    closeScreen,
    screen: () => screen,
    craftOnScreen,
    click,
    async front() { await send('front'); },
    // Take the pointer into the game, as a first click on the window does.
    async grab() { await send('click', 'left', layout.centre.x, layout.centre.y); await pause(400); },
    async hotbar(index) { await tap(HOTBAR_KEYS[index]); await pause(150); },
    // Bring a carried slot into a hotbar place: hover it in the inventory and press the number.
    async toHotbar(slot, index) {
      await openInventory();
      await send('move', layout.slot(slot).x, layout.slot(slot).y);
      await pause(200);
      await tap(HOTBAR_KEYS[index]);
      await pause(200);
      await closeScreen();
    },
    setScreen(name) { screen = name; },
    async close() {
      await releaseAll();
      process.off('exit', letGoAtExit);
    },
  };
}
