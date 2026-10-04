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
