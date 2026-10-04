// Small functions with no game connection, so tests can run them offline.

// The title in the game's own announcement, or null. Anchored at the start, so a player
// typing the sentence in chat ("<name> Claude has made ...") does not count.
export function parseAdvancement(text, player) {
  const hit = String(text).match(new RegExp(
    `^${player} has (?:made the advancement|completed the challenge|reached the goal) \\[(.+?)\\]`));
  return hit ? hit[1] : null;
}

// What was gained and what was lost between two { item: count } lists.
export function diffCarried(before, after) {
  const gained = {};
  const lost = {};
  for (const name of new Set([...Object.keys(before), ...Object.keys(after)])) {
    const delta = (after[name] ?? 0) - (before[name] ?? 0);
    if (delta > 0) gained[name] = delta;
    if (delta < 0) lost[name] = -delta;
  }
  return { gained, lost };
}

// How many of a fuel it takes to smelt a number of items. null for something that is not fuel.
export function fuelNeeded(fuel, items) {
  const smeltsEach = /^(coal|charcoal)$/.test(fuel) ? 8
    : /_planks$|_log$|_wood$/.test(fuel) ? 1.5
    : fuel === 'stick' ? 0.5 : null;
  return smeltsEach ? Math.ceil(items / smeltsEach) : null;
}

// One summary of journal rows: how each skill has done, and what the game did to the player.
export function summarize(rows) {
  const skills = {};
  const out = { skills, deaths: 0, damage: 0, advancements: [], sessions: 0 };
  for (const row of rows) {
    if (row.kind === 'skill') {
      const s = skills[row.skill] ??= { ok: 0, failed: 0, seconds: 0, errors: {} };
      s[row.ok ? 'ok' : 'failed'] += 1;
      s.seconds += Math.round((row.ms ?? 0) / 1000);
      if (!row.ok) {
        const why = String(row.note ?? 'no reason given').slice(0, 80);
        s.errors[why] = (s.errors[why] ?? 0) + 1;
      }
    } else if (row.kind === 'death') out.deaths += 1;
    else if (row.kind === 'damage') out.damage += Math.max(0, (row.from ?? 0) - (row.to ?? 0));
    else if (row.kind === 'advancement') out.advancements.push(row.name);
    else if (row.kind === 'login') out.sessions += 1;
  }
  out.damage = +out.damage.toFixed(1);
  return out;
}

// Whether one cell of a small floor plan can be walked to from another. walkable is a Set of
// "x,z" strings. Used before furniture is put down in the base: a chest in the wrong cell of
// a 3 by 3 room shut the player in a corner for 28 minutes.
export function reaches(walkable, from, to) {
  const key = ([x, z]) => `${x},${z}`;
  if (!walkable.has(key(from)) || !walkable.has(key(to))) return false;
  const seen = new Set([key(from)]);
  const queue = [from];
  while (queue.length) {
    const [x, z] = queue.shift();
    if (x === to[0] && z === to[1]) return true;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const next = [x + dx, z + dz];
      if (walkable.has(key(next)) && !seen.has(key(next))) { seen.add(key(next)); queue.push(next); }
    }
  }
  return false;
}

// The cells of a floor plan that cannot be walked from to the way out. Empty when all can.
export function shutIn(walkable, wayOut) {
  return [...walkable].map((cell) => cell.split(',').map(Number)).filter((cell) => !reaches(walkable, cell, wayOut));
}
