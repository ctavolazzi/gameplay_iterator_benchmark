import { execFile } from 'node:child_process';
import { mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { canon } from './canon.mjs';
import { SKILLS_CONTRACT, latestVersion, playbookDir } from './skills.mjs';

// The coach: after a run ends, Claude reads what happened and may write the next
// playbook. Claude never plays. It changes what the local model is told and which
// commands it can choose from; the model's weights stay as they are.

export const RUBRIC_VERSION = 'coach-1';

// The run as the coach reads it: inputs, how it ended, the numbers, then every decision.
export function runReport(store, runId, maxSteps = 80) {
  const run = store.getRun(runId);
  const steps = store.getSteps(runId);
  const metrics = store.getMetrics(runId);
  const half = Math.floor(maxSteps / 2);
  const shown = steps.length > maxSteps ? [...steps.slice(0, half), ...steps.slice(-half)] : steps;
  const lines = [
    `Run ${runId}: game ${run.game}, seed ${run.seed}, playbook ${run.skill_library_version}, player ${run.player}.`,
    `Ended by ${run.ended_reason} after ${steps.length} decisions. The budget was ${run.budget_ticks} ticks and ${run.budget_calls} decisions.`,
    `Metrics: ${Object.entries(metrics).map(([name, value]) => `${name}=${value}`).join(', ')}`,
    '',
    'Every decision in order: what the model saw, what it chose, what happened.',
  ];
  let last = -1;
  for (const s of shown) {
    if (s.seq !== last + 1) lines.push(`... ${s.seq - last - 1} decisions left out ...`);
    last = s.seq;
    lines.push(`#${s.seq} tick ${s.tick} saw ${canon(s.observation)}`);
    if (s.options) lines.push(`   options were: ${s.options.join(', ')}`);
    const events = s.events.length ? ` events ${canon(s.events.map((e) => ({ [e.kind]: e.detail })))}` : '';
    lines.push(`   chose ${s.action.name} -> ${canon(s.result)}${events}`);
  }
  return lines.join('\n');
}

export function coachPrompt({ rules, vocabulary, playbook, version, report, rejected }) {
  return [
    'You are the coach for a small local language model that plays a game by choosing one command at a time.',
    'The model is fast and weak: it cannot plan far ahead, and it never changes. What changes between runs is the playbook you write: a briefing it reads before every decision, and the skills (commands, written as code) it chooses from.',
    'Read the last run, judge it, and improve the playbook so the same model does better next run in the same world.',
    '',
    'Ground rules:',
    '- A skill does one clear job (go somewhere, collect something, make something). Never write a skill that plays the whole game: the model must still decide what to do next.',
    '- Offer every option that is possible and reasonable in the current state. Do not hide an option only because another is better: choosing between them is the model\'s job, and the briefing is where you tell it how to choose. A decision with a single option is not a decision.',
    '- Still keep the menu short: hide what is impossible or pointless right now by returning [] from options(). Under 8 options at a time.',
    '- Skill code must be safe in any state: check what is possible before acting, and always stop.',
    '- The briefing is under 120 words of plain instructions: what to do first, what to avoid, in the order it matters.',
    '- If the run went well and nothing is worth changing, keep the playbook.',
    '',
    'THE GAME',
    rules,
    "The game's own actions, which api.act(name) can do:",
    ...vocabulary.map((a) => `- ${a.name}: ${a.about}`),
    '',
    'HOW skills.js IS WRITTEN',
    SKILLS_CONTRACT,
    '',
    `THE CURRENT PLAYBOOK (${version})`,
    '--- briefing.md ---',
    playbook.briefing,
    '--- skills.js ---',
    playbook.code,
    '',
    'THE RUN',
    report,
    '',
    rejected ? `YOUR LAST ANSWER WAS REJECTED: ${rejected}\nFix that and answer again.\n` : '',
    'Reply in exactly this form, with nothing before or after it:',
    '<score>a whole number from 0 to 10 for how well the model played</score>',
    '<reasons>what happened and why, in a few sentences</reasons>',
    '<summary>one sentence: what you changed and what you expect it to do</summary>',
    '<briefing>the full new briefing, or the single word KEEP</briefing>',
    '<skills>the full new skills.js, or the single word KEEP</skills>',
  ].join('\n');
}

// Ask Claude headlessly, with nothing loaded but the question: no tools, no MCP servers,
// no user or project settings, no skills, nothing saved, from a neutral folder. Measured
// on 2026-10-02: without these flags a one-word answer carried 245,454 tokens of the
// machine's Claude setup; with them, 668.
export function askClaude(prompt, { bin = 'claude', model = null, timeoutMs = 600000 } = {}) {
  const args = [
    '-p', '--output-format', 'json', '--tools', '', '--no-session-persistence',
    '--strict-mcp-config', '--setting-sources', '', '--disable-slash-commands',
    '--system-prompt', 'You are a careful game coach. Answer exactly in the form asked, with nothing else.',
  ];
  if (model) args.push('--model', model);
  return new Promise((resolve, reject) => {
    const child = execFile(bin, args, { cwd: tmpdir(), maxBuffer: 64 * 1024 * 1024, timeout: timeoutMs }, (error, stdout) => {
      let result = null;
      try {
        const parsed = JSON.parse(stdout);
        result = Array.isArray(parsed) ? parsed.find((m) => m.type === 'result') : parsed;
      } catch { /* reported below */ }
      if (!result) return reject(new Error(`claude gave no result${error ? `: ${error.message}` : ''}`));
      if (result.is_error) return reject(new Error(`claude: ${result.result}`));
      resolve({ text: result.result, costUsd: result.total_cost_usd ?? null });
    });
    child.stdin.end(prompt);
  });
}

function section(text, name) {
  const match = text.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`));
  return match ? match[1].trim() : null;
}

export function parseCoachReply(text) {
  const score = Number(section(text, 'score'));
  const reasons = section(text, 'reasons');
  const briefing = section(text, 'briefing');
  let skills = section(text, 'skills');
  if (!Number.isFinite(score) || reasons == null || briefing == null || skills == null) {
    throw new Error('the reply is missing one of the score, reasons, briefing or skills sections');
  }
  skills = skills.replace(/^```[a-z]*\n/, '').replace(/\n```$/, '');
  const kept = (value) => (value === 'KEEP' ? null : value);
  return { score, reasons, summary: section(text, 'summary') ?? '', briefing: kept(briefing), skills: kept(skills) };
}

function nextVersion(root, game) {
  const latest = latestVersion(root, game);
  return `v${String((latest ? Number(latest.slice(1)) : 0) + 1).padStart(3, '0')}`;
}

// Coach one finished run. A new playbook is adopted only if validate(dir) passes it;
// validate returns null for a good playbook, or the reason it is not. A rejected answer
// goes back to the coach once with that reason. Whatever happens is stored with the run.
export async function coachRun({
  store, runId, root, game, version, playbook, rules, vocabulary = [], validate, ask = askClaude, attempts = 2,
}) {
  const report = runReport(store, runId);
  let reply = null;
  let rejected = null;
  let newVersion = null;
  let costUsd = 0;
  for (let attempt = 1; attempt <= attempts && !newVersion; attempt++) {
    const answer = await ask(coachPrompt({ rules, vocabulary, playbook, version, report, rejected }));
    costUsd += answer.costUsd ?? 0;
    try {
      reply = parseCoachReply(answer.text);
    } catch (error) {
      rejected = error.message;
      continue;
    }
    if (reply.briefing == null && reply.skills == null) { rejected = null; break; }
    const candidate = join(root, 'playbooks', game, '.candidate');
    rmSync(candidate, { recursive: true, force: true });
    mkdirSync(candidate, { recursive: true });
    writeFileSync(join(candidate, 'briefing.md'), `${reply.briefing ?? playbook.briefing}\n`);
    writeFileSync(join(candidate, 'skills.js'), `${(reply.skills ?? playbook.code).trimEnd()}\n`);
    rejected = await validate(candidate);
    if (rejected) {
      rmSync(candidate, { recursive: true, force: true });
      continue;
    }
    newVersion = nextVersion(root, game);
    renameSync(candidate, playbookDir(root, game, newVersion));
    store.addSkillVersion({
      version: `${game}/${newVersion}`, parent: `${game}/${version}`, createdByRun: runId, summary: reply.summary,
    });
  }
  if (!reply) throw new Error(`the coach gave no usable answer: ${rejected}`);
  const outcome = {
    summary: reply.summary,
    newVersion: newVersion ? `${game}/${newVersion}` : null,
    rejected: newVersion ? null : rejected,
    costUsd,
  };
  store.addEvaluation(runId, {
    evaluator: 'claude -p', rubricVersion: RUBRIC_VERSION, score: reply.score, reasons: reply.reasons, suggestions: outcome,
  });
  return { score: reply.score, reasons: reply.reasons, ...outcome, newVersion };
}
