// Whether the player's body answers: hold forward for a second and a half and see if it moved.
export default async function bodyCheck({ bot, api }) {
  const before = bot.entity.position.clone();
  const facts = `alive ${bot.isAlive}, asleep ${bot.isSleeping}, physics ${bot.physicsEnabled}, mode ${bot.game?.gameMode}, health ${bot.health}, on ground ${bot.entity.onGround}, velocity ${bot.entity.velocity.x.toFixed(2)} ${bot.entity.velocity.y.toFixed(2)} ${bot.entity.velocity.z.toFixed(2)}`;
  await bot.look(-Math.PI / 2, 0, true);   // face east, where the map showed open ground
  bot.setControlState('forward', true);
  bot.setControlState('jump', true);
  await api.sleep(1500);
  bot.clearControlStates();
  await api.sleep(300);
  const moved = bot.entity.position.distanceTo(before);
  return { ok: moved > 0.5, note: `${facts}; moved ${moved.toFixed(2)} blocks in 1.5 s of walking east, now at ${bot.entity.position.x.toFixed(1)} ${bot.entity.position.y.toFixed(1)} ${bot.entity.position.z.toFixed(1)}` };
}
