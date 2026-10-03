import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, openSync } from 'node:fs';
import { request } from 'node:http';
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
  // If something already answers on this port, stop here. Otherwise the new server would
  // fail to bind, the health check below would be answered by the old one, and the run
  // would be played by whatever model that one holds while recording this one's name.
  const taken = await fetch(`http://127.0.0.1:${port}/health`).then(() => true, () => false);
  if (taken) throw new Error(`port ${port} already has a server on it; another run may be using it`);
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

// One request on a connection of its own. fetch keeps connections open and reuses them, and
// that lost two runs on 2026-10-03: when a skill kept this process busy for a while (path
// planning does), the next request went out on a connection llama-server had already
// closed and failed with ECONNRESET, "fetch failed". The server itself was fine. Found by
// another session with a probe: 2 of 9 requests failed after a busy gap, 0 of 17 after an
// idle one.
function postJson(url, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = request(url, {
      method: 'POST',
      agent: false,
      headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) },
    }, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { text += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, text }));
      res.on('error', reject);
    });
    req.on('error', reject);
    req.end(data);
  });
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

// A request that fails is sent once more as it is. Only if that fails too is recover()
// called, to start the model server again, before a last try.
export function llamaPlayer({ url, label, modelHash = null, briefing = '', recover = null }) {
  return {
    id: `llama:${label}`,
    modelHash,
    promptVersion: PROMPT_VERSION,
    async decide({ observation, actions, rules, previous = [] }) {
      const messages = buildMessages({ rules, briefing, observation, actions, previous });
      const send = () => postJson(`${url}/v1/chat/completions`, {
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
      });
      let res;
      try {
        res = await send();
      } catch (first) {
        try {
          res = await send();
        } catch {
          if (!recover) throw first;
          await recover();
          res = await send();
        }
      }
      if (res.status !== 200) throw new Error(`llama-server answered ${res.status}: ${brief(res.text, 300)}`);
      const json = JSON.parse(res.text);
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
