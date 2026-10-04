// Where the nearest blocks of a kind are, without going there. args: { block: 'lily_of_the_valley', within: 64 }
export default async function lookFor({ bot }, { block, within = 64 }) {
  const from = bot.entity.position;
  const found = bot.findBlocks({ matching: (b) => b.name === block, maxDistance: within, count: 6 })
    .sort((a, b) => a.distanceTo(from) - b.distanceTo(from));
  return found.length
    ? { ok: true, note: `${found.length} ${block}: ${found.slice(0, 4).map((at) => `${at.x} ${at.y} ${at.z} (${Math.round(at.distanceTo(from))} away)`).join('; ')}` }
    : { ok: false, note: `no ${block} within ${within} blocks` };
}
