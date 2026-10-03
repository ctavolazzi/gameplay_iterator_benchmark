import { DatabaseSync } from 'node:sqlite';
import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { canon } from './canon.mjs';

// One SQLite file for every run of every game, plus one JSONL file per run holding the
// same steps as raw text. Each step is written as it happens, so a run that crashes
// leaves what it did and an ended_reason that says it never finished.
const SCHEMA = `
CREATE TABLE IF NOT EXISTS runs (
  id INTEGER PRIMARY KEY,
  game TEXT NOT NULL,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  seed TEXT NOT NULL,
  game_version TEXT NOT NULL,
  options_json TEXT NOT NULL,
  code_commit TEXT NOT NULL,
  player TEXT NOT NULL,
  model_hash TEXT,
  prompt_version TEXT,
  skill_library_version TEXT,
  budget_ticks INTEGER NOT NULL,
  budget_calls INTEGER NOT NULL,
  ended_reason TEXT,
  step_count INTEGER,
  trace_hash TEXT
);
CREATE TABLE IF NOT EXISTS steps (
  run_id INTEGER NOT NULL REFERENCES runs(id),
  seq INTEGER NOT NULL,
  tick INTEGER NOT NULL,
  observation_json TEXT NOT NULL,
  prompt_hash TEXT,
  response_json TEXT,
  action TEXT NOT NULL,
  result TEXT NOT NULL,
  decide_ms INTEGER,
  act_ms INTEGER,
  options_json TEXT,
  PRIMARY KEY (run_id, seq)
);
CREATE TABLE IF NOT EXISTS events (
  run_id INTEGER NOT NULL REFERENCES runs(id),
  seq INTEGER NOT NULL,
  idx INTEGER NOT NULL,
  tick INTEGER NOT NULL,
  kind TEXT NOT NULL,
  detail_json TEXT NOT NULL,
  PRIMARY KEY (run_id, seq, idx)
);
CREATE TABLE IF NOT EXISTS metrics (
  run_id INTEGER NOT NULL REFERENCES runs(id),
  name TEXT NOT NULL,
  value REAL NOT NULL,
  PRIMARY KEY (run_id, name)
);
CREATE TABLE IF NOT EXISTS evaluations (
  run_id INTEGER NOT NULL REFERENCES runs(id),
  evaluator TEXT NOT NULL,
  rubric_version TEXT NOT NULL,
  score REAL,
  reasons_md TEXT,
  suggestions_json TEXT
);
CREATE TABLE IF NOT EXISTS skill_versions (
  version TEXT PRIMARY KEY,
  parent_version TEXT,
  created_by_run INTEGER REFERENCES runs(id),
  diff_summary TEXT
);
`;

