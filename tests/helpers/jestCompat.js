'use strict';

process.env.OWNER_ID = process.env.OWNER_ID || 'owner123';

const assert = require('assert');
const { isDeepStrictEqual } = require('util');

function createMockFunction(implementation) {
  const onceQueue = [];

  const mockFn = function mockFunction(...args) {
    mockFn.mock.calls.push(args);

    if (onceQueue.length > 0) {
      return onceQueue.shift().apply(this, args);
    }

    if (mockFn._implementation) {
      return mockFn._implementation.apply(this, args);
    }

    return undefined;
  };

  mockFn.mock = { calls: [] };
  mockFn._implementation = implementation;

  mockFn.mockImplementation = fn => {
    mockFn._implementation = fn;
    return mockFn;
  };

  mockFn.mockReturnValue = value => mockFn.mockImplementation(() => value);
  mockFn.mockResolvedValue = value => mockFn.mockImplementation(() => Promise.resolve(value));
  mockFn.mockRejectedValue = error => mockFn.mockImplementation(() => Promise.reject(error));
  mockFn.mockReturnValueOnce = value => {
    onceQueue.push(() => value);
    return mockFn;
  };
  mockFn.mockResolvedValueOnce = value => {
    onceQueue.push(() => Promise.resolve(value));
    return mockFn;
  };
  mockFn.mockRejectedValueOnce = error => {
    onceQueue.push(() => Promise.reject(error));
    return mockFn;
  };
  mockFn.mockClear = () => {
    mockFn.mock.calls = [];
    return mockFn;
  };

  return mockFn;
}

function expectSync(actual) {
  return {
    toBe(expected) {
      assert.strictEqual(actual, expected);
    },
    toEqual(expected) {
      assert.deepStrictEqual(actual, expected);
    },
    toContain(expected) {
      assert.ok(actual && actual.includes(expected), `Expected ${actual} to contain ${expected}`);
    },
    toBeGreaterThan(expected) {
      assert.ok(actual > expected, `Expected ${actual} to be greater than ${expected}`);
    },
    toBeGreaterThanOrEqual(expected) {
      assert.ok(actual >= expected, `Expected ${actual} to be >= ${expected}`);
    },
    toBeLessThan(expected) {
      assert.ok(actual < expected, `Expected ${actual} to be less than ${expected}`);
    },
    toBeLessThanOrEqual(expected) {
      assert.ok(actual <= expected, `Expected ${actual} to be <= ${expected}`);
    },
    toBeDefined() {
      assert.notStrictEqual(actual, undefined);
    },
    toBeNull() {
      assert.strictEqual(actual, null);
    },
    toBeInstanceOf(expectedClass) {
      assert.ok(
        actual instanceof expectedClass,
        `Expected value to be instance of ${expectedClass.name}`
      );
    },
    toHaveProperty(property) {
      assert.ok(
        Object.prototype.hasOwnProperty.call(actual, property),
        `Expected property ${property}`
      );
    },
    toHaveBeenCalled() {
      assert.ok(actual && actual.mock, 'Expected a mock function');
      assert.ok(actual.mock.calls.length > 0, 'Expected mock function to have been called');
    },
    toHaveBeenCalledWith(...expectedArgs) {
      assert.ok(actual && actual.mock, 'Expected a mock function');
      assert.ok(
        actual.mock.calls.some(call => isDeepStrictEqual(call, expectedArgs)),
        `Expected mock function to have been called with ${JSON.stringify(expectedArgs)}`
      );
    },
  };
}

function expectCompat(actual) {
  const matchers = expectSync(actual);

  if (actual && typeof actual.then === 'function') {
    matchers.rejects = {
      async toThrow(expectedMessage) {
        try {
          await actual;
        } catch (error) {
          if (expectedMessage) {
            assert.ok(
              error.message.includes(expectedMessage),
              `Expected rejection message "${error.message}" to include "${expectedMessage}"`
            );
          }
          return;
        }
        throw new assert.AssertionError({ message: 'Expected promise to reject' });
      },
    };
  }

  return matchers;
}

function installJestCompat() {
  global.jest = global.jest || {
    fn: createMockFunction,
    clearAllMocks() {},
  };

  global.expect = global.expect || expectCompat;

  if (typeof global.test === 'undefined' && typeof global.it === 'function') {
    global.test = global.it;
  }
}

installJestCompat();

module.exports = { createMockFunction, expectCompat, installJestCompat };
