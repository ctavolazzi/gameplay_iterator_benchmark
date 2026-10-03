import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';

// A playbook is one version of everything the coach may change between runs. It lives in
// playbooks/<game>/vNNN/ and holds two files:
//   briefing.md   advice the model reads before every decision
//   skills.js     the commands the model can choose from, as code
// The model's weights never change. The playbook is the part that learns.

// How skills.js is written. This text is also handed to the coach, word for word.
export const SKILLS_CONTRACT = `skills.js is a plain script that sets one variable, skills. It runs in an empty sandbox:
no require, no import, no process, no files, no network. Start it with "skills = {".

skills = {
  skill_name: {                      // lowercase letters, digits and underscores
    about: 'one line the model reads when it chooses',
    options(observation, primitives) {            // optional
      return [{ arg: 'tree', about: 'one line for this form of the skill' }];
    },
    async run(api, arg) {
      // do the work, then return a short note on what happened
      return 'reached the tree';
    },
  },
};

options() says which forms of the skill make sense right now. Each entry is offered to the
model as "skill_name:arg". An empty list hides the skill. Leave options out and the skill is
always offered, as plain "skill_name", and run() gets no arg. arg must be a short word.

Inside run(), api is all there is:
  await api.observe()      the game's observation right now
  await api.primitives()   the game's own actions possible right now: [{ name, about }]
  await api.act(name)      do one of them; returns its result, { ok: true, ... } or
                           { ok: false, error }. An action that is not possible now is
                           refused with ok false, and nothing happens.
A skill call may use at most 300 primitive actions, and must stop by itself. Return a string
note, or { ok: false, note: 'why it could not be done' } when it failed.`;

const MAX_PRIMITIVES = 300;
const SKILL_NAME = /^[a-z][a-z0-9_]*$/;

export const playbookDir = (root, game, version) => join(root, 'playbooks', game, version);

export function listVersions(root, game) {
  const dir = join(root, 'playbooks', game);
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((name) => /^v\d{3}$/.test(name)).sort();
}

export const latestVersion = (root, game) => listVersions(root, game).at(-1) ?? null;

// Load a playbook, running skills.js in a sandbox. Throws, naming the problem, when the
// file does not parse or a skill is not shaped as the contract says.
export function loadPlaybook(dir) {
  const briefing = readFileSync(join(dir, 'briefing.md'), 'utf8').trim();
  const code = readFileSync(join(dir, 'skills.js'), 'utf8');
  const sandbox = vm.createContext({});
  vm.runInContext(`${code}\n;globalThis.__skills = typeof skills === 'undefined' ? undefined : skills;`, sandbox, {
    filename: join(dir, 'skills.js'),
    timeout: 2000,
  });
  const skills = sandbox.__skills;
  const problems = [];
  if (!skills || typeof skills !== 'object' || !Object.keys(skills).length) {
    problems.push('skills.js did not set skills to an object with at least one skill');
  } else {
    for (const [name, skill] of Object.entries(skills)) {
      if (!SKILL_NAME.test(name)) problems.push(`skill name '${name}' must be lowercase letters, digits and underscores`);
      if (typeof skill?.about !== 'string' || !skill.about) problems.push(`${name}: about must be a line of text`);
      if (typeof skill?.run !== 'function') problems.push(`${name}: run must be a function`);
      if (skill?.options !== undefined && typeof skill.options !== 'function') problems.push(`${name}: options must be a function or left out`);
    }
  }
  if (problems.length) throw new Error(`playbook ${dir}: ${problems.join('; ')}`);
  return { dir, briefing, code, skills };
}

// Put a playbook's skills between the player and the game. The player now chooses among
// skills; each skill runs as code against the game's own actions. To the runner this is
// still a game adapter: one decision in, one result and its events out.
export function withSkills(adapter, playbook) {
  const { skills } = playbook;

  async function actions() {
    const observation = await adapter.observe();
    const primitives = await adapter.actions();
    const list = [];
    for (const [name, skill] of Object.entries(skills)) {
      let options = [{}];
      if (skill.options) {
        try { options = skill.options(observation, primitives) ?? []; } catch { options = []; }
      }
      for (const option of options) {
        list.push({ name: option.arg == null ? name : `${name}:${option.arg}`, about: option.about ?? skill.about });
      }
    }
    return list;
  }

  async function act(action) {
    const [name, ...rest] = String(action.name).split(':');
    const arg = rest.length ? rest.join(':') : undefined;
    const events = [];
    let used = 0;
    const api = {
      observe: () => adapter.observe(),
      primitives: () => adapter.actions(),
      async act(primitive) {
        if (adapter.ended()) return { ok: false, error: 'the game is over' };
        if (used >= MAX_PRIMITIVES) throw new Error(`used more than ${MAX_PRIMITIVES} actions without finishing`);
        const legal = await adapter.actions();
        if (!legal.some((a) => a.name === primitive)) return { ok: false, error: `'${primitive}' is not possible now` };
        used += 1;
        const out = await adapter.act({ name: primitive });
        const now = adapter.tick();
        for (const e of out.events ?? []) events.push({ tick: e.tick ?? now, kind: e.kind, detail: e.detail ?? {} });
        return out.result;
      },
    };
    try {
      const out = await skills[name].run(api, arg);
      // A failure keeps its reason, whether the skill wrote one or passed on the game's own.
      const failed = out && typeof out === 'object' && out.ok === false;
      return { result: { ok: !failed, note: (failed ? out.note ?? out.error : out) ?? null, actions: used }, events };
    } catch (error) {
      // A bug in a skill is the playbook's fault, not a reason to lose the run.
      return { result: { ok: false, error: `skill crashed: ${error?.message ?? error}`, actions: used }, events };
    }
  }

  return {
    name: adapter.name,
    version: adapter.version,
    reset: (input) => adapter.reset(input),
    observe: () => adapter.observe(),
    actions,
    act,
    tick: () => adapter.tick(),
    ended: () => adapter.ended(),
    metrics: (log) => adapter.metrics(log),
    describe: () => adapter.describe(),
    close: () => adapter.close(),
    idle: (phase) => adapter.idle?.(phase),
  };
}
