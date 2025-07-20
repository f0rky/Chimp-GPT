const { Flow } = require('../PocketFlow');
const ConversationStore = require('../ConversationStore');
const BaseConversationNode = require('../nodes/BaseNode');

class CommandFlow {
  constructor(commandHandler, options = {}) {
    this.store = new ConversationStore();
    this.commandHandler = commandHandler;
    this.options = options;

    this.initializeNodes();
    this.buildFlow();
  }

  initializeNodes() {
    this.commandParserNode = new BaseConversationNode(
      'command_parser',
      async (store, data) => await this.parseCommand(store, data)
    );

    this.commandExecutorNode = new BaseConversationNode(
      'command_executor',
      async (store, data) => await this.executeCommand(store, data)
    );

    this.setupConnections();
  }

  setupConnections() {
    this.commandParserNode
      .onSuccess(this.commandExecutorNode)
      .onError(this.createErrorHandler('command_parsing_failed'));

    this.commandExecutorNode
      .onSuccess(this.createSuccessHandler())
      .onError(this.createErrorHandler('command_execution_failed'));
  }

  buildFlow() {
    this.flow = new Flow(this.commandParserNode, this.store);
  }

  async processCommand(messageData) {
    try {
      const startTime = Date.now();

      const flowData = {
        message: messageData.message,
        context: messageData.context || {},
        flowType: 'command',
        startTime: startTime,
      };

      this.store.setActiveFlow(messageData.message.author?.id, 'command', flowData);

      const result = await this.flow.run(flowData);

      this.store.clearActiveFlow(messageData.message.author?.id);

      return {
        success: true,
        result: result,
        flowType: 'command',
        executionTime: Date.now() - startTime,
      };
    } catch (error) {
      this.store.clearActiveFlow(messageData.message.author?.id);
      throw error;
    }
  }

  async parseCommand(store, data) {
    const { message } = data;
    const content = message.content?.trim();

    if (!content) {
      return {
        success: false,
        error: 'Empty command content',
      };
    }

    const isCommand = /^[!/]/.test(content);
    if (!isCommand) {
      return {
        success: false,
        error: 'Not a valid command format',
      };
    }

    const commandMatch = content.match(/^([!/])(\w+)(?:\s+(.*))?$/);
    if (!commandMatch) {
      return {
        success: false,
        error: 'Invalid command syntax',
      };
    }

    const [, prefix, commandName, args] = commandMatch;

    const parsedCommand = {
      prefix: prefix,
      name: commandName.toLowerCase(),
      args: args ? args.split(/\s+/) : [],
      rawArgs: args || '',
      originalContent: content,
      isSlashCommand: prefix === '/',
      isBangCommand: prefix === '!',
    };

    return {
      success: true,
      command: parsedCommand,
      message: message,
    };
  }

  async executeCommand(store, data) {
    const { command, message } = data;

    if (!command || !command.name) {
      return {
        success: false,
        error: 'No valid command to execute',
      };
    }

    try {
      const commandContext = {
        message: message,
        command: command,
        store: store,
        userId: message.author?.id,
        channelId: message.channel?.id,
        guildId: message.guild?.id,
      };

      if (this.commandHandler && typeof this.commandHandler.executeCommand === 'function') {
        const result = await this.commandHandler.executeCommand(command.name, commandContext);
        return {
          success: true,
          commandName: command.name,
          result: result,
          executionTime: Date.now() - data.startTime,
        };
      }
      return await this.executeBuiltInCommand(command, commandContext);
    } catch (error) {
      return {
        success: false,
        error: error.message,
        commandName: command.name,
      };
    }
  }

  async executeBuiltInCommand(command, context) {
    const builtInCommands = {
      help: () => this.showHelp(),
      ping: () => ({ response: 'Pong! 🏓' }),
      version: () => this.showVersion(),
      stats: () => this.showStats(context.store),
      clear: () => this.clearUserConversation(context.userId, context.store),
      debug: () => this.showDebugInfo(context),
    };

    const commandFunc = builtInCommands[command.name];
    if (commandFunc) {
      const result = await commandFunc();
      return {
        success: true,
        commandName: command.name,
        result: result,
      };
    }
    return {
      success: false,
      error: `Unknown command: ${command.name}`,
      availableCommands: Object.keys(builtInCommands),
    };
  }

  showHelp() {
    return {
      response: `**Available Commands:**
• \`!help\` - Show this help message
• \`!ping\` - Test bot responsiveness
• \`!version\` - Show bot version info
• \`!stats\` - Show conversation statistics
• \`!clear\` - Clear your conversation history
• \`!debug\` - Show debug information

You can also use natural language to interact with me!`,
    };
  }

  showVersion() {
    return {
      response: `**Bot Version Information:**
• Framework: PocketFlow-based conversation system
• Node.js: ${process.version}
• Uptime: ${Math.floor(process.uptime())} seconds
• Memory Usage: ${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)}MB`,
    };
  }

  showStats(store) {
    const conversations = store.get('conversations');
    const channels = store.get('channelContexts');
    const users = store.get('userContexts');

    const totalConversations = conversations ? conversations.size : 0;
    const totalChannels = channels ? channels.size : 0;
    const totalUsers = users ? users.size : 0;

    return {
      response: `**Conversation Statistics:**
• Active Conversations: ${totalConversations}
• Active Channels: ${totalChannels}
• Total Users: ${totalUsers}
• Store Size: ${store.data.size} entries`,
    };
  }

  clearUserConversation(userId, store) {
    if (!userId) {
      return {
        response: 'Error: Could not identify user to clear conversation for.',
      };
    }

    const conversations = store.get('conversations');
    if (conversations && conversations.has(userId)) {
      conversations.delete(userId);
      return {
        response: 'Your conversation history has been cleared! 🧹',
      };
    }
    return {
      response: 'No conversation history found to clear.',
    };
  }

  showDebugInfo(context) {
    const { command, userId, channelId } = context;

    return {
      response: `**Debug Information:**
• Command: ${command.name}
• Args: ${JSON.stringify(command.args)}
• User ID: ${userId || 'Unknown'}
• Channel ID: ${channelId || 'Unknown'}
• Flow Type: Command
• Timestamp: ${new Date().toISOString()}`,
    };
  }

  createSuccessHandler() {
    return {
      id: 'command_success_handler',
      action: async (store, data) => {
        return {
          success: true,
          response: data.result?.response || 'Command executed successfully.',
          commandName: data.commandName,
          executionTime: data.executionTime,
          type: 'command_response',
        };
      },
      connections: [],
    };
  }

  createErrorHandler(errorType) {
    return {
      id: `command_error_handler_${errorType}`,
      action: async (store, data) => {
        const error = data.error || 'Unknown command error occurred';

        const errorResponses = {
          command_parsing_failed:
            "I couldn't understand that command. Use `!help` to see available commands.",
          command_execution_failed: `Command execution failed: ${error}`,
        };

        return {
          success: false,
          error: error,
          errorType: errorType,
          response: errorResponses[errorType] || `Command error: ${error}`,
          timestamp: Date.now(),
          type: 'command_error',
        };
      },
      connections: [],
    };
  }

  isCommand(content) {
    if (!content || typeof content !== 'string') return false;
    return /^[!/]/.test(content.trim());
  }

  getStore() {
    return this.store;
  }

  cleanup() {
    this.store.cleanup();
  }
}

module.exports = CommandFlow;
