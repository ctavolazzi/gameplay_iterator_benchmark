#!/usr/bin/env node
// Lets the player run untouched and ends when something happens: a death, an advancement,
// a person speaking, a dropped connection, an error in the brain or the reflexes, the player's
// process gone, or nothing journalled for a long while. Prints what it was, and ends.
//   node claude_player/watch_events.mjs [seconds to wait, default 3300] [quiet seconds, default 420]
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DATA = join(dirname(fileURLToPath(import.meta.url)), '..', 'data', 'claude_player');
const JOURNAL = join(DATA, 'journal.jsonl');
const CONTROL = join(DATA, 'control.json');
const NOTABLE = new Set(['death', 'advancement', 'player_note', 'chat_open', 'reconnect', 'end', 'kicked', 'brain_error', 'reflex_error', 'chat_error']);
const PROGRAMS = /codex|bot$/i;

const size = () => (existsSync(JOURNAL) ? statSync(JOURNAL).size : 0);
const started = Date.now();
const wait = (Number(process.argv[2]) || 3300) * 1000;
const quiet = (Number(process.argv[3]) || 420) * 1000;
let from = size();
let lastGrowth = Date.now();
const done = (text) => { console.log(text); clearInterval(timer); };
const alive = () => {
  try { process.kill(JSON.parse(readFileSync(CONTROL, 'utf8')).pid, 0); return true; } catch { return false; }
};

const timer = setInterval(() => {
  const now = size();
  if (now > from) {
    const rows = readFileSync(JOURNAL, 'utf8').slice(from).split('\n').filter(Boolean)
      .map((line) => { try { return JSON.parse(line); } catch { return null; } }).filter(Boolean);
    from = now;
    lastGrowth = Date.now();
    const hits = rows.filter((row) => NOTABLE.has(row.kind) || (row.kind === 'chat' && !PROGRAMS.test(row.username ?? '')));
    if (hits.length) {
      return done(hits.map((row) => {
        const { n, at, kind, lost, ...rest } = row;
        return `${at} ${kind} ${JSON.stringify(rest).slice(0, 400)}`;
      }).join('\n'));
    }
  }
  if (!alive()) return done(`the player's process is gone, ${Math.round((Date.now() - started) / 1000)} s into the watch`);
  if (Date.now() - lastGrowth > quiet) return done(`nothing journalled for ${Math.round(quiet / 1000)} s: the player is standing still`);
  if (Date.now() - started > wait) return done(`nothing notable in ${Math.round(wait / 60000)} minutes`);
}, 2000);
