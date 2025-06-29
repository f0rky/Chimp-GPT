// windsurf.config.js
// Configuration for Windsurf deployment, linting, and security rules

module.exports = {
  lint: {
    enabled: true,
    tool: 'eslint',
    configFile: '.eslintrc.js',
    failOnError: true,
    include: ['**/*.js'],
    exclude: ['node_modules', 'archive', 'plugins/README.md'],
  },
  prettier: {
    enabled: true,
    configFile: '.prettierrc',
    include: ['**/*.js', '**/*.json', '**/*.md'],
    exclude: ['node_modules', 'archive'],
  },
  security: {
    checkSecrets: true,
    failOnSecret: true,
    exclude: ['.env.example', 'archive'],
  },
  deploy: {
    enabled: false, // Set to true if using Windsurf for deployment
    provider: '', // e.g., 'netlify', 'vercel', or leave blank
    buildCommand: 'npm run build',
    publishDir: 'dist',
    env: ['DISCORD_TOKEN', 'OPENAI_API_KEY', 'X_RAPIDAPI_KEY', 'BOT_PERSONALITY', 'PORT'],
  },
  plugins: {
    validate: true,
    pluginDir: 'src/plugins',
    requireId: true,
    requireVersion: true,
    requireDescription: false,
  },
};
