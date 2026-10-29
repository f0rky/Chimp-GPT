// Regression tests must not load the host's production credentials or data.
require('dotenv').config = () => ({ parsed: {} });
Object.assign(process.env, {
  NODE_ENV: 'test',
  LOG_LEVEL: 'error',
  DISCORD_TOKEN: 'offline-test-token',
  OPENAI_API_KEY: 'sk-offline-test',
  OPENROUTER_API_KEY: '',
  X_RAPIDAPI_KEY: '',
  CHANNEL_ID: 'test-channel',
  OWNER_ID: '000000000000000001',
  ENABLE_IMAGE_GENERATION: 'false',
});
