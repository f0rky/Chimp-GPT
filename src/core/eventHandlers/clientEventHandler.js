const path = require('path');
const { discord: discordLogger } = require('../logger');
const { initHealthCheck } = require('../healthCheck');
const { initStatusManager } = require('../../web/statusManager');
const MessageEventHandler = require('./messageEventHandler');
const InteractionEventHandler = require('./interactionEventHandler');
const maliciousUserManager = require('../../utils/maliciousUserManager');
const { loadConversationsFromStorage } = require('../../conversation/conversationManagerSelector');
const { initDebugSkip } = require('../../utils/debugSkipManager');
const PFPManager = require('../../utils/pfpManager');
const commandHandler = require('../../commands/commandHandler');
const { shouldDeploy, recordSuccessfulDeployment } = require('../../utils/deploymentManager');
const { sendChannelGreeting } = require('../../utils/greetingManager');
const { stats: healthCheckStats } = require('../healthCheck');
const statsStorage = require('../statsStorage');

class ClientEventHandler {
  constructor(client, config, dependencies) {
    this.client = client;
    this.config = config;
    this.openai = dependencies.openai;
    this.allowedChannelIDs = dependencies.allowedChannelIDs;
    this.loadingEmoji = dependencies.loadingEmoji;
    this.DISABLE_PLUGINS = dependencies.DISABLE_PLUGINS;
    this.inProgressOperations = dependencies.inProgressOperations;
    this.messageRelationships = dependencies.messageRelationships;
    this.handleFunctionCall = dependencies.handleFunctionCall;
    this.handleDirectMessage = dependencies.handleDirectMessage;
    this.formatSubtext = dependencies.formatSubtext;
    this.storeMessageRelationship = dependencies.storeMessageRelationship;
    this.statusManager = dependencies.statusManager;

    this.setupEventHandlers();
  }

  setupEventHandlers() {
    this.client.on('ready', this.handleReady.bind(this));
    this.client.on('reconnecting', this.updateDiscordStats.bind(this));
    this.client.on('disconnect', this.updateDiscordStats.bind(this));
    this.client.on('shardResume', this.updateDiscordStats.bind(this));
    this.client.on('shardDisconnect', this.updateDiscordStats.bind(this));
  }

  async updateDiscordStats() {
    try {
      const guilds = this.client.guilds.cache.size;
      const users = this.client.guilds.cache.reduce((acc, guild) => acc + guild.memberCount, 0);
      const channels = this.client.channels.cache.size;

      // Get Discord connection status and ping
      const isReady = this.client.isReady();
      const hasGuilds = guilds > 0;
      const hasWebSocket = this.client.ws && this.client.ws.status === 0; // WebSocketManager.READY = 0

      // More intelligent status detection - if we have guilds, we're likely connected
      // even if isReady() returns false due to timing issues
      const status = isReady || hasGuilds ? 'ok' : 'offline';
      const ping = this.client.ws ? this.client.ws.ping : 0;

      // Update the health check stats with complete Discord information
      healthCheckStats.discord = {
        guilds,
        users,
        channels,
        status,
        ping,
      };

      // Persist Discord status to statsStorage for health endpoint
      try {
        await statsStorage.updateStat('discord', {
          status,
          ping,
          guilds,
          channels,
        });
      } catch (persistError) {
        discordLogger.warn({ error: persistError }, 'Failed to persist Discord status to storage');
      }

      discordLogger.debug(
        {
          guilds,
          users,
          channels,
          status,
          ping,
          isReady,
          hasGuilds,
          hasWebSocket,
          wsStatus: this.client.ws ? this.client.ws.status : 'no-ws',
        },
        'Updated Discord stats'
      );
    } catch (err) {
      discordLogger.error({ err }, 'Failed to update Discord stats');

      // Set offline status on error
      healthCheckStats.discord = {
        guilds: 0,
        users: 0,
        channels: 0,
        status: 'offline',
        ping: 0,
      };

      // Persist offline status to statsStorage
      try {
        await statsStorage.updateStat('discord', {
          status: 'offline',
          ping: 0,
          guilds: 0,
          channels: 0,
        });
      } catch (persistError) {
        discordLogger.warn(
          { error: persistError },
          'Failed to persist offline Discord status to storage'
        );
      }
    }
  }

