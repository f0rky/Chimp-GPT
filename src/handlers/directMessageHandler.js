/**
 * Handles direct message responses from OpenAI
 *
 * This function processes standard text responses from OpenAI (not function calls)
 * and updates the Discord message with the response content. It also handles
 * truncating responses that exceed Discord's character limit.
 *
 * @param {Object} gptResponse - The response from OpenAI containing the message content
 * @param {Object} feedbackMessage - The Discord message to update with results
 * @param {Array<Object>} conversationLog - The conversation history to update
 * @param {string} userIdFromMessage - User ID for conversation management
 * @param {number} startTime - Timestamp when processing started
 * @param {Object} usage - Token usage information
 * @param {Object} apiCalls - API call tracking object
 * @param {Object} originalMessage - The original user message
 * @param {Function} formatSubtext - Function to format response subtext
 * @param {Function} storeMessageRelationship - Function to store message relationships
 * @param {Function} manageConversation - Function to manage conversation storage
 * @returns {Promise<void>}
 */
async function handleDirectMessage(
  gptResponse,
  feedbackMessage,
  conversationLog,
  userIdFromMessage,
  startTime = Date.now(),
  usage = {},
  apiCalls = {},
  originalMessage = null,
  formatSubtext,
  storeMessageRelationship,
  manageConversation
) {
  if (!gptResponse.content?.trim()) {
    await feedbackMessage.edit("Sorry, I couldn't understand your request. Please try again.");
    return;
  }

  // Create a new response message
  const responseMessage = {
    role: 'assistant',
    content: gptResponse.content,
  };

  // Add to the conversation log
  conversationLog.push(responseMessage);

  // Also update the stored conversation
  // We don't need to pass the Discord message here since we're just adding an assistant response
  await manageConversation(userIdFromMessage, responseMessage);

  // Prepare the final response with standardized subtext
  let finalResponse = gptResponse.content;
  const subtext = formatSubtext(startTime, usage, apiCalls);

  // Ensure the total length doesn't exceed Discord's 2000 character limit
  const maxLength = 2000 - subtext.length - 3; // -3 for potential ellipsis
  if (finalResponse.length > maxLength) {
    finalResponse = finalResponse.slice(0, maxLength) + '...';
  }

  // Append the subtext
  finalResponse += subtext;

  await feedbackMessage.edit(finalResponse);

  // Store the relationship between user message and bot response for context preservation
  storeMessageRelationship(originalMessage, feedbackMessage, 'message', originalMessage?.content);
}

module.exports = {
  handleDirectMessage,
};
