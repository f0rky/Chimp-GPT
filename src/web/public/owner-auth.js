// Dashboard owner authentication helper
// Holds the owner token in memory (mirrored to sessionStorage for this tab only) and sends it
// as the X-Owner-Token header on protected requests. It never prompts on its own: the token is
// only requested when the user clicks the administration unlock control.
(function () {
  const STORAGE_KEY = 'chimpgpt.ownerToken';
  const LOCKED_MESSAGE = 'Administration locked. Click the lock button to enter the owner token.';
  const listeners = new Set();

  class OwnerAuthError extends Error {
    constructor(code, message, status) {
      super(message);
      this.name = 'OwnerAuthError';
      this.code = code;
      this.status = status;
    }
  }

  function readStoredToken() {
    try {
      return window.sessionStorage.getItem(STORAGE_KEY);
    } catch {
      return null;
    }
  }

  function storeToken(value) {
    try {
      if (value) {
        window.sessionStorage.setItem(STORAGE_KEY, value);
      } else {
        window.sessionStorage.removeItem(STORAGE_KEY);
      }
    } catch {}
  }

  let token = readStoredToken();
  let status = token
    ? { state: 'unlocked', message: 'Administration unlocked' }
    : { state: 'locked', message: LOCKED_MESSAGE };

  function setStatus(state, message) {
    status = { state, message };
    listeners.forEach(listener => {
      try {
        listener({ ...status });
      } catch {}
    });
  }

  function lock(state = 'locked', message = LOCKED_MESSAGE) {
    token = null;
    storeToken(null);
    setStatus(state, message);
  }

  // Must only be called from an explicit user action (the unlock control)
  function unlock() {
    const entered = window.prompt('Enter the dashboard owner token (OWNER_TOKEN):');
    const value = typeof entered === 'string' ? entered.trim() : '';
    if (!value) return false;
    token = value;
    storeToken(value);
    setStatus('unlocked', 'Administration unlocked');
    return true;
  }

  async function ownerFetch(url, options = {}) {
    if (!token) {
      throw new OwnerAuthError('OWNER_LOCKED', LOCKED_MESSAGE);
    }

    const response = await window.fetch(url, {
      ...options,
      headers: { ...options.headers, 'X-Owner-Token': token },
    });

    if (response.status === 401 || response.status === 403) {
      lock('rejected', 'Owner token was rejected. Unlock again with the correct OWNER_TOKEN.');
      throw new OwnerAuthError('OWNER_TOKEN_REJECTED', status.message, response.status);
    }

    if (response.status === 503) {
      let code = null;
      try {
        code = (await response.clone().json()).code;
      } catch {}
      if (code === 'OWNER_AUTH_NOT_CONFIGURED' || code === 'OWNER_ID_NOT_CONFIGURED') {
        const message =
          code === 'OWNER_ID_NOT_CONFIGURED'
            ? 'Server OWNER_ID is not configured. Set it on the server and restart the bot.'
            : 'Server OWNER_TOKEN is not configured (32+ random characters required). Set it and restart the bot.';
        setStatus('unconfigured', message);
        throw new OwnerAuthError(code, message, response.status);
      }
    }

    return response;
  }

  window.OwnerAuth = {
    ownerFetch,
    unlock,
    lock: () => lock(),
    isUnlocked: () => Boolean(token),
    getStatus: () => ({ ...status }),
    onChange: listener => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    OwnerAuthError,
  };
})();
