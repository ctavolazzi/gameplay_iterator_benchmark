#!/usr/bin/env -S node --disable-warning=ExperimentalWarning
// A terminal display for runs. It only reads data/benchmark.sqlite, so it is safe to leave
// open beside a running ./iterate.mjs loop.
//
//   tools/watch.mjs                 live view: recent runs, and the steps of the newest one
//   tools/watch.mjs --run 9         follow one run instead of the newest
//   tools/watch.mjs --once          print one frame and exit (also what a pipe gets)
//   tools/watch.mjs --interval 2    seconds between redraws (default 1)
//   tools/watch.mjs --data DIR      database somewhere other than data/

import { existsSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { DatabaseSync } from 'node:sqlite';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const { values } = parseArgs({
  options: {
    run: { type: 'string' },
    once: { type: 'boolean', default: false },
    interval: { type: 'string', default: '1' },
    data: { type: 'string', default: join(ROOT, 'data') },
    steps: { type: 'string', default: '14' },
  },
});

const dbFile = join(values.data, 'benchmark.sqlite');
if (!existsSync(dbFile)) {
  console.error(`no database at ${dbFile}`);
  process.exit(2);
}

const live = process.stdout.isTTY && !values.once;
const paint = (code, text) => (process.stdout.isTTY ? `\x1b[${code}m${text}\x1b[0m` : text);
const dim = (t) => paint(2, t);
const bold = (t) => paint(1, t);
const COLOR = { running: 36, complete: 32, bad: 31, warn: 33 };

const pad = (v, n) => String(v ?? '').slice(0, n).padEnd(n);
const padLeft = (v, n) => String(v ?? '').slice(0, n).padStart(n);
const bar = (done, total, width = 20) => {
  const filled = total > 0 ? Math.min(width, Math.round((done / total) * width)) : 0;
  return '#'.repeat(filled) + '.'.repeat(width - filled);
};
const ago = (iso) => {
  const s = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000));
  return s < 90 ? `${s}s` : s < 5400 ? `${Math.round(s / 60)}m` : `${Math.round(s / 3600)}h`;
};
const short = (value, n) => {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return text.length > n ? text.slice(0, n - 1) + '~' : text;
};

// The player column is long ("llama:Andy-4.2-Micro.i1-Q4_K_M"); keep the part that tells models apart.
const playerName = (p) => p.replace(/^llama:/, '').replace(/\.i1-.*$|-Q\d.*$/, '');

// A run with no ended_reason is running if it wrote a step lately, and otherwise it died
// without saying so, which the store's own comment says is how a crash looks.
// Steps carry no clock, so "lately" is the mtime of the run's JSONL log, which every step appends to.
const lastWrite = (run) => {
  try {
    return statSync(join(values.data, 'runs', `run-${String(run.id).padStart(6, '0')}.jsonl`)).mtimeMs;
  } catch {
    return Date.parse(run.started_at);
  }
};

function status(run) {
  if (run.ended_reason) {
    const clean = run.ended_reason === 'complete' || run.ended_reason.startsWith('budget');
    return { text: run.ended_reason, color: clean ? COLOR.complete : COLOR.bad };
  }
  const quiet = (Date.now() - lastWrite(run)) / 1000;
  return quiet < 600 ? { text: 'RUNNING', color: COLOR.running } : { text: 'UNFINISHED', color: COLOR.warn };
}

// One line per game, playbook and model over the runs that ended: the README's results
// table, kept current. Averages, so a one-run row is just that run.
function comparison(db, width) {
  const ended = db.prepare(`
    SELECT r.id, r.game, r.player, r.skill_library_version AS book, r.ended_reason, r.step_count,
           (SELECT value FROM metrics m WHERE m.run_id = r.id AND m.name = 'milestones') AS miles,
           (SELECT value FROM metrics m WHERE m.run_id = r.id AND m.name = 'decide_ms_median') AS med,
           (SELECT score FROM evaluations e WHERE e.run_id = r.id LIMIT 1) AS score
    FROM runs r WHERE r.ended_reason IS NOT NULL ORDER BY r.id`).all();
  const groups = new Map();
  for (const r of ended) {
    const key = [r.game, r.book ? r.book.split('/')[1] : 'none', playerName(r.player)].join('|');
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }
  const mean = (rs, f) => {
    const v = rs.map(f).filter((x) => x != null);
    return v.length ? Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 10) / 10 : '';
  };
  const out = ['', bold('by playbook'),
    dim(`${pad('game', 10)} ${pad('playbook', 9)} ${pad('player', 16)} ${padLeft('runs', 4)} ${padLeft('steps', 6)} ${padLeft('miles', 6)} ${padLeft('med ms', 7)} ${padLeft('coach', 6)}  clean`)];
  for (const [key, rs] of [...groups].slice(-8)) {
    const [game, book, player] = key.split('|');
    const clean = rs.filter((r) => r.ended_reason === 'complete' || r.ended_reason.startsWith('budget')).length;
    out.push(short(`${pad(game, 10)} ${pad(book, 9)} ${pad(player, 16)} ${padLeft(rs.length, 4)} ${padLeft(mean(rs, (r) => r.step_count), 6)} ${padLeft(mean(rs, (r) => r.miles), 6)} ${padLeft(mean(rs, (r) => r.med), 7)} ${padLeft(mean(rs, (r) => r.score), 6)}  ${clean}/${rs.length}`, width));
  }
  return out;
}

