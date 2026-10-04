// What might be holding the player's body still: effects, attributes, vehicle, the blocks it is in.
export default async function bodyFacts({ bot }) {
  const e = bot.entity;
  const effects = Object.values(e.effects ?? {}).map((x) => `${bot.registry.effects?.[x.id]?.name ?? x.id} x${x.amplifier + 1}`).join(', ') || 'none';
  const attributes = Object.entries(e.attributes ?? {}).filter(([name]) => /speed|gravity|jump|step/.test(name))
    .map(([name, a]) => `${name.replace('minecraft:', '')}=${a.value}${a.modifiers?.length ? ` (+${a.modifiers.length} modifiers: ${a.modifiers.map((m) => `${m.operation}:${m.amount}`).join(',')})` : ''}`).join('; ');
  return { ok: true, note: `effects: ${effects} | attributes: ${attributes || 'none seen'} | vehicle: ${bot.vehicle ? bot.vehicle.name : 'none'} | in water ${e.isInWater}, in web ${e.isInWeb}, collided ${e.isCollidedHorizontally}/${e.isCollidedVertically} | food ${bot.food}, saturation ${bot.foodSaturation} | elytra ${e.elytraFlying} | height ${e.height}` };
}
