#!/usr/bin/env node
// The score in the challenge between the programs' players, counted from the server's own
// log. Nothing a player says about itself is believed: a chat line starts with "<name>" or
// "[Not Secure]", and only a line that starts with the player's name is the game speaking.
// The challenge itself (who, since when, the rule) is in challenge.json beside this file.
//   node claude_player/score.mjs          the score now, as one line and as JSON
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';

const LOGS = new URL('../runtime/minecraft-coop-26.1/logs/', import.meta.url);
const CHALLENGE = new URL('./challenge.json', import.meta.url);

// How the game says a player died: the 12 forms in this world's logs on 2026-10-04 and the
// rest of the game's list. Anything else said about a player is kept as unread, so that a
// form missing here shows up instead of being lost.
const DIED = /^(was (slain|shot|blown up|killed|pummeled|fireballed|impaled|squashed|squished|skewered|stung|pricked|struck|burned|burnt|frozen|doomed|obliterated|poked|roasted)|drowned|died|blew up|hit the ground|fell |burned to death|went up in flames|walked into|tried to swim in lava|discovered the floor was lava|suffocated|starved|withered away|froze to death|experienced kinetic energy|went off with a bang|left the confines of this world|didn'?t want to live)/;
const NOT_NEWS = /^(joined the game|left the game|lost connection|logged in with|moved (too quickly|wrongly)|was kicked|issued server command|\(formerly known as)/;

// One line of the server's log: { time, player, kind: advancement | death | other, what }, or
// null when it is not the game speaking about one of the players. aliases gives a player's
// earlier names: Codex's player was CodexAstra until 07:56 on 2026-10-04.
export function parseLine(line, players, aliases = {}) {
  const hit = /^\[(\d\d:\d\d:\d\d)\] \[Server thread\/INFO\]: (\S+) (.+)$/.exec(line);
  if (!hit) return null;
  const [, time, name, rest] = hit;
  const player = aliases[name] ?? name;
  if (!players.includes(player)) return null;
  const earned = /^has (?:made the advancement|completed the challenge|reached the goal) \[(.+?)\]/.exec(rest);
  if (earned) return { time, player, kind: 'advancement', what: earned[1] };
  if (DIED.test(rest)) return { time, player, kind: 'death', what: rest };
  if (NOT_NEWS.test(rest)) return null;
  return { time, player, kind: 'other', what: rest };
}

// The same for a line as a player in the game receives it, which has no clock in front.
export function news(text, players, aliases = {}) {
  return parseLine(`[00:00:00] [Server thread/INFO]: ${text}`, players, aliases);
}

// Every such line of one log, each with the moment it happened. The log has clock times only:
// day is the date the log began ("2026-10-04"), and a clock that runs backwards by more than
// an hour means midnight went by.
export function events(lines, day, players, aliases = {}) {
  const out = [];
  let date = new Date(`${day}T00:00:00`);
  let last = -1;
  for (const line of lines) {
    const clock = /^\[(\d\d):(\d\d):(\d\d)\]/.exec(line);
    if (!clock) continue;
    const seconds = clock[1] * 3600 + clock[2] * 60 + +clock[3];
    if (seconds < last - 3600) date = new Date(date.getTime() + 86400000);
    last = seconds;
    const row = parseLine(line, players, aliases);
    if (row) out.push({ ...row, at: new Date(date.getTime() + seconds * 1000) });
  }
  return out;
}

// One point for each advancement since the start, minus one for each death since the start.
// An advancement is earned once in a world, so every one after the start is new.
export function tally(rows, { players, since }) {
  const score = Object.fromEntries(players.map((player) => [player, { points: 0, advancements: [], deaths: 0, unread: [] }]));
  for (const row of rows) {
    if (row.at < since) continue;
    const s = score[row.player];
    if (row.kind === 'advancement') { if (!s.advancements.includes(row.what)) s.advancements.push(row.what); }
    else if (row.kind === 'death') s.deaths += 1;
    else s.unread.push(row.what);
  }
  for (const s of Object.values(score)) s.points = s.advancements.length - s.deaths;
  return score;
}

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const clock = (date) => `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;

// The score as one line for the game's chat.
export function line({ score, since }) {
  const parts = Object.entries(score).sort((a, b) => b[1].points - a[1].points)
    .map(([player, s]) => `${player} ${s.points} (${plural(s.advancements.length, 'advancement')}, ${plural(s.deaths, 'death')})`);
  return `Score since ${clock(since)}: ${parts.join('; ')}.`;
}

const localDay = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

// The score now, from every log that can hold a line since the start.
export function read() {
  const challenge = JSON.parse(readFileSync(CHALLENGE, 'utf8'));
  const since = new Date(challenge.since);
  const rows = [];
  for (const name of existsSync(LOGS) ? readdirSync(LOGS).sort() : []) {
    const path = new URL(name, LOGS);
    if (name === 'latest.log') {
      rows.push(...events(readFileSync(path, 'utf8').split('\n'), localDay(statSync(path).birthtime), challenge.players, challenge.aliases));
      continue;
    }
    const day = /^(\d{4}-\d\d-\d\d)-\d+\.log\.gz$/.exec(name)?.[1];
    if (!day || new Date(`${day}T00:00:00`).getTime() < since.getTime() - 2 * 86400000) continue;
    rows.push(...events(gunzipSync(readFileSync(path)).toString('utf8').split('\n'), day, challenge.players, challenge.aliases));
  }
  return { challenge, since, score: tally(rows, { players: challenge.players, since }) };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = read();
  console.log(line(result));
  console.log(JSON.stringify(result.score, null, 1));
}
