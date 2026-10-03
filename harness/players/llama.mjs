import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, openSync } from 'node:fs';
import { canon, sha256 } from '../canon.mjs';

// The local model as the player, through llama.cpp's llama-server. Every decision is one
// short request: the rules and the coach's briefing, the state, and the options. The
// answer is forced by a grammar to be one of the options offered, so the model cannot
// reply with anything the game does not understand, and it writes only a few tokens.

export const PROMPT_VERSION = 'choose-1';

export function fileSha256(path) {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    createReadStream(path).on('data', (chunk) => hash.update(chunk)).on('end', () => resolve(hash.digest('hex'))).on('error', reject);
  });
}

// Start llama-server on the CPU with thinking off, and wait until it answers.
export async function startLlamaServer({ bin, model, port = 8089, threads = 4, context = 8192, logFile }) {
  const out = logFile ? openSync(logFile, 'a') : 'ignore';
  const child = spawn(bin, [
    '-m', model, '--host', '127.0.0.1', '--port', String(port), '-c', String(context),
    '-t', String(threads), '-ngl', '0', '-np', '1', '--reasoning-budget', '0', '--no-webui',
  ], { stdio: ['ignore', out, out] });
  let exited = null;
  child.on('exit', (code) => { exited = code ?? 'killed'; });
  const url = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 180000;
  for (;;) {
    if (exited !== null) throw new Error(`llama-server stopped while loading (exit ${exited}); see ${logFile ?? 'its output'}`);
    if (Date.now() > deadline) { child.kill(); throw new Error('llama-server did not come up in 3 minutes'); }
    try {
      const res = await fetch(`${url}/health`);
      if (res.ok) break;
    } catch { /* not listening yet */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  return { url, stop: () => child.kill() };
}

function brief(value, limit = 160) {
  const text = typeof value === 'string' ? value : canon(value);
  return text.length > limit ? `${text.slice(0, limit)}...` : text;
}

export function buildMessages({ rules, briefing, observation, actions, previous }) {
  const system = [
    'You are playing a game. Each turn you choose one option from a list.',
    `Rules: ${rules}`,
    briefing ? `Advice from your coach:\n${briefing}` : null,
    'Answer with JSON like {"do":"option name"}, using exactly one of the option names offered.',
  ].filter(Boolean).join('\n\n');
  const recent = previous.length
    ? previous.map((p) => `${p.action.name} -> ${brief(p.result)}`).join('\n')
    : 'nothing yet';
  const user = [
    `State: ${canon(observation)}`,
    `Your last choices and what happened:\n${recent}`,
    `Options:\n${actions.map((a) => `- ${a.name}: ${a.about}`).join('\n')}`,
    'Choose the best option now.',
  ].join('\n\n');
  return [{ role: 'system', content: system }, { role: 'user', content: user }];
}

export function llamaPlayer({ url, label, modelHash = null, briefing = '' }) {
  return {
    id: `llama:${label}`,
    modelHash,
    promptVersion: PROMPT_VERSION,
    async decide({ observation, actions, rules, previous = [] }) {
      const messages = buildMessages({ rules, briefing, observation, actions, previous });
      const res = await fetch(`${url}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          messages,
          temperature: 0,
          seed: 0,
          max_tokens: 48,
          cache_prompt: true,
          response_format: {
            type: 'json_schema',
            json_schema: {
              name: 'choice',
              strict: true,
              schema: {
                type: 'object',
                properties: { do: { type: 'string', enum: actions.map((a) => a.name) } },
                required: ['do'],
                additionalProperties: false,
              },
            },
          },
        }),
      });
      if (!res.ok) throw new Error(`llama-server answered ${res.status}: ${brief(await res.text(), 300)}`);
      const json = await res.json();
      const text = json.choices?.[0]?.message?.content ?? '';
      let name = null;
      try { name = JSON.parse(text).do ?? null; } catch { /* recorded as an illegal action */ }
      return {
        action: { name },
        promptHash: sha256(canon(messages)),
        response: { text, timings: json.timings ?? null },
      };
    },
  };
}
