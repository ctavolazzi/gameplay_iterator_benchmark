// Working the land: what a loose request asks for, where on surveyed ground to do it, and
// which trees may be cut. No game connection, so all of it can be tested.
//
// CT, 2026-10-04, after a farm was built from coordinates the session typed in: "refine the
// code that runs your avatar to accomodate these findings and plan for them next time, not as
// hard code, but as responses to things that are more nebulous". So nothing here knows a
// place. A request becomes a job ({ kind, by, near, standAt }), skills/work.mjs surveys the
// ground the job is near, and the functions below choose from what the survey found.

// What a person has made. Never dug, and a tree with any of it on or against it is not cut.
export const MADE = /^(crafting_table|furnace|chest|barrel|torch|wall_torch|ladder|.*_bed|.*_door|.*_trapdoor|.*_sign|.*_fence|.*_fence_gate|.*_stairs|.*_slab|.*_planks|glass|glass_pane|.*_glass|farmland|wheat|carrots|potatoes|beetroots|composter|.*_banner|lantern|campfire|.*_wall|scaffolding)$/;

// The jobs a message asks for, in the order it asks: [{ kind: 'farm' | 'build' | 'clear' | 'trees', standAt?, what? }].
// One message can hold several. What was really said on 2026-10-04 is in tests/claude_land.test.mjs.
export function asksFor(message) {
  const jobs = [];
  const had = new Set();
  // Sentence by sentence: "What do you guys think about doing some cleanup today? I was
  // thinking we could flatten the surrounding area" is a question and then a request.
  String(message).toLowerCase().split(/[.!?\n]+/).forEach((text, sentence) => {
    // A question about a farm or a tree is not a request to make or cut one.
    if (/^\s*(claude[,:]?\s*)?(did|have|has|had|where|what|which|who|how(?! about)|why|is|are|was|were|do|does)\b/.test(text)) return;
    // Nor is being told not to, or being told how: "don't cut the trees by my house", "you can
    // cut trees faster with an axe". Those are notes, and chat.mjs writes them down.
    if (/\b(don'?t|do not|never|stop|quit|no need)\b/.test(text)) return;
    if (/\b(with (a|an|your)|faster|easier|safer|instead|by using|use (a|an|the|your))\b/.test(text)) return;
    const at = (pattern) => { const found = pattern.exec(text); return found ? found.index : -1; };
    const found = {
      // Not "a storehouse by the farm": the farm has to be the thing made, not where something else goes.
      farm: at(/\b(build|building|make|making|start|set up|create|construct|begin|get started|put in|lay out|want|need)\b.{0,60}(?<!\b(?:by|near|beside|at|to|round|around|from|in|on|for) (?:the |our |my |a |that |this )?)\b(farm|farmland|crop field|field|garden)\b/),
      build: at(/\b(build|building|make|making|put up|construct|want|need)\b.{0,40}\b(storehouse|store ?room|storage|shed|barn|warehouse)\b/),
      clear: at(/\b(flatten|level (out|off|the|this|that|everything|it)|even out|smooth out)\b/),
      trees: Math.max(at(/\b(cut|chop|fell|clear|remove|eliminate|get rid of|take down|finish(ed)?( up| off)?|harvest)\b.{0,60}\btrees?\b/),
        at(/\btrees?\b.{0,80}\b(cut|chopped|felled|gone|removed|finished( up| off)?|harvested|eliminated|taken down)\b/)),
    };
    for (const [kind, index] of Object.entries(found)) {
      if (index < 0 || had.has(kind)) continue;
      had.add(kind);
      // "down to the 66th block level", "to y 66", "level 66": the height a player stands at.
      const height = kind === 'clear' && /\b(?:to|at|level|height|y)\s*(?:the\s*|=\s*)?(-?\d{1,3})(?:st|nd|rd|th)?\b/.exec(text.slice(index));
      jobs.push({ kind, order: sentence * 1000 + index, ...(height && { standAt: Number(height[1]) }), ...(kind === 'build' && { what: 'storehouse' }) });
    }
  });
  return jobs.sort((a, b) => a.order - b.order).map(({ order, ...job }) => job);
}

// Whether a place is inside something the player has built and fenced or walled: the farm
// (memory.farmField) or the storehouse (memory.store). Gives the way out: the gate or door
// (`barrier`), the cell inside it (`from`) and the cell outside it (`to`), or null.
// A task cut short in there (a fight, a stop from the session at 21:36 on 2026-10-04) leaves
// the player inside, and no path leads out: nothing may be dug or placed in a field, and the
// pathfinder does not open a gate. The brain sends it out by the gate before anything else.
export function insideOf(memory, at) {
  const field = memory?.farmField;
  if (field && at.x > field.x && at.x < field.x + 20 && at.z > field.z && at.z < field.z + 10 && at.y >= field.level && at.y <= field.level + 3) {
    const [gx, gy, gz] = [field.x + 10, field.level + 1, field.z + 10];
    return { kind: 'farm', barrier: { x: gx, y: gy, z: gz }, from: { x: gx, y: gy, z: gz - 1 }, to: { x: gx, y: gy, z: gz + 1 } };
  }
  const house = memory?.store;
  if (house?.origin && house.door && at.x > house.origin.x && at.x < house.origin.x + 4 && at.z > house.origin.z && at.z < house.origin.z + 4
    && at.y >= house.origin.y - 1 && at.y <= house.origin.y + 2) {
    return { kind: 'storehouse', barrier: house.door.cell, from: house.door.inside, to: house.door.outside };
  }
  return null;
}

// The height most of the ground is at: where a field costs least to level.
export function groundLevel(columns) {
  const count = new Map();
  for (const column of columns) if (column.ground !== null && column.ground !== undefined) count.set(column.ground, (count.get(column.ground) ?? 0) + 1);
  let best = null;
  for (const [level, n] of count) if (!best || n > best.n || (n === best.n && level > best.level)) best = { level, n };
  return best ? best.level : null;
}

// Where a w by h field goes: the place that takes the least digging, filling and felling and
// is nearest to `near`, with nothing anyone has made and no water in it or within `margin`
// of it. survey: { columns: [{ x, z, ground, coverName }], made: [{ x, y, z }], wet: [{ x, y, z }] }.
// Returns { x, z, cut, fill, trees, far, score } for the north-west corner, or null.
export function chooseSite(survey, { w, h, level, near, reach = 40, margin = 2 }) {
  const column = new Map(survey.columns.map((c) => [`${c.x},${c.z}`, c]));
  const taken = new Set();
  for (const m of survey.made ?? []) if (m.y >= level - 2) taken.add(`${m.x},${m.z}`);
  for (const c of survey.columns) if (c.ground === null || c.ground === undefined || /water|lava/.test(c.coverName ?? '')) taken.add(`${c.x},${c.z}`);
  const xs = survey.columns.map((c) => c.x), zs = survey.columns.map((c) => c.z);
  const [xa, xb, za, zb] = [Math.min(...xs), Math.max(...xs), Math.min(...zs), Math.max(...zs)];
  let best = null;
  for (let x = xa + margin; x + w - 1 + margin <= xb; x++) for (let z = za + margin; z + h - 1 + margin <= zb; z++) {
    const far = Math.hypot(x + w / 2 - near.x, z + h / 2 - near.z);
    if (far > reach) continue;
    let cut = 0, fill = 0, trees = 0, bad = false;
    for (let cx = x - margin; cx < x + w + margin && !bad; cx++) for (let cz = z - margin; cz < z + h + margin; cz++) {
      if (taken.has(`${cx},${cz}`) || !column.has(`${cx},${cz}`)) { bad = true; break; }
      if (cx < x || cx >= x + w || cz < z || cz >= z + h) continue;
      const c = column.get(`${cx},${cz}`);
      if (c.ground > level) cut += c.ground - level; else fill += level - c.ground;
      if (/_log$|_leaves$/.test(c.coverName ?? '')) trees += 1;
    }
    if (bad) continue;
    // A block to place costs about two to dig; a column under a tree about one and a half;
    // and a walk of a block, there and back many times, about two.
    const score = cut + 2 * fill + 1.5 * trees + 2 * far;
    if (!best || score < best.score) best = { x, z, cut, fill, trees, far: Math.round(far), score: Math.round(score) };
  }
  return best;
}

// A rectangle cut into pieces of at most `size` a side, nearest to `from` first, so that a
// big clearing is done a piece at a time and what is nearest is finished first.
export function pieces({ xa, xb, za, zb }, from, size = 12) {
  const out = [];
  for (let x = xa; x <= xb; x += size) for (let z = za; z <= zb; z += size) {
    out.push({ xa: x, xb: Math.min(xb, x + size - 1), za: z, zb: Math.min(zb, z + size - 1) });
  }
  const far = (p) => Math.hypot((p.xa + p.xb) / 2 - from.x, (p.za + p.zb) / 2 - from.z);
  return out.sort((a, b) => far(a) - far(b));
}

// Logs gathered into trees: logs that touch, corners included, are one tree. For each:
//   floating  nothing solid is under its lowest log: what is left of a tree cut from below
//   kept      something made is on it or within 2 blocks of it: it holds a build up
// logs and made are [{ x, y, z }]; solidUnder(log) says whether the block under a log is solid.
export function trees(logs, made, solidUnder) {
  const key = (p) => `${p.x},${p.y},${p.z}`;
  const all = new Map(logs.map((log) => [key(log), log]));
  const seen = new Set();
  const out = [];
  for (const start of logs) {
    if (seen.has(key(start))) continue;
    const tree = [];
    const queue = [start];
    seen.add(key(start));
    while (queue.length) {
      const log = queue.pop();
      tree.push(log);
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
        const next = all.get(`${log.x + dx},${log.y + dy},${log.z + dz}`);
        if (next && !seen.has(key(next))) { seen.add(key(next)); queue.push(next); }
      }
    }
    tree.sort((a, b) => a.y - b.y);
    const lowest = tree.filter((log) => log.y === tree[0].y);
    out.push({ logs: tree, base: tree[0],
      floating: !lowest.some((log) => solidUnder(log)),
      kept: tree.some((log) => made.some((m) => Math.abs(m.x - log.x) <= 2 && Math.abs(m.y - log.y) <= 2 && Math.abs(m.z - log.z) <= 2)) });
  }
  return out;
}
