module.exports = {
  apps: [
    {
      name: 'chimpGPT',
      script: './combined.js',
      watch: false,
      node_args: '--no-deprecation', // Suppress deprecation warnings including util.isArray
      env: {
        NODE_ENV: 'development',
        // Use development port
        DEV_PORT: 3001,
      },
      env_production: {
        NODE_ENV: 'production',
        // Use production port
        PROD_PORT: 3000,
      },
      max_memory_restart: '1G',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      error_file: './logs/chimpGPT-error.log',
      out_file: './logs/chimpGPT-out.log',
      merge_logs: true,
      restart_delay: 5000,
    },
  ],
};
