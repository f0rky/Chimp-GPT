const { Node } = require('../PocketFlow');

class BaseConversationNode extends Node {
  constructor(id, action, options = {}) {
    super(id, action);
    this.options = {
      timeout: 15000,
      retries: 1,
      logLevel: 'info',
      ...options,
    };
  }

  async safeExecute(store, data) {
    const startTime = Date.now();

    try {
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error(`Node ${this.id} timed out`)), this.options.timeout);
      });

      const actionPromise = this.action(store, data);

      const result = await Promise.race([actionPromise, timeoutPromise]);

      this.logExecution(store, data, result, Date.now() - startTime);
      return result;
    } catch (error) {
      this.logError(store, data, error, Date.now() - startTime);

      if (this.options.retries > 0) {
        this.options.retries--;
        return await this.safeExecute(store, data);
      }

      return this.handleError(store, data, error);
    }
  }

  async execute(store, data) {
    const result = await this.safeExecute(store, data);

    for (const connection of this.connections) {
      if (connection.condition(result, store)) {
        await connection.node.execute(store, result);
      }
    }

    return result;
  }

  logExecution(store, data, result, duration) {
    if (this.options.logLevel === 'debug') {
      console.log(`[${this.id}] Executed in ${duration}ms`, {
        input: data,
        output: result,
      });
    }
  }

  logError(store, data, error, duration) {
    console.error(`[${this.id}] Error after ${duration}ms:`, error.message);
  }

  handleError(store, data, error) {
    return {
      success: false,
      error: error.message,
      nodeId: this.id,
      data: data,
    };
  }

  addCondition(condition, targetNode) {
    return this.connect(targetNode, condition);
  }

  onSuccess(targetNode) {
    return this.connect(targetNode, result => result.success !== false);
  }

  onError(targetNode) {
    return this.connect(targetNode, result => result.success === false);
  }

  onCondition(predicate, targetNode) {
    return this.connect(targetNode, (result, store) => predicate(result, store));
  }
}

module.exports = BaseConversationNode;