export function openStore(dir) {
  mkdirSync(join(dir, 'runs'), { recursive: true });
  const db = new DatabaseSync(join(dir, 'benchmark.sqlite'));
  db.exec('PRAGMA foreign_keys = ON');
  db.exec(SCHEMA);
  // A database made before these columns existed gets them added: how long the decision
  // and the action took, and which options the player was choosing from.
  const stepColumns = db.prepare("SELECT name FROM pragma_table_info('steps')").all().map((c) => c.name);
  for (const [column, type] of [['decide_ms', 'INTEGER'], ['act_ms', 'INTEGER'], ['options_json', 'TEXT']]) {
    if (!stepColumns.includes(column)) db.exec(`ALTER TABLE steps ADD COLUMN ${column} ${type}`);
  }

  const logPath = (runId) => join(dir, 'runs', `run-${String(runId).padStart(6, '0')}.jsonl`);
  const log = (runId, line) => appendFileSync(logPath(runId), canon(line) + '\n');

  const insertRun = db.prepare(`INSERT INTO runs
    (game, started_at, seed, game_version, options_json, code_commit, player, model_hash,
     prompt_version, skill_library_version, budget_ticks, budget_calls)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const insertStep = db.prepare(`INSERT INTO steps
    (run_id, seq, tick, observation_json, prompt_hash, response_json, action, result, decide_ms, act_ms, options_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const insertEvent = db.prepare(`INSERT INTO events
    (run_id, seq, idx, tick, kind, detail_json) VALUES (?, ?, ?, ?, ?, ?)`);
  const insertMetric = db.prepare('INSERT INTO metrics (run_id, name, value) VALUES (?, ?, ?)');
  const finishRun = db.prepare(`UPDATE runs
    SET ended_at = ?, ended_reason = ?, step_count = ?, trace_hash = ? WHERE id = ?`);
  const insertEvaluation = db.prepare(`INSERT INTO evaluations
    (run_id, evaluator, rubric_version, score, reasons_md, suggestions_json) VALUES (?, ?, ?, ?, ?, ?)`);
  const insertSkillVersion = db.prepare(`INSERT OR IGNORE INTO skill_versions
    (version, parent_version, created_by_run, diff_summary) VALUES (?, ?, ?, ?)`);

  function beginRun(run) {
    const info = insertRun.run(
      run.game, run.startedAt, run.seed, run.gameVersion, canon(run.options), run.commit,
      run.player, run.modelHash ?? null, run.promptVersion ?? null,
      run.skillLibraryVersion ?? null, run.budget.ticks, run.budget.calls,
    );
    const id = Number(info.lastInsertRowid);
    log(id, { type: 'run', id, ...run });
    return id;
  }

  function step(runId, s) {
    db.exec('BEGIN');
    try {
      insertStep.run(
        runId, s.seq, s.tick, canon(s.observation), s.promptHash ?? null,
        s.response == null ? null : canon(s.response), canon(s.action), canon(s.result),
        s.decideMs ?? null, s.actMs ?? null, s.options ? canon(s.options) : null,
      );
      s.events.forEach((e, idx) => insertEvent.run(runId, s.seq, idx, e.tick, e.kind, canon(e.detail)));
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
    log(runId, { type: 'step', ...s });
  }

  function endRun(runId, end) {
    finishRun.run(end.endedAt, end.endedReason, end.steps, end.traceHash, runId);
    for (const [name, value] of Object.entries(end.metrics)) insertMetric.run(runId, name, value);
    log(runId, { type: 'end', ...end });
  }

  // What the coach said about a run, and the playbook version it wrote, if any.
  function addEvaluation(runId, e) {
    insertEvaluation.run(runId, e.evaluator, e.rubricVersion, e.score ?? null, e.reasons ?? null, canon(e.suggestions ?? {}));
    log(runId, { type: 'evaluation', ...e });
  }

  function addSkillVersion(v) {
    insertSkillVersion.run(v.version, v.parent ?? null, v.createdByRun ?? null, v.summary ?? null);
  }

  function getRun(runId) {
    const row = db.prepare('SELECT * FROM runs WHERE id = ?').get(runId);
    return row ? { ...row, options: JSON.parse(row.options_json) } : null;
  }

  function getSteps(runId) {
    const events = new Map();
    for (const e of db.prepare('SELECT * FROM events WHERE run_id = ? ORDER BY seq, idx').all(runId)) {
      if (!events.has(e.seq)) events.set(e.seq, []);
      events.get(e.seq).push({ tick: e.tick, kind: e.kind, detail: JSON.parse(e.detail_json) });
    }
    return db.prepare('SELECT * FROM steps WHERE run_id = ? ORDER BY seq').all(runId).map((r) => ({
      seq: r.seq,
      tick: r.tick,
      observation: JSON.parse(r.observation_json),
      action: JSON.parse(r.action),
      result: JSON.parse(r.result),
      events: events.get(r.seq) ?? [],
      promptHash: r.prompt_hash,
      response: r.response_json == null ? null : JSON.parse(r.response_json),
      decideMs: r.decide_ms,
      actMs: r.act_ms,
      options: r.options_json == null ? null : JSON.parse(r.options_json),
    }));
  }

  function getMetrics(runId) {
    const out = {};
    for (const m of db.prepare('SELECT name, value FROM metrics WHERE run_id = ? ORDER BY name').all(runId)) {
      out[m.name] = m.value;
    }
    return out;
  }

  const getEvaluations = (runId) =>
    db.prepare('SELECT * FROM evaluations WHERE run_id = ?').all(runId)
      .map((row) => ({ ...row, suggestions: JSON.parse(row.suggestions_json) }));

  const listRuns = () => db.prepare('SELECT * FROM runs ORDER BY id').all().map((row) => ({ ...row }));

  return {
    db, dir, logPath, beginRun, step, endRun, addEvaluation, addSkillVersion,
    getRun, getSteps, getMetrics, getEvaluations, listRuns,
    close: () => db.close(),
  };
}
