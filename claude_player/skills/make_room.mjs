// Throw away what a building job does not need, keeping the earth, the wood and the saplings
// that drop_junk.mjs would throw out with the rest. On 2026-10-04 torches and fences were
// crafted into a full pack and never arrived. No args.
const GOES = /^(leaf_litter|gravel|granite|andesite|diorite|tuff|feather|rotten_flesh|egg|flint|pumpkin_seeds)$/;
const OVER_A_STACK = /^(cobblestone|cobbled_deepslate)$/;

export default async function makeRoom({ bot, api }) {
  const before = bot.inventory.emptySlotCount();
  const dropped = {}, kept = {};
  for (const item of bot.inventory.items()) {
    api.check();
    let count = GOES.test(item.name) ? item.count : 0;
    if (OVER_A_STACK.test(item.name)) {
      const keep = Math.max(0, Math.min(item.count, 64 - (kept[item.name] ?? 0)));
      kept[item.name] = (kept[item.name] ?? 0) + keep;
      count = item.count - keep;
    }
    if (count <= 0) continue;
    await api.within(bot.toss(item.type, null, count), 4000, `dropping ${item.name}`).catch(() => {});
    dropped[item.name] = (dropped[item.name] ?? 0) + count;
    await api.sleep(150);
  }
  api.markJunk();
  const after = bot.inventory.emptySlotCount();
  return { ok: after > before || after > 3, note: `dropped ${Object.entries(dropped).map(([name, n]) => `${n} ${name}`).join(', ') || 'nothing'}; ${after} places free (were ${before})` };
}
