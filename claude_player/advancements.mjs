#!/usr/bin/env node
// Every advancement the game has, read from the server's own jar: its name, what it asks
// for, and which one it comes after. The curriculum (curriculum.mjs) is built on this list,
// so that what the player goes for next comes from the game and not from a list written by
// hand. Kept in data/claude_player/advancements.json, which is not in git.
//   node claude_player/advancements.mjs          read the jar, write the list, say how many
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { unzip } from './textures.mjs';

const JAR = fileURLToPath(new URL('../runtime/minecraft-coop-26.1/server.jar', import.meta.url));
export const LIST = fileURLToPath(new URL('../data/claude_player/advancements.json', import.meta.url));
const bare = (name) => String(name).replace(/^minecraft:/, '');

// The items a criterion is met by having, when having an item is what it asks. A tag (a
// family of items, written "#planks") is kept as it is.
function itemsOf(criterion) {
  if (bare(criterion.trigger) !== 'inventory_changed') return null;
  const out = [];
  for (const wanted of criterion.conditions?.items ?? []) for (const item of [].concat(wanted.items ?? [])) out.push(bare(item));
  return out.length ? out : null;
}

// The list, from a server jar. The jar holds the real one inside it.
export function fromJar(jarPath = JAR) {
  const outer = readFileSync(jarPath);
  let innerName = null;
  unzip(outer, (name) => { if (/^META-INF\/versions\/[^/]+\/server-[^/]+\.jar$/.test(name)) innerName = name; return false; });
  const inner = innerName ? unzip(outer, (name) => name === innerName)[innerName] : outer;
  const files = unzip(inner, (name) => name === 'assets/minecraft/lang/en_us.json' || (/^data\/minecraft\/advancement\/.*\.json$/.test(name) && !name.includes('/recipes/')));
  const words = JSON.parse(files['assets/minecraft/lang/en_us.json'].toString('utf8'));
  const text = (part) => (part?.translate ? words[part.translate] ?? part.translate : typeof part === 'string' ? part : part?.text ?? null);
  const out = [];
  for (const [path, data] of Object.entries(files)) {
    if (!path.startsWith('data/')) continue;
    const id = path.replace('data/minecraft/advancement/', '').replace(/\.json$/, '');
    const json = JSON.parse(data.toString('utf8'));
    if (!json.display) continue;                      // the game's own bookkeeping, never shown
    const criteria = Object.entries(json.criteria ?? {}).map(([name, c]) => ({ name, trigger: bare(c.trigger), items: itemsOf(c) }));
    out.push({ id, tab: id.split('/')[0], title: text(json.display.title), description: text(json.display.description),
      parent: json.parent ? bare(json.parent) : null, frame: json.display.frame ?? 'task',
      announced: json.display.announce_to_chat !== false, hidden: !!json.display.hidden,
      // Each group must be met; a group is met by any one of its criteria.
      groups: json.requirements ?? criteria.map((c) => [c.name]), criteria });
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

// The list as the player uses it: from the file, written again when the jar is newer.
export function load() {
  if (existsSync(LIST) && (!existsSync(JAR) || statSync(LIST).mtimeMs >= statSync(JAR).mtimeMs)) return JSON.parse(readFileSync(LIST, 'utf8'));
  const list = fromJar();
  mkdirSync(dirname(LIST), { recursive: true });
  writeFileSync(LIST, JSON.stringify(list));
  return list;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const list = fromJar();
  mkdirSync(dirname(LIST), { recursive: true });
  writeFileSync(LIST, JSON.stringify(list));
  const tabs = {};
  for (const a of list) tabs[a.tab] = (tabs[a.tab] ?? 0) + 1;
  console.log(`${list.length} advancements from ${JAR}: ${Object.entries(tabs).map(([tab, n]) => `${tab} ${n}`).join(', ')}`);
  console.log(`${list.filter((a) => a.criteria.every((c) => c.items)).length} are earned by having an item; ${list.filter((a) => a.hidden).length} are hidden until earned`);
}
