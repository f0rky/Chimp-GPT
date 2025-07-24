// Read BOT_NAME from .env file dynamically
require('dotenv').config();
const botName = process.env.BOT_NAME || 'ChimpGPT';

module.exports = {
  apps: [
    {
      name: `chimpGPT-${botName}`,
      script: './src/core/combined.js',
      watch: false,
      node_args: '--no-deprecation', // Suppress deprecation warnings - lodash issue from Discord.js dependency
      env_file: '.env', // Tell PM2 to load .env file
      env: {
        NODE_ENV: 'development',
        PORT: 3006,
      },
      env_production: {
        NODE_ENV: 'production',
        PORT: 3005,
      },
      max_memory_restart: '1G',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      error_file: `./assets/logs/chimpGPT-${botName}-error.log`,
      out_file: `./assets/logs/chimpGPT-${botName}-out.log`,
      merge_logs: true,
      restart_delay: 5000,
    },
  ],
};
