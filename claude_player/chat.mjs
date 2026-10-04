// What the player says back when someone speaks in the game's chat. It answers every
// message from a person, whether or not it is named, from what it is doing right now.
// No model is asked: the answers are built from the player's own state. Anything it cannot
// answer is journalled as open, for the Claude session to answer on its next turn.
// player.mjs loads this file again whenever it changes.

import { appendFileSync } from 'node:fs';

// Notes from a person on how to play better go to this file, one per line. The Claude session
// reads them, decides whether each holds up, and changes the player's code if it does.
// The player itself never changes its code because of something said in chat.
const NOTES = new URL('../data/claude_player/notes.jsonl', import.meta.url);
const ADVICE = /\b(you (can|could|should|might|may|need|must|don'?t|do not|probably|want)|try|instead|don'?t|do not|never|always|make sure|remember|tip|hint|better|no need|careful|watch out|avoid|use (the|a|an|your)|it'?s (faster|safer|better|easier)|if (there|you)|when you|should)\b/;
const OTHER_PLAYERS_THAT_ARE_PROGRAMS = /codex|bot$/i;
const list = (things) => things.join(', ') || 'nothing';

export async function heard({ bot, memory, username, message, status, event, say, stop }) {
  if (OTHER_PLAYERS_THAT_ARE_PROGRAMS.test(username)) return;      // two programs answering each other never stop
  const text = message.toLowerCase();
  if (/^\s*@?codex\b/.test(text) && !/claude/.test(text)) return;  // said to someone else by name
  // Said to another player by a short form of its name. Turn 13: "Astra, can you please actually
  // play the game?" was meant for CodexAstra, and this player answered it.
  const firstWord = /^\s*@?([a-z0-9_]{4,})\b[,:]?/.exec(text)?.[1];
  const toAnother = firstWord && Object.keys(bot.players ?? {}).some((name) => name !== bot.username && name.toLowerCase().includes(firstWord));
  if (toAnother && !/claude/.test(text)) return;
  const now = Date.now();
  if (now - (memory.lastReply ?? 0) < 1500) return;
  memory.lastReply = now;

  const saying = { collect: 'digging for', craft: 'crafting', smelt: 'smelting', hunt: 'hunting', explore: 'looking around,', goto: 'walking,',
    build_base: 'building my base,', sleep: 'getting into bed,', descend: 'digging down,', surface: 'climbing out,', place: 'putting down', gather_seeds: 'looking for seeds,',
    plant_seed: 'planting,', recover: 'fetching what I dropped,', wear: 'putting on armour,', come: 'walking to you,' };
  const about = status.doing?.args?.block ?? status.doing?.args?.item ?? status.doing?.args?.input ?? status.doing?.args?.animal ?? '';
  const doing = status.doing
    ? `${saying[status.doing.skill] ?? status.doing.skill} ${about} for my goal "${status.doing.goal ?? 'a request'}"`.replace(/\s+/g, ' ')
    : status.sheltered ? 'sitting out the night in my shelter' : status.thought?.goal ? `between steps on ${status.thought.goal}` : 'deciding what to do next';
  const have = status.carried ?? {};
  const wool = Object.entries(have).filter(([name]) => name.endsWith('_wool')).reduce((sum, [, n]) => sum + n, 0);
  const bed = Object.keys(have).some((name) => name.endsWith('_bed'));
  const race = memory.slept ? 'I have slept in my bed at my base.'
    : memory.places?.bed ? 'My bed is down in my base; I sleep there at dusk.'
      : bed ? 'I have my bed and am building the base for it.' : `I have ${wool} of 3 wool for the bed.`;
  const them = bot.players[username]?.entity;
  const away = them ? `${Math.round(them.position.distanceTo(bot.entity.position))} blocks from you` : 'out of your sight';

  let answer;
  const short = text.trim().split(/\s+/).length <= 5;
  if (!short && ADVICE.test(text)) {
    // Checked before the greetings: CT's first tip began "Hey claude, if there's already a
    // crafting table near you..." and was answered with "Hello fogsift. I am digging for iron".
    appendFileSync(NOTES, `${JSON.stringify({ at: new Date().toISOString(), username, message, where: status.where, doing: status.doing?.skill ?? null })}\n`);
    event('player_note', { username, message });
    answer = `Noted, ${username}, thank you. I have written that down for my Claude session, which changes my code when a note holds up.`;
  } else if (/\b(stop|wait|stay|hold on|freeze)\b/.test(text)) {
    memory.order = { kind: 'wait', player: username, until: now + 60000 };
    stop();
    answer = 'Stopping. I will wait here for a minute; say resume to send me on.';
  } else if (/\b(resume|continue|carry on|go on|go ahead|keep going)\b/.test(text)) {
    delete memory.order;
    answer = `Carrying on: ${doing}.`;
  } else if (/\b(come|follow|over here|to me)\b/.test(text)) {
    memory.order = { kind: 'come', player: username, until: now + 90000 };
    stop();
    answer = `Coming to you. I am ${away}.`;
  } else if (/\bwhere\b/.test(text)) {
    answer = `I am at ${status.where.x} ${status.where.y} ${status.where.z}, ${away}.`;
  } else if (/\b(inventory|carrying|what do you have|what have you got|items)\b/.test(text)) {
    answer = `I carry ${list(Object.entries(have).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([name, n]) => `${n} ${name}`))}.`;
  } else if (/\b(advancements?|achievements?|score|progress)\b/.test(text)) {
    answer = `${status.earned.length} advancements: ${list(status.earned)}. Deaths: ${status.deaths}. ${race}`;
  } else if (/\b(bed|base|sleep|race|winning|codex)\b/.test(text)) {
    answer = `${race} Right now: ${doing}.`;
  } else if (/\b(thanks|thank you|nice|good job|well done|gg|great)\b/.test(text)) {
    answer = 'Thank you.';
  } else if (/\b(help|what can you)\b/.test(text)) {
    answer = 'Ask me what I am doing, where I am, what I carry, or my progress. Or say come, wait, or resume.';
  } else if (/\b(hi|hey|hello|yo|sup|what'?s up|up to|doing|status|how are you|how is it going|how's it going)\b/.test(text)) {
    answer = `Hello ${username}. I am ${doing}. ${race} Health ${Math.round(status.health)}, ${status.earned.length} advancements.`;
  } else {
    event('chat_open', { username, message });
    answer = `I heard you, ${username}. I am ${doing}. I have passed that on to the Claude session, which answers in a few minutes.`;
  }
  say(answer);
}
