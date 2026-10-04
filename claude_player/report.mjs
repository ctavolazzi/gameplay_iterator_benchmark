#!/usr/bin/env node
// The player's report to the Claude session: what needs deciding first, then the numbers,
// then a picture from the player's eyes. The session reads this at the start of each turn of
// the loop, decides, and changes the player's code. See RESEARCH.md, "Reporting for decisions".
//   node claude_player/report.mjs            since the last report (or the last 30 minutes)
//   node claude_player/report.mjs 60         the last 60 minutes
//   node claude_player/report.mjs --peek     leave the mark of the last report where it is
//   node claude_player/report.mjs --no-look  without the picture
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const DATA = join(HERE, '..', 'data', 'claude_player');
const clock = (at) => new Date(at).toTimeString().slice(0, 8);
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

// What happened in a stretch of the journal, with what needs a decision ranked first: what
// matters most before what is newest. rows are journal rows; status is the player's now.
export function digest(rows, { from, to, status = null, asks = [], score = null } = {}) {
  const skills = rows.filter((row) => row.kind === 'skill');
  const of = (kind) => rows.filter((row) => row.kind === kind);
  const seconds = Math.max(1, Math.round((to - from) / 1000));
  const busy = Math.round(skills.reduce((sum, row) => sum + (row.ms ?? 0), 0) / 1000);
  const byGoal = {};
  for (const row of skills) {
    const g = byGoal[row.goal ?? 'by hand'] ??= { steps: 0, failed: 0, seconds: 0 };
    g.steps += 1; g.failed += row.ok ? 0 : 1; g.seconds += Math.round((row.ms ?? 0) / 1000);
  }
  // A failure is the same failure when the step and the first words of its reason are the same.
  const failures = {};
  for (const row of skills.filter((r) => !r.ok && !/^reflex:|asked|disconnected|process stopping/.test(r.note ?? ''))) {
    const key = `${row.skill} ${JSON.stringify(row.args ?? {})}: ${String(row.note ?? 'no reason given').replace(/-?\d+(\.\d+)?/g, 'N').slice(0, 70)}`;
    failures[key] = (failures[key] ?? 0) + 1;
  }
  const repeats = Object.entries(failures).filter(([, n]) => n >= 3).sort((a, b) => b[1] - a[1]);
  const errors = [...new Set(rows.filter((row) => /_error$|^error$/.test(row.kind)).map((row) => `${row.kind}: ${row.message}`))];
  const deaths = of('death');
  const open = of('chat_open');
  const still = Math.max(0, seconds - busy);

  const decide = [];
  for (const death of deaths) decide.push(`Died at ${clock(death.at)} at ${death.where?.x} ${death.where?.y} ${death.where?.z}${death.doing ? ` during ${death.doing}` : ''}${death.night ? ', at night' : ''}. What killed it, and what rule would have kept it alive?`);
  for (const error of errors) decide.push(`The program is throwing: ${error.slice(0, 160)}`);
  for (const row of open) decide.push(`${row.username} said at ${clock(row.at)}, and the player has no rule for it: "${row.message}"${row.unanswered ? ` (${row.unanswered})` : ''}`);
  for (const note of of('player_note')) decide.push(`${note.username} gave a note at ${clock(note.at)}: "${note.message}". Does it hold up against the journal?`);
  for (const [what, n] of repeats) decide.push(`Failed ${n} times the same way: ${what}`);
  for (const [goal, why] of Object.entries(status?.thought?.stuck ?? {})) decide.push(`Goal "${goal}" is stuck: ${why}`);
  if (still > seconds * 0.25 && seconds > 120) decide.push(`Stood still for ${still} s of ${seconds} s. Nothing happening is a fault too.`);
  if (status && !status.ready) decide.push('The player is not in the world.');
  for (const ask of asks.filter((a) => !a.done)) decide.push(`Asked for and not done (${ask.who}, ${ask.when}): "${ask.words}"`);

  return { from: new Date(from).toISOString(), to: new Date(to).toISOString(), seconds, steps: skills.length, failed: skills.filter((row) => !row.ok).length,
    busy, still, byGoal, failures, deaths: deaths.length, damage: +of('damage').reduce((sum, row) => sum + Math.max(0, (row.from ?? 0) - (row.to ?? 0)), 0).toFixed(1),
    fights: of('fight').length, advancements: of('advancement').map((row) => row.name), reconnects: of('login').length, said: of('said').length,
    heard: of('chat').length, looks: of('looked').length, score, decide };
}

