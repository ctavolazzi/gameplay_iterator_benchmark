// Throw away what is not worth a place in the pack, when the pack is full. No args.
// Turn 13: with all 36 places taken by stone of six kinds, a chest it had just made fell on
// the floor ("crafted chest but carry no more of it") and a log it had just dug stayed where
// it dropped. All of some kinds goes; of the building stones, everything over one stack.
const ALL = /^(leaf_litter|gravel|granite|andesite|diorite|tuff|feather|pumpkin_seeds|rotten_flesh|egg|oak_sapling|birch_sapling|flint|dirt|white_banner)$/;
const OVER_A_STACK = /^(cobblestone|cobbled_deepslate)$/;

export default async function dropJunk({ bot, api }) {
  const before = bot.inventory.emptySlotCount();
  const dropped = {};
  const kept = {};
  for (const item of bot.inventory.items()) {
    api.check();
    let count = 0;
    if (ALL.test(item.name)) count = item.count;
    else if (OVER_A_STACK.test(item.name)) {
      const keep = Math.max(0, Math.min(item.count, 64 - (kept[item.name] ?? 0)));
      kept[item.name] = (kept[item.name] ?? 0) + keep;
      count = item.count - keep;
    }
    if (count <= 0) continue;
    await api.within(bot.toss(item.type, null, count), 4000, `dropping ${item.name}`).catch(() => {});
    dropped[item.name] = (dropped[item.name] ?? 0) + count;
    await api.sleep(150);
  }
  const free = bot.inventory.emptySlotCount();
  const list = Object.entries(dropped).map(([name, n]) => `${n} ${name}`).join(', ');
  return { ok: free > before, note: list ? `dropped ${list}; ${free} places free`.slice(0, 280) : `nothing to drop; ${free} places free` };
}
