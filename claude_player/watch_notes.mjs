#!/usr/bin/env node
// Waits until a person says something in the game that the player could not answer by
// itself (a note on how to play, or a question it had no answer for), prints it, and ends.
// The Claude session runs this in the background, so that it is woken when CT speaks.
//   node claude_player/watch_notes.mjs [seconds to wait, default 7000]
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const JOURNAL = join(dirname(fileURLToPath(import.meta.url)), '..', 'data', 'claude_player', 'journal.jsonl');
const size = () => (existsSync(JOURNAL) ? statSync(JOURNAL).size : 0);
const from = size();
const deadline = Date.now() + (Number(process.argv[2]) || 7000) * 1000;
const timer = setInterval(() => {
  if (size() > from) {
    const rows = readFileSync(JOURNAL, 'utf8').slice(from).split('\n').filter(Boolean)
      .map((line) => { try { return JSON.parse(line); } catch { return null; } })
      .filter((row) => row && (row.kind === 'player_note' || row.kind === 'chat_open'));
    if (rows.length) {
      for (const row of rows) console.log(`${row.at} ${row.kind} <${row.username}> ${row.message}`);
      clearInterval(timer);
      return;
    }
  }
  if (Date.now() > deadline) { console.log('nothing said in that time'); clearInterval(timer); }
}, 2000);
