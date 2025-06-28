module.exports = {
  apps: [
    {
      name: 'chimpGPT',
      script: './src/core/combined.js',
      watch: false,
      node_args: '--no-deprecation', // Suppress deprecation warnings including util.isArray
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
      error_file: './assets/logs/chimpGPT-error.log',
      out_file: './assets/logs/chimpGPT-out.log',
      merge_logs: true,
      restart_delay: 5000,
    },
  ],
};
