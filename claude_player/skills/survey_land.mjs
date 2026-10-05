// The lie of the land in a rectangle, read from the world as the player knows it. Looks only.
// For choosing where to flatten and farm (CT, 2026-10-04: "choose a spot near spawn onto
// which you will build our farm"). Writes every column to data/claude_player/land/ and says
// where. args: { x1, z1, x2, z2 }
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const GROWTH = /_log$|_leaves$|^(short_grass|tall_grass|fern|large_fern|leaf_litter|vine|bee_nest|bush|firefly_bush|dandelion|poppy|azure_bluet|oxeye_daisy|cornflower|allium|lily_of_the_valley|.*_tulip|sugar_cane|pumpkin|melon|snow|dead_bush|wildflowers|pink_petals|mushroom_stem|.*_mushroom(_block)?|moss_carpet|glow_lichen)$/;
const MADE = /^(crafting_table|furnace|chest|barrel|torch|wall_torch|ladder|.*_bed|.*_door|.*_trapdoor|.*_sign|.*_fence|.*_fence_gate|.*_stairs|.*_slab|.*_planks|glass|glass_pane|.*_glass|cobblestone|farmland|wheat|composter|.*_banner|lantern|campfire|.*_wall)$/;

// The survey itself, for other skills (work.mjs chooses a site from it): every column's
// ground and cover, what is made, what is wet.
export function survey(bot, api, { xa, xb, za, zb }, { top = 110, bottom = 50 } = {}) {
  const columns = [], made = [], wet = [];
  let unloaded = 0;
  for (let x = xa; x <= xb; x++) for (let z = za; z <= zb; z++) {
    // ground: the highest block that is earth or rock. cover: the highest block of any kind.
    let ground = null, groundName = null, cover = null, coverName = null;
    for (let y = top; y >= bottom; y--) {
      const block = bot.blockAt(new api.Vec3(x, y, z));
      if (!block) { unloaded += 1; break; }
      if (block.name === 'air' || block.name === 'cave_air') continue;
      if (cover === null) { cover = y; coverName = block.name; }
      if (MADE.test(block.name)) made.push({ x, y, z, name: block.name });
      if (/water|lava/.test(block.name)) { wet.push({ x, y, z, name: block.name }); continue; }
      if (GROWTH.test(block.name) || MADE.test(block.name) || block.boundingBox !== 'block') continue;
      ground = y; groundName = block.name;
      break;
    }
    columns.push({ x, z, ground, groundName, cover, coverName });
  }
  const players = Object.values(bot.players).filter((p) => p.entity).map((p) => ({ name: p.username, ...api.round(p.entity.position) }));
  return { box: { xa, xb, za, zb }, unloaded, players, columns, made, wet };
}

export default async function surveyLand({ bot, api }, { x1, z1, x2, z2, top = 110, bottom = 50 }) {
  if (![x1, z1, x2, z2].every(Number.isInteger)) return { ok: false, note: 'say the corners: x1, z1, x2, z2' };
  const [xa, xb, za, zb] = [Math.min(x1, x2), Math.max(x1, x2), Math.min(z1, z2), Math.max(z1, z2)];
  const { unloaded, players, columns, made, wet } = survey(bot, api, { xa, xb, za, zb }, { top, bottom });
  const dir = fileURLToPath(new URL('../../data/claude_player/land/', import.meta.url));
  mkdirSync(dir, { recursive: true });
  const file = `${dir}${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
  writeFileSync(file, JSON.stringify({ at: new Date().toISOString(), box: { xa, xb, za, zb }, unloaded, players, columns, made, wet }));
  return { ok: true, note: `${columns.length} columns, ${made.length} made things, ${wet.length} wet, ${unloaded} not loaded: ${file}` };
}