  async handleReady() {
    discordLogger.info(`Logged in as ${this.client.user.tag}`);

    // Initialize health check and status manager

    // Initialize health check system
    initHealthCheck(this.client);
    discordLogger.info('Initializing performance monitoring');
    const { initPerformanceMonitoring } = require('../utils/healthCheckIntegration');
    initPerformanceMonitoring();
    discordLogger.info('Health check system initialized');

    // Immediately update Discord stats on startup
    this.updateDiscordStats();
    // Periodically update Discord stats every 30 seconds
    setInterval(this.updateDiscordStats.bind(this), 30000);

    // Initialize status manager
    this.statusManager.instance = initStatusManager(this.client);
    discordLogger.info('Status manager initialized');

    // Initialize PFP Manager FIRST to ensure it's available for other components
    const pfpManager = new PFPManager(this.client, {
      pfpDir: path.join(__dirname, '../../../pfp'),
      maxImages: 50,
      rotateIntervalMs: 30 * 60 * 1000, // 30 minutes
    });

    // Initialize message event handler with PFPManager
    const _messageEventHandler = new MessageEventHandler(this.client, this.config, {
      openai: this.openai,
      statusManager: this.statusManager.instance,
      allowedChannelIDs: this.allowedChannelIDs,
      loadingEmoji: this.loadingEmoji,
      DISABLE_PLUGINS: this.DISABLE_PLUGINS,
      inProgressOperations: this.inProgressOperations,
      messageRelationships: this.messageRelationships,
      handleFunctionCall: this.handleFunctionCall,
      handleDirectMessage: this.handleDirectMessage,
      formatSubtext: this.formatSubtext,
      storeMessageRelationship: this.storeMessageRelationship,
      pfpManager: pfpManager,
    });
    discordLogger.info('Message event handler initialized');

    // Initialize interaction event handler
    const _interactionEventHandler = new InteractionEventHandler(this.client, this.config);
    discordLogger.info('Interaction event handler initialized');

    // Initialize malicious user manager
    try {
      await maliciousUserManager.init();
      discordLogger.info('Malicious user manager initialized');
    } catch (error) {
      discordLogger.error({ error }, 'Error initializing malicious user manager');
    }

    // Load conversations from persistent storage
    try {
      await loadConversationsFromStorage();
      discordLogger.info('Conversations loaded from persistent storage using optimized storage');

      // Note: Periodic saving is handled internally by the optimizer
      discordLogger.info(
        'Conversation optimization active - periodic saving handled automatically'
      );
    } catch (error) {
      discordLogger.error({ error }, 'Error loading conversations from persistent storage');
    }

    try {
      await pfpManager.startRotation();
      discordLogger.info('PFP Manager initialized and rotation started');
    } catch (error) {
      discordLogger.error({ error }, 'Error initializing PFP Manager');
    }

    // Register command prefixes for traditional commands
    try {
      commandHandler.setPrefixes(['!', '?', '/']);
      discordLogger.info('Command prefixes registered');
    } catch (error) {
      discordLogger.error({ error }, 'Error registering command prefixes');
    }

    // Deploy slash commands if needed
    try {
      if (await shouldDeploy(this.config)) {
        discordLogger.info('Deploying slash commands...');
        await commandHandler.deployCommands(this.client, this.config);
        await recordSuccessfulDeployment();
        discordLogger.info('Slash commands deployed successfully');
      } else {
        discordLogger.info('Slash command deployment skipped (recently deployed)');
      }
    } catch (error) {
      discordLogger.error({ error }, 'Error deploying slash commands');
    }

    // Send startup greetings to configured channels
    try {
      await sendChannelGreeting(this.client, this.config.CHANNEL_ID);
      // The healthCheck system will use the greetingManager to get system information
      discordLogger.info('Channel greetings sent successfully');
    } catch (error) {
      discordLogger.error({ error }, 'Error sending startup greetings');
    }

    // Initialize debug skip functionality
    try {
      initDebugSkip(this.client, this.config);
      discordLogger.info('Debug skip functionality initialized');
    } catch (error) {
      discordLogger.error({ error }, 'Error initializing debug skip functionality');
    }
  }
}

module.exports = ClientEventHandler;