function frame(db) {
  const width = Math.min(process.stdout.columns || 100, 120);
  const out = [];
  const total = db.prepare('SELECT COUNT(*) AS n FROM runs').get().n;
  out.push(`${bold('gameplay_iterator_benchmark')}  ${dim(`${total} runs, ${new Date().toLocaleTimeString()}`)}`);
  out.push('');

  const rows = db.prepare(`
    SELECT r.*, (SELECT COUNT(*) FROM steps s WHERE s.run_id = r.id) AS steps_now,
           (SELECT score FROM evaluations e WHERE e.run_id = r.id LIMIT 1) AS score,
           (SELECT value FROM metrics m WHERE m.run_id = r.id AND m.name = 'decide_ms_median') AS med_ms,
           (SELECT value FROM metrics m WHERE m.run_id = r.id AND m.name = 'milestones') AS milestones
    FROM runs r ORDER BY r.id DESC LIMIT 8`).all().reverse();

  out.push(dim(`${pad('run', 4)} ${pad('game', 10)} ${pad('player', 16)} ${pad('playbook', 14)} ${pad('status', 12)} ${pad('calls', 27)} ${padLeft('med ms', 7)} ${padLeft('miles', 5)} ${padLeft('coach', 5)}`));
  for (const r of rows) {
    const st = status(r);
    const stText = paint(st.color, pad(st.text, 12));
    const book = r.skill_library_version ? r.skill_library_version.split('/')[1] : 'none';
    out.push(`${pad(r.id, 4)} ${pad(r.game, 10)} ${pad(playerName(r.player), 16)} ${pad(book, 14)} ${stText} ${bar(r.steps_now, r.budget_calls)} ${padLeft(r.steps_now, 3)}/${pad(r.budget_calls, 3)} ${padLeft(r.med_ms == null ? '' : Math.round(r.med_ms), 7)} ${padLeft(r.milestones ?? '', 5)} ${padLeft(r.score ?? '', 5)}`);
  }
  out.push('');

  const id = values.run ? Number(values.run) : rows.at(-1)?.id;
  const run = db.prepare('SELECT * FROM runs WHERE id = ?').get(id);
  if (!run) {
    out.push(`no run ${id}`);
    return out.join('\n');
  }
  const wanted = Math.max(1, Number(values.steps) || 14);
  const steps = db.prepare('SELECT * FROM steps WHERE run_id = ? ORDER BY seq DESC LIMIT ?').all(id, wanted).reverse();
  const events = db.prepare('SELECT seq, kind, detail_json FROM events WHERE run_id = ? ORDER BY seq, idx').all(id);
  const byStep = new Map();
  for (const e of events) {
    if (!byStep.has(e.seq)) byStep.set(e.seq, []);
    byStep.get(e.seq).push(e);
  }
  const st = status(run);
  const all = db.prepare('SELECT action, result, options_json, decide_ms, act_ms FROM steps WHERE run_id = ? ORDER BY seq').all(id);
  let eta = '';
  if (st.text === 'RUNNING' && all.length) {
    const recent = all.slice(-5).map((s) => (s.decide_ms ?? 0) + (s.act_ms ?? 0));
    const left = Math.max(0, run.budget_calls - all.length);
    eta = `  ${dim(`about ${ago(new Date(Date.now() - left * (recent.reduce((a, b) => a + b, 0) / recent.length)).toISOString())} left`)}`;
  }
  out.push(`${bold(`run ${id}`)}  ${run.game}  seed ${run.seed}  ${paint(st.color, st.text)}  ${dim(`started ${ago(run.started_at)} ago`)}${eta}`);
  const kinds = {};
  for (const e of events) kinds[e.kind] = (kinds[e.kind] ?? 0) + 1;
  if (events.length) out.push(dim('events: ' + Object.entries(kinds).map(([k, n]) => `${k} ${n}`).join(', ')));
  if (all.length) {
    // What the player picked. A player that takes the first option every time, or one action
    // every time, shows up here before it shows up in the score.
    const picks = {};
    let first = 0, withOptions = 0, failed = 0;
    for (const a of all) {
      const name = JSON.parse(a.action).name;
      picks[name] = (picks[name] ?? 0) + 1;
      if (JSON.parse(a.result).ok === false) failed++;
      if (a.options_json) {
        withOptions++;
        if (JSON.parse(a.options_json)[0] === name) first++;
      }
    }
    const top = Object.entries(picks).sort((x, y) => y[1] - x[1]).slice(0, 3).map(([n, c]) => `${n} ${c}`).join(', ');
    const parts = [`picks: ${top}${Object.keys(picks).length > 3 ? ', ...' : ''}`];
    if (withOptions) parts.push(`first option ${first}/${withOptions}`);
    parts.push(`failed ${failed}/${all.length}`);
    out.push(dim(short(parts.join('   '), width)));
  }
  out.push('');
  out.push(dim(`${padLeft('seq', 4)} ${padLeft('tick', 6)}  ${pad('action', 24)} ${pad('result', 8)} ${padLeft('decide', 7)} ${padLeft('act', 7)} ${padLeft('opts', 4)}  events`));
  const stepStart = out.length;
  for (const s of steps) {
    const action = JSON.parse(s.action);
    const result = JSON.parse(s.result);
    const ok = result.ok !== false && !result.error;
    const name = action.name + (action.args ? ' ' + short(action.args, 10) : '');
    const evs = (byStep.get(s.seq) ?? []).map((e) => `${e.kind} ${short(JSON.parse(e.detail_json), 30)}`).join('; ');
    const optCount = s.options_json ? JSON.parse(s.options_json).length : '';
    const room = Math.max(10, width - 70);
    const why = ok ? '' : short(result.error ?? JSON.stringify(result), Math.min(room, 40));
    const rest = short((why && evs ? ' ' : '') + evs, room - why.length);
    const tail = (why ? paint(COLOR.bad, why) : '') + rest;
    out.push(`${padLeft(s.seq, 4)} ${padLeft(s.tick, 6)}  ${pad(name, 24)} ${ok ? paint(COLOR.complete, pad('ok', 8)) : paint(COLOR.bad, pad('FAIL', 8))} ${padLeft(s.decide_ms == null ? '' : `${s.decide_ms}ms`, 7)} ${padLeft(s.act_ms == null ? '' : `${s.act_ms}ms`, 7)} ${padLeft(optCount, 4)}  ${tail}`);
  }
  if (!steps.length) out.push(dim('  no steps yet'));
  const stepEnd = out.length;

  const evaluation = db.prepare('SELECT score, reasons_md FROM evaluations WHERE run_id = ?').get(id);
  if (evaluation) {
    out.push('');
    out.push(`coach ${evaluation.score ?? '?'}/10  ${dim(short((evaluation.reasons_md ?? '').replace(/\s+/g, ' '), width - 14))}`);
  }
  if (!live || process.stdout.rows >= 48) out.push(...comparison(db, width));
  // A frame taller than the window scrolls its top off. Drop the oldest steps first, and
  // leave room for the footer line.
  const rowsAvailable = live ? process.stdout.rows : Infinity;
  let drop = Math.min(Math.max(0, out.length + 1 - rowsAvailable), stepEnd - stepStart - 1);
  if (steps.length && drop > 0) out.splice(stepStart, drop);
  return out.join('\n');
}

function draw() {
  // Open on every frame: a run that starts or ends between frames must show up, and a
  // read-only handle cannot block the runner's writes.
  const db = new DatabaseSync(dbFile, { readOnly: true });
  try {
    const text = frame(db);
    // Home, then erase to the end of each line and of the screen: no flicker, and on the
    // alternate screen nothing piles up in scrollback.
    const body = `${text}\n${dim('ctrl-c to quit')}`.split('\n').map((l) => l + '\x1b[K').join('\n');
    process.stdout.write(live ? `\x1b[H${body}\x1b[J` : text + '\n');
  } catch (error) {
    // A frame can land while the runner holds a write lock; the next one will work.
    if (!live) throw error;
    process.stdout.write(`\x1b[H${error.message}\x1b[K\x1b[J`);
  } finally {
    db.close();
  }
}

if (live) process.stdout.write('\x1b[?1049h\x1b[?25l');
const leave = () => process.stdout.write('\x1b[?25h\x1b[?1049l');
draw();
if (live) {
  const seconds = Math.max(0.2, Number(values.interval) || 1);
  setInterval(draw, seconds * 1000);
  process.on('exit', leave);
  process.on('SIGINT', () => process.exit(0));
}
