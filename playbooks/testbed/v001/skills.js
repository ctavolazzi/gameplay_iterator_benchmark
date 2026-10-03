// Version 1: nothing clever. Each skill is one of the game's own actions, offered as is.
// This is the baseline the coach improves on.
skills = {
  step: {
    about: 'walk one cell',
    options(observation, primitives) {
      return primitives
        .filter((p) => ['north', 'south', 'east', 'west'].includes(p.name))
        .map((p) => ({ arg: p.name, about: p.about }));
    },
    async run(api, arg) {
      return api.act(arg);
    },
  },
  gather: {
    about: 'collect what is on this cell',
    options(observation, primitives) {
      return primitives.filter((p) => p.name === 'gather').map((p) => ({ about: p.about }));
    },
    async run(api) {
      return api.act('gather');
    },
  },
  craft: {
    about: 'craft an item',
    options(observation, primitives) {
      return primitives
        .filter((p) => p.name.startsWith('craft_'))
        .map((p) => ({ arg: p.name.slice(6), about: p.about }));
    },
    async run(api, arg) {
      return api.act(`craft_${arg}`);
    },
  },
};