// The report as it is read: markdown, the decisions first.
export function page(d, { status = null, look = null } = {}) {
  const lines = [`# Report ${d.to.slice(0, 16).replace('T', ' ')} UTC, the ${Math.round(d.seconds / 60)} minutes before it`, ''];
  lines.push('## To decide', '', ...(d.decide.length ? d.decide.map((line, i) => `${i + 1}. ${line}`) : ['Nothing asks for a decision. Pick the next thing from asks.json or the open list in NOTES.md.']), '');
  lines.push('## Numbers', '', `- ${plural(d.steps, 'step')}, ${d.failed} failed; busy ${d.busy} s, still ${d.still} s`,
    `- ${plural(d.deaths, 'death')}, ${d.damage} health lost, ${plural(d.fights, 'fight')}, ${plural(d.reconnects, 'login')}`,
    `- earned: ${d.advancements.join(', ') || 'nothing'}`, `- chat: heard ${d.heard}, said ${d.said}; looks taken: ${d.looks}`);
  if (d.score) lines.push(`- ${d.score}`);
  lines.push('', '| Goal | Steps | Failed | Seconds |', '| --- | --- | --- | --- |',
    ...Object.entries(d.byGoal).sort((a, b) => b[1].seconds - a[1].seconds).map(([goal, g]) => `| ${goal} | ${g.steps} | ${g.failed} | ${g.seconds} |`), '');
  const failures = Object.entries(d.failures).sort((a, b) => b[1] - a[1]);
  if (failures.length) lines.push('## What failed', '', ...failures.slice(0, 12).map(([what, n]) => `- ${n} x ${what}`), '');
  if (status) {
    lines.push('## Now', '', `- at ${status.where?.x} ${status.where?.y} ${status.where?.z}, health ${status.health}, food ${status.food}, game time ${status.time?.timeOfDay}`,
      `- doing: ${status.doing ? `${status.doing.skill} ${JSON.stringify(status.doing.args)} for "${status.doing.goal}", ${status.doing.seconds} s in` : 'nothing'}`,
      `- thinking: ${status.thought?.goal ?? 'no goal'}${status.thought?.why ? ` (${status.thought.why})` : ''}`,
      `- carries: ${Object.entries(status.carried ?? {}).sort((a, b) => b[1] - a[1]).slice(0, 14).map(([name, n]) => `${n} ${name}`).join(', ') || 'nothing'}`, '');
  }
  if (look) lines.push('## What it sees', '', `- ${look.says}`, `- picture: ${look.file}`, '');
  return lines.join('\n');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  const mark = join(DATA, 'report-state.json');
  const to = Date.now();
  const minutes = Number(argv.find((word) => /^\d+$/.test(word)));
  const last = existsSync(mark) ? JSON.parse(readFileSync(mark, 'utf8')).at : 0;
  const from = minutes ? to - minutes * 60000 : Math.max(last, to - 6 * 3600000) || to - 30 * 60000;
  const rows = readFileSync(join(DATA, 'journal.jsonl'), 'utf8').split('\n').filter(Boolean)
    .map((line) => { try { return JSON.parse(line); } catch { return null; } })
    .filter((row) => row && Date.parse(row.at) >= from && Date.parse(row.at) <= to);
  const ask = (...words) => { try { return JSON.parse(execFileSync(process.execPath, [join(HERE, 'player.mjs'), ...words], { encoding: 'utf8', timeout: 150000 })); } catch { return null; } };
  const status = ask('status');
  let score = null;
  try { const s = await import('./score.mjs'); score = s.line(s.read()); } catch { /* no log to read */ }
  const asks = existsSync(join(HERE, 'asks.json')) ? JSON.parse(readFileSync(join(HERE, 'asks.json'), 'utf8')) : [];
  const look = status?.ready && !argv.includes('--no-look') ? ask('look', '{"around":true,"tag":"report"}') : null;
  const text = page(digest(rows, { from, to, status, asks, score }), { status, look });
  mkdirSync(join(DATA, 'reports'), { recursive: true });
  const file = join(DATA, 'reports', `${new Date(to - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16).replace(/[:T]/g, '-')}.md`);
  writeFileSync(file, text);
  const kept = readdirSync(join(DATA, 'reports')).sort();
  for (const name of kept.slice(0, Math.max(0, kept.length - 30))) unlinkSync(join(DATA, 'reports', name));
  if (!argv.includes('--peek')) writeFileSync(mark, JSON.stringify({ at: to }));
  console.log(text);
  console.log(`(saved as ${file})`);
}
