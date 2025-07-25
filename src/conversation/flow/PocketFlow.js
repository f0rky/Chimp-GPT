class Node {
  constructor(id, action) {
    this.id = id;
    this.action = action;
    this.connections = [];
  }

  connect(node, condition = () => true) {
    this.connections.push({ node, condition });
    return this;
  }

  async execute(store, data) {
    const result = await this.action(store, data);
    let finalResult = result;

    for (const connection of this.connections) {
      if (connection.condition(result, store)) {
        const connectedResult = await connection.node.execute(store, result);
        // Use the result from the connected node as the final result
        if (connectedResult) {
          finalResult = connectedResult;
        }
      }
    }

    return finalResult;
  }
}

class SharedStore {
  constructor() {
    this.data = new Map();
  }

  set(key, value) {
    this.data.set(key, value);
    return this;
  }

  get(key) {
    return this.data.get(key);
  }

  has(key) {
    return this.data.has(key);
  }

  delete(key) {
    return this.data.delete(key);
  }

  clear() {
    this.data.clear();
    return this;
  }

  getAll() {
    return Object.fromEntries(this.data);
  }
}

class Flow {
  constructor(startNode, store = new SharedStore()) {
    this.startNode = startNode;
    this.store = store;
  }

  async run(initialData = {}) {
    return await this.startNode.execute(this.store, initialData);
  }

  getStore() {
    return this.store;
  }
}

module.exports = { Node, SharedStore, Flow };
