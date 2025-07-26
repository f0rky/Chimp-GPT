/**
 * Claude Code Debug Helper
 *
 * This module provides Claude Code with easy integration for the debug skip functionality.
 * It allows Claude to check for and use the debug skip mode during troubleshooting operations.
 *
 * @module ClaudeDebugHelper
 * @author Brett
 * @version 1.0.0
 */

const { shouldSkipLogChecking } = require('./debugSkipManager');
const { createLogger } = require('../core/logger');
const logger = createLogger('claudeDebugHelper');

/**
 * Claude Code integration function for log checking operations
 *
 * This is the main function Claude Code should call before running any log checking
 * commands like "pm2 logs chimpGPT-Solvis --lines 15"
 *
 * @param {string} operation - Description of the operation about to be performed
 * @returns {Object} Skip decision and message
 */
function checkDebugSkip(operation = 'log checking') {
  try {
    const skipInfo = shouldSkipLogChecking();

    if (skipInfo.skip) {
      logger.info(
        {
          operation,
          skipUsed: true,
        },
        'Claude Code: Debug skip used for operation'
      );

      return {
        shouldSkip: true,
        message: skipInfo.message,
        nextStep: 'Proceeding with available information instead of checking logs.',
        suggestion:
          'Continue with the troubleshooting based on current context and known information.',
      };
    }

    return {
      shouldSkip: false,
      message: null,
      nextStep: null,
      suggestion: null,
    };
  } catch (error) {
    logger.error({ error, operation }, 'Error checking debug skip status');
    return {
      shouldSkip: false,
      message: null,
      nextStep: null,
      suggestion: null,
      error: error.message,
    };
  }
}

/**
 * Wrapper function for Claude Code to use when checking PM2 logs
 *
 * Usage in Claude Code:
 * const skipCheck = checkPM2LogsSkip();
 * if (skipCheck.shouldSkip) {
 *   // Skip the pm2 logs command and continue
 *   return skipCheck.message + " " + skipCheck.nextStep;
 * }
 * // Otherwise proceed with pm2 logs command
 *
 * @param {string} instanceName - PM2 instance name (default: 'chimpGPT-Solvis')
 * @param {number} lines - Number of log lines to check (default: 15)
 * @returns {Object} Skip decision with specific PM2 messaging
 */
function checkPM2LogsSkip(instanceName = 'chimpGPT-Solvis', lines = 15) {
  const operation = `pm2 logs ${instanceName} --lines ${lines}`;
  const skipInfo = checkDebugSkip(operation);

  if (skipInfo.shouldSkip) {
    return {
      ...skipInfo,
      message: `${skipInfo.message}\n\n**Skipped Command**: \`${operation}\``,
      nextStep: `Continuing troubleshooting without log analysis. Based on current context, proceeding with next logical step.`,
      logCommand: operation,
      skipped: true,
    };
  }

  return {
    ...skipInfo,
    logCommand: operation,
    skipped: false,
  };
}

/**
 * Generic wrapper for any Bash command that Claude Code wants to check for skip
 *
 * @param {string} command - The bash command to potentially skip
 * @param {string} description - Human-readable description of what the command does
 * @returns {Object} Skip decision and information
 */
function checkBashCommandSkip(command, description = 'bash command') {
  const skipInfo = checkDebugSkip(description);

  if (skipInfo.shouldSkip) {
    return {
      ...skipInfo,
      message: `${skipInfo.message}\n\n**Skipped Command**: \`${command}\``,
      nextStep: `Continuing without executing: ${description}`,
      command: command,
      skipped: true,
    };
  }

  return {
    ...skipInfo,
    command: command,
    skipped: false,
  };
}

/**
 * Helper function to format the skip message for Claude Code responses
 *
 * @param {Object} skipInfo - Skip information from check functions
 * @returns {string} Formatted message for Claude to display
 */
function formatSkipMessage(skipInfo) {
  if (!skipInfo.shouldSkip) {
    return '';
  }

  let message = skipInfo.message;

  if (skipInfo.nextStep) {
    message += `\n\n${skipInfo.nextStep}`;
  }

  if (skipInfo.suggestion) {
    message += `\n\n💡 **Suggestion**: ${skipInfo.suggestion}`;
  }

  return message;
}

/**
 * Claude Code usage example function
 * This shows how Claude Code should integrate the debug skip functionality
 */
function exampleClaudeUsage() {
  // Example 1: Checking PM2 logs
  const pm2Check = checkPM2LogsSkip();
  if (pm2Check.shouldSkip) {
    console.log(formatSkipMessage(pm2Check));
    // Continue with next step instead of running pm2 logs
    return;
  }
  // Otherwise run: pm2 logs chimpGPT-Solvis --lines 15

  // Example 2: Generic bash command
  const bashCheck = checkBashCommandSkip('systemctl status nginx', 'checking nginx status');
  if (bashCheck.shouldSkip) {
    console.log(formatSkipMessage(bashCheck));
    // Continue without checking nginx status
    return;
  }
  // Otherwise run the bash command

  // Example 3: Any operation
  const genericCheck = checkDebugSkip('analyzing error patterns');
  if (genericCheck.shouldSkip) {
    console.log(formatSkipMessage(genericCheck));
    // Skip the analysis and continue
    return;
  }
  // Otherwise perform the analysis
}

module.exports = {
  checkDebugSkip,
  checkPM2LogsSkip,
  checkBashCommandSkip,
  formatSkipMessage,
  exampleClaudeUsage,
};
