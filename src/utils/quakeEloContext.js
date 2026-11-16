const { AsyncLocalStorage } = require('node:async_hooks');

const DEFAULT_ELO_MODE = 1;
const eloModeStorage = new AsyncLocalStorage();

function getEloMode() {
  return eloModeStorage.getStore() ?? DEFAULT_ELO_MODE;
}

function runWithEloMode(eloMode, callback) {
  return eloModeStorage.run(eloMode ?? DEFAULT_ELO_MODE, callback);
}

module.exports = {
  DEFAULT_ELO_MODE,
  getEloMode,
  runWithEloMode,
};
