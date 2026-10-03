// Version 1: nothing clever. Each skill is one of the game's own actions, offered as is.
// This is the baseline the coach improves on.
function passThrough(kind, about) {
  return {
    about,
    options(observation, primitives) {
      return primitives
        .filter((p) => p.name.startsWith(kind + ':'))
        .map((p) => ({ arg: p.name.slice(kind.length + 1), about: p.about }));
    },
    async run(api, arg) {
      return api.act(kind + ':' + arg);
    },
  };
}

skills = {
  collect: passThrough('collect', 'walk to a block and dig one'),
  craft: passThrough('craft', 'make an item from what you carry'),
  place: passThrough('place', 'put a carried block on the ground'),
  explore: passThrough('explore', 'walk about 24 blocks in a direction'),
};
