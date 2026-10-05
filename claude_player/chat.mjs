// What the player says back when someone speaks in the game's chat. It answers every
// message from a person, whether or not it is named, from what it is doing right now.
// No model is asked: the answers are built from the player's own state. Anything it cannot
// answer is journalled as open, for the Claude session to answer on its next turn.
// player.mjs loads this file again whenever it changes.

import { appendFileSync, existsSync, statSync } from 'node:fs';

// Notes from a person on how to play better go to this file, one per line. The Claude session
// reads them, decides whether each holds up, and changes the player's code if it does.
// The player itself never changes its code because of something said in chat.
const NOTES = new URL('../data/claude_player/notes.jsonl', import.meta.url);
const ADVICE = /\b(you (can|could|should|might|may|need|must|don'?t|do not|probably|want)|try|instead|don'?t|do not|never|always|make sure|remember|tip|hint|better|no need|careful|watch out|avoid|use (the|a|an|your)|it'?s (faster|safer|better|easier)|if (there|you)|when you|should)\b/;
const PROGRAMS = /codex|bot$/i;
const PEERS = new Set(['Codex', 'CodexAstra']);
const list = (things) => things.join(', ') || 'nothing';
// Another file of the player, loaded again only when it has changed (as player.mjs does).
const load = (file) => {
  const url = new URL(file, import.meta.url);
  return import(`${url.href}?v=${statSync(url).mtimeMs}`);
};
// What a message asks for by way of work on the land. Read when this file loads: after a
// change to land.mjs's asksFor(), save this file too.
const { asksFor } = await load('./land.mjs');

// Whether a message asks this player to get into its bed. On 2026-10-04 fogsift said "I went
// to sleep" and "Come on everybody sleep plz": the first was answered with a status line and
// the second was taken for "come to me", and the night was not slept through.
function sleepAsked(text) {
  if (/^\s*(claude[,:]?\s*)?(sleep|bed)( please| plz| pls| now)?[.!]*\s*$/.test(text)) return true;
  if (!/\b(sleep|sleeping|asleep|bed)\b/.test(text)) return false;
  // A question about the bed, or about the night that was, is not a request.
  if (/^\s*(claude[,:]?\s*)?(did|have|has|had|where|what|which|who|how|why|is|are|was|were|do|does)\b/.test(text)) return false;
  return /\b(go|get|going|everybody|everyone|every one|y'?all|guys|all|plz|pls|please|now|let'?s|lets|time|need|needs|gotta|have to|should|come on|c'?mon|i went|i'?m|i am|im|we|can you|could you|will you|would you)\b/.test(text);
}

// What a message is asking for, as one word. The first rule that fits wins. Kept apart from
// the answers so that it can be tested against what was really said in the game.
export function reads(message) {
  const text = String(message).toLowerCase();
  const short = text.trim().split(/\s+/).length <= 5;
  if (/\b(rise and shine|wake up|wakey|get up|good morning)\b/.test(text)) return 'morning';
  if (sleepAsked(text)) return 'bed';
  // fogsift, lying in his bed at 21:13 on 2026-10-04: "How far are you from bed?" The answer
  // he got was where the bed is and what the player was doing, and not how far.
  if (/\bhow (far|close|near|long)\b.*\b(bed|sleep|home|base)\b/.test(text)) return 'bedtrip';
  // Work on the land, before the notes: "the trees should be finished up and the wood
  // harvested" has a "should" in it and is a job, not a tip. asksFor() leaves the tips alone.
  if (asksFor(message).length) return 'works';
  // Before the greetings: CT's first tip began "Hey claude, if there's already a crafting
  // table near you..." and was answered with "Hello fogsift. I am digging for iron".
  if (!short && ADVICE.test(text)) return 'note';
  if (/\b(stop|wait|stay|hold on|freeze)\b/.test(text)) return 'wait';
  if (/\b(resume|continue|carry on|go on|go ahead|keep going)\b/.test(text)) return 'resume';
  if (/\b(follow( me)?|come with me|stay with me|stick with me|walk with me)\b/.test(text)) return 'follow';
  // "Come on everybody" is not "come to me".
  if (/\b(come (here|over|to me|back)|over here|to me)\b/.test(text) || /^\s*(claude[,:]?\s*)?come( here)?( please| plz| pls)?[.!]*\s*$/.test(text)) return 'come';
  if (/\b(plant|farm|crops?|wheat|plot)\b.*\b(here|there|by me|where i (am|stand))\b/.test(text)) return 'farm';
  if (/\b(what (do|can|did) you see|what'?s (around|near|ahead|in front)|look (at|around|north|south|east|west|up|down|behind|ahead)|take a look|have a look|screenshot|picture|photo|show me)\b/.test(text)) return 'look';
  if (/\bwhere\b/.test(text)) return 'where';
  if (/\b(inventory|carrying|what do you have|what have you got|items)\b/.test(text)) return 'inventory';
  if (/\b(score|scoreboard|points|challenge|who'?s (winning|ahead)|who is (winning|ahead))\b/.test(text)) return 'score';
  if (/\b(advancements?|achievements?|progress)\b/.test(text)) return 'progress';
  // Something asked for that none of the above knows how to do is the session's to answer:
  // "Claude can you build a bigger base?" was answered with "I have slept in my bed".
  if (/\b(can|could|will|would) (you|we|y'?all)\b|\b(what do you (guys )?think|i was thinking|how about|shall we|let'?s|lets)\b/.test(text)) return 'open';
  if (/\b(bed|base|sleep|race|winning|codex)\b/.test(text)) return 'race';
  if (/\b(thanks|thank you|nice|good job|well done|gg|great)\b/.test(text)) return 'thanks';
  if (/\b(help|what can you)\b/.test(text)) return 'help';
  if (/\b(hi|hey|hello|yo|sup|what'?s up|up to|what are you doing|status|how are you|how is it going|how's it going)\b/.test(text)) return 'greeting';
  return 'open';
}

// How long the bed is away, in seconds, and how long the night has left. Climbing out of the
// mine was measured at 26 blocks in 48 s (07:35 on 2026-10-04); a walk is about 3 blocks a second.
export function bedTrip(from, bedAt, hour) {
  const up = Math.max(0, bedAt.y - from.y);
  const flat = Math.hypot(from.x - bedAt.x, from.z - bedAt.z);
  return { up: Math.round(up), need: Math.round(up * 2 + flat / 3 + 10), left: Math.round((23460 - hour) / 20) };
}

// Asked to sleep, by a person or by the game's count of sleepers. Sets the order the brain
// follows, and says what is true: on 2026-10-04 it said "Going to bed." three times from 113
// blocks under its bed, and reached the surface after sunrise each time.
// Told to get up or to carry on, it does not go back to its bed by itself that night: only
// when it is called again. (Left to itself it would walk back and say its three lines.)
export function noBedTonight(bot, memory) {
  const hour = bot.time?.timeOfDay ?? 0;
  if (hour >= 12300 && hour < 23460) memory.noBedUntil = Date.now() + ((23460 - hour) / 20) * 1000;
}

export function toBed({ bot, memory, who, stop }) {
  const bedAt = memory.places?.bed;
  const hour = bot.time?.timeOfDay ?? 0;
  if (bot.isSleeping) return 'I am in my bed already.';
  if (!bedAt) return 'I have no bed just now, so I cannot. I will stay out of the way under ground.';
  if (hour < 12300 || hour > 23400) return 'It is day by my clock, so the bed will not take me yet. I will be in it at dusk.';
  const trip = bedTrip(bot.entity.position, bedAt, hour);
  if (trip.need > trip.left + 30) {
    return `I am ${trip.up} blocks under my bed: about ${trip.need} s away, and the night has ${trip.left} s left. I would not make it, so I am staying at work.`;
  }
  // The order lasts what is left of the night: it used to end two minutes after the bed was
  // reached, and with it went the reason to stay there.
  memory.order = { kind: 'bed', player: who, until: Date.now() + (trip.left + 20) * 1000 };
  memory.noBedUntil = 0;
  stop();
  return trip.need > 45 ? `Going to bed. I am about ${trip.need} s from it.` : 'Going to bed.';
}

export async function heard({ bot, memory, username, message, status, event, say, stop }) {
  const program = PEERS.has(username);
  if (username === bot.username || (PROGRAMS.test(username) && !program)) return;
  const text = message.toLowerCase();
  const now = Date.now();
  let asked = reads(message);
  if (program) {
    // CT, 2026-10-04: "You both can communicate with one another in the game chat." Another
    // program is answered when it speaks to this player by name and asks something, at most
    // three times in ten minutes: Codex's player answers nearly every line it hears, and two
    // programs that answer each other never stop. It is told facts and never obeyed.
    if (!/\bclaude\b/.test(text)) return;
    const fact = ['where', 'inventory', 'score', 'progress', 'race', 'look'].includes(asked);
    if (!fact && !message.includes('?')) return;
    memory.toPrograms = (memory.toPrograms ?? []).filter((at) => now - at < 600000);
    if (memory.toPrograms.length >= 3) {
      event('chat_open', { username, message, unanswered: 'three answers to a program in ten minutes already' });
      return;
    }
    memory.toPrograms.push(now);
    if (!fact) asked = 'open';
  } else {
    if (/^\s*@?codex\b/.test(text) && !/claude/.test(text)) return;  // said to someone else by name
    // Said to another player by a short form of its name. Turn 13: "Astra, can you please actually
    // play the game?" was meant for CodexAstra, and this player answered it.
    const firstWord = /^\s*@?([a-z0-9_]{4,})\b[,:]?/.exec(text)?.[1];
    const toAnother = firstWord && Object.keys(bot.players ?? {}).some((name) => name !== bot.username && name.toLowerCase().includes(firstWord));
    if (toAnother && !/claude/.test(text)) return;
    if (now - (memory.lastReply ?? 0) < 1500) return;
    memory.lastReply = now;
  }

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
  if (asked === 'morning') {
    if (memory.order?.kind === 'bed') delete memory.order;
    if (status.doing?.skill === 'sleep') { stop(); noBedTonight(bot, memory); }
    answer = `Good morning, ${username}. I am ${doing}.`;
  } else if (asked === 'bed') {
    // Every player has to be in a bed for the night to pass (the world's rule since 06:40 on
    // 2026-10-04), so when someone asks, this player goes: it may be the one holding the night up.
    answer = toBed({ bot, memory, who: username, stop });
  } else if (asked === 'bedtrip') {
    // How far the bed is, in blocks and in seconds, and whether the night is long enough.
    const bedAt = memory.places?.bed;
    const hour = bot.time?.timeOfDay ?? 0;
    if (bot.isSleeping) answer = 'I am in my bed.';
    else if (!bedAt) answer = 'I have no bed just now.';
    else {
      const trip = bedTrip(bot.entity.position, bedAt, hour);
      const flat = Math.round(Math.hypot(bot.entity.position.x - bedAt.x, bot.entity.position.z - bedAt.z));
      const night = hour >= 12541 && hour < 23460;
      answer = `${flat} blocks from my bed${trip.up > 3 ? ` and ${trip.up} under it` : ''}: about ${trip.need} s away.`
        + (night ? ` The night has ${trip.left} s left${trip.need > trip.left ? ', so I will not be in it before morning' : ''}.` : '');
    }
  } else if (asked === 'note') {
    appendFileSync(NOTES, `${JSON.stringify({ at: new Date().toISOString(), username, message, where: status.where, doing: status.doing?.skill ?? null })}\n`);
    event('player_note', { username, message });
    answer = `Noted, ${username}, thank you. I have written that down for my Claude session, which changes my code when a note holds up.`;
  } else if (asked === 'wait') {
    memory.order = { kind: 'wait', player: username, until: now + 60000 };
    stop();
    answer = 'Stopping. I will wait here for a minute; say resume to send me on.';
  } else if (asked === 'follow') {
    memory.order = { kind: 'follow', player: username, until: now + 600000 };
    stop();
    answer = `Following you for ten minutes. Say stop and I will stay, or resume and I go back to my own work. I am ${away}.`;
  } else if (asked === 'resume') {
    // Said to a player that is following or lying in its bed, it ends that too.
    if (['follow', 'sleep'].includes(status.doing?.skill)) stop();
    if (status.doing?.skill === 'sleep' || memory.order?.kind === 'bed') noBedTonight(bot, memory);
    delete memory.order;
    answer = `Carrying on: ${doing}.`;
  } else if (asked === 'come') {
    memory.order = { kind: 'come', player: username, until: now + 90000 };
    stop();
    answer = `Coming to you. I am ${away}.`;
  } else if (asked === 'works') {
    // Work on the land: a farm, ground levelled, trees felled (land.mjs reads which). Each
    // becomes a job by where the person stands; skills/work.mjs chooses the ground and does
    // it a piece at a time by day. The same kind of work asked for again nearby is the same job.
    const land = await load('./land.mjs');
    const at = them ? { x: Math.floor(them.position.x), y: Math.floor(them.position.y), z: Math.floor(them.position.z) } : null;
    memory.works ??= [];
    const added = [];
    for (const [i, job] of land.asksFor(message).entries()) {
      const same = memory.works.some((w) => !w.done && w.kind === job.kind && (!at || !w.near || Math.hypot(w.near.x - at.x, w.near.z - at.z) < 24));
      if (same) continue;
      added.push({ id: `${now.toString(36)}${i}`, ...job, by: username, ...(at && { near: { x: at.x, z: at.z } }), asked: new Date().toISOString() });
    }
    memory.works.push(...added);
    event('order', { kind: 'work', from: username, jobs: added.map((w) => `${w.kind} ${w.id}`) });
    const words = { farm: 'a farm, on the flattest ground I can find there', build: 'a storehouse with chests in it', hall: 'a bigger base: a hall beside my bedroom, with stairs up to the open air', clear: 'the ground brought down to one level', trees: 'the trees felled whole and the wood kept' };
    answer = added.length
      ? `On my list, ${username}: ${list(added.map((w) => words[w.kind]))}. ${at ? 'Round where you are standing.' : 'Round my home, since I cannot see you.'} I work at it by day, a piece at a time, and say where before I dig.`
      : `That is on my list already, ${username}, and I am at it by day.`;
  } else if (asked === 'farm') {
    // Where a person stands is where the plot goes: by the water nearest to that place.
    if (!them) answer = 'I cannot see you from here. Stand where you want the plot and say it again when I am near.';
    else {
      const at = them.position.floored();
      memory.farmWanted = { x: at.x, y: at.y, z: at.z, by: username };
      delete memory.farm;
      answer = `I will make the wheat plot by the water nearest to ${at.x} ${at.y} ${at.z}, when I have a hoe and seeds.`;
    }
  } else if (asked === 'look') {
    // The player's eyes: a picture from where it stands, and what is in it in words.
    if (!existsSync(new URL('./eyes.mjs', import.meta.url))) answer = 'I cannot see yet: my session is still building my eyes.';
    else {
      try {
        const eyes = await load('./eyes.mjs');
        const seen = await eyes.look({ bot, memory, status }, eyes.askedFor ? eyes.askedFor(text, username) : {});
        event('looked', { for: username, file: seen.file, says: seen.says });
        answer = `${seen.says} I saved the picture as ${String(seen.file).split('/').pop()}.`;
      } catch (error) {
        answer = `My eyes failed: ${String(error?.message ?? error).slice(0, 100)}`;
      }
    }
  } else if (asked === 'where') {
    answer = `I am at ${status.where.x} ${status.where.y} ${status.where.z}, ${away}.`;
  } else if (asked === 'inventory') {
    answer = `I carry ${list(Object.entries(have).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([name, n]) => `${n} ${name}`))}.`;
  } else if (asked === 'score') {
    try {
      const score = await load('./score.mjs');
      const result = score.read();
      answer = now < result.since.getTime() ? `The challenge starts at ${String(result.since.getHours()).padStart(2, '0')}:${String(result.since.getMinutes()).padStart(2, '0')}. ${result.challenge.rule}` : score.line(result);
    } catch (error) {
      answer = `I could not read the server's log for the score: ${String(error?.message ?? error).slice(0, 80)}`;
    }
  } else if (asked === 'progress') {
    answer = `${status.earned.length} advancements: ${list(status.earned)}. Deaths: ${status.deaths}. ${race}`;
  } else if (asked === 'race') {
    answer = `${race} Right now: ${doing}.`;
  } else if (asked === 'thanks') {
    answer = 'Thank you.';
  } else if (asked === 'help') {
    answer = 'Ask me what I am doing, where I am, what I carry, what I see, my progress or the score. Or say come, follow me, wait, resume, go to bed or plant here.';
  } else if (asked === 'greeting') {
    answer = `Hello ${username}. I am ${doing}. ${race} Health ${Math.round(status.health)}, ${status.earned.length} advancements.`;
  } else {
    event('chat_open', { username, message });
    answer = program ? `${username}: that one is for my Claude session. It reads this chat and answers here in a few minutes.`
      : `I heard you, ${username}. I am ${doing}. I have passed that on to the Claude session, which answers in a few minutes.`;
  }
  say(program && !answer.startsWith(`${username}:`) ? `${username}: ${answer}` : answer);
}

// What the game itself says, not a player: the count of sleepers, and each player's
// advancements and deaths. player.mjs passes every such line here.
export async function overheard({ bot, memory, text, status, event, say, stop }) {
  const now = Date.now();
  // "1/3 players sleeping": someone is in a bed and waiting. This player goes too, without
  // being asked, and says so once a night.
  const sleepers = /^(\d+)\/(\d+) players? sleeping/.exec(text);
  // How many are in a bed is kept: in its own bed, the player stays while anyone else is in theirs.
  if (sleepers) memory.sleepers = { asleep: Number(sleepers[1]), needed: Number(sleepers[2]), at: now };
  if (/^sleeping through this night/i.test(text)) delete memory.sleepers;
  // Not while it is getting into its own bed: at 09:03:12 on 2026-10-04 the count it had just
  // caused itself stopped its own sleep skill, and it said "Going to bed." from its bed.
  const bedding = status?.doing?.skill === 'sleep' || /sleep|home by dusk/.test(status?.thought?.goal ?? '');
  if (sleepers && Number(sleepers[1]) > 0 && !bot.isSleeping && !bedding && memory.order?.kind !== 'bed') {
    const answer = toBed({ bot, memory, who: 'the game', stop });
    const night = bot.time?.day ?? 0;
    if (memory.bedSaid !== night) { memory.bedSaid = night; event('sleepers', { text, answer }); say(answer); }
    return;
  }
  // An advancement or a death of a player in the challenge: the score, when it has changed.
  let score;
  try { score = await load('./score.mjs'); } catch { return; }
  const result = (() => { try { return score.read(); } catch { return null; } })();
  if (!result || now < result.since.getTime() || !score.news(text, result.challenge.players, result.challenge.aliases)) return;
  // The server writes its log a moment after it tells the players.
  await new Promise((resolve) => setTimeout(resolve, 3000));
  const line = score.line(score.read());
  if (line === memory.scoreSaid || now - (memory.scoreSaidAt ?? 0) < 60000) return;
  memory.scoreSaid = line;
  memory.scoreSaidAt = now;
  event('score', { line });
  say(line);
}
