// What the player says back when someone speaks in the game's chat. It answers every
// message from a person, whether or not it is named, from what it is doing right now.
// No model is asked: the answers are built from the player's own state. Anything it cannot
// answer is journalled as open, for the Claude session to answer on its next turn.
// player.mjs loads this file again whenever it changes.

const OTHER_PLAYERS_THAT_ARE_PROGRAMS = /codex|bot$/i;
const list = (things) => things.join(', ') || 'nothing';

export async function heard({ bot, memory, username, message, status, event, say, stop }) {
  if (OTHER_PLAYERS_THAT_ARE_PROGRAMS.test(username)) return;      // two programs answering each other never stop
  const text = message.toLowerCase();
  if (/^\s*@?codex\b/.test(text) && !/claude/.test(text)) return;  // said to someone else by name
  const now = Date.now();
  if (now - (memory.lastReply ?? 0) < 1500) return;
  memory.lastReply = now;

  const doing = status.doing
    ? `${status.doing.skill}${status.doing.args?.block ? ` ${status.doing.args.block}` : status.doing.args?.item ? ` ${status.doing.args.item}` : status.doing.args?.animal ? ` ${status.doing.args.animal}` : ''} for ${status.doing.goal ?? 'a request'}`
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
  if (/\b(stop|wait|stay|hold on|freeze)\b/.test(text)) {
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
