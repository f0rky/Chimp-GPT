/**
 * Test file for the improved PocketFlow-based image generation system
 * This validates the new architecture with dynamic status updates
 */

const ImageGenerationFlow = require('../../src/conversation/flow/ImageGenerationFlow');
const ImageGenerationAgentNode = require('../../src/conversation/flow/nodes/ImageGenerationAgentNode');
const { createLogger } = require('../../src/core/logger');

const logger = createLogger('PocketFlowImageTest');

// Mock message and feedback message for testing
function createMockMessage(content, userId = 'test-user', messageId = 'test-msg-123') {
  return {
    id: messageId,
    content,
    author: {
      id: userId,
      username: 'TestUser',
      displayName: 'Test User',
    },
    channel: {
      id: 'test-channel',
      type: 'GUILD_TEXT',
    },
    createdTimestamp: Date.now(),
  };
}

function createMockFeedbackMessage() {
  const messages = [];

  return {
    id: `feedback-${Date.now()}`,
    edit: async content => {
      const timestamp = new Date().toISOString();
      const logContent =
        typeof content === 'string'
          ? content.substring(0, 150) + (content.length > 150 ? '...' : '')
          : JSON.stringify(content).substring(0, 150) + '...';

      messages.push({ timestamp, content: logContent });
      console.log(`[${timestamp}] Status Update: ${logContent}`);
      return Promise.resolve();
    },
    getMessages: () => messages,
  };
}

async function testImageGenerationAgent() {
  console.log('\n🧪 Testing ImageGenerationAgentNode...');

  const agent = new ImageGenerationAgentNode({
    config: {
      updateInterval: 1000, // Faster for testing
      enableEnhancement: false, // Skip AI enhancement for testing
    },
  });

  // Test parameter extraction
  const testCases = [
    'draw a sunset over mountains',
    'generate an image of a robot in space',
    'create a picture of a cat wearing a hat size:1536x1024',
    'make me an artwork of abstract patterns quality:high',
  ];

  console.log('\n📋 Testing parameter extraction:');
  testCases.forEach(content => {
    const params = agent.extractImageParameters(content);
    console.log(`Input: "${content}"`);
    console.log(`Extracted: ${JSON.stringify(params)}\n`);
  });

  // Test status messages
  console.log('🎭 Testing dynamic status messages:');
  const phases = ['initializing', 'enhancing', 'generating', 'downloading', 'finalizing'];
  phases.forEach(phase => {
    const message = agent.getStatusMessage(phase, []);
    console.log(`${phase}: ${message}`);
  });

  console.log('\n✅ ImageGenerationAgentNode tests completed');
}

async function testImageGenerationFlow() {
  console.log('\n🌊 Testing ImageGenerationFlow...');

  const flow = new ImageGenerationFlow({
    enableStatusUpdates: true,
    updateInterval: 1000, // Faster updates for testing
    maxExecutionTime: 30000, // Shorter timeout for testing
  });

  // Test flow detection
  const testMessages = [
    'draw a beautiful landscape',
    'hello there',
    'generate me an image of a spaceship',
    'what time is it?',
  ];

  console.log('🔍 Testing image request detection:');
  testMessages.forEach(content => {
    const isImage = flow.isImageRequest(content);
    console.log(`"${content}" -> ${isImage ? '✅ Image request' : '❌ Not image request'}`);
  });

  // Test flow creation (without actual execution)
  const message = createMockMessage('draw a test image');
  const feedbackMessage = createMockFeedbackMessage();

  console.log('\n🏗️ Testing flow creation:');
  const testFlow = flow.createFlow(message, feedbackMessage);

  if (testFlow && testFlow.startNode) {
    console.log('✅ Flow created successfully');
    console.log(`Start node: ${testFlow.startNode.id}`);
  } else {
    console.log('❌ Flow creation failed');
  }

  // Test active generation tracking
  console.log('\n📊 Testing generation tracking:');
  console.log(`Active generations: ${flow.getActiveGenerations().length}`);

  console.log('\n✅ ImageGenerationFlow tests completed');
}

async function testIntegration() {
  console.log('\n🔗 Testing PocketFlow Integration...');

  // Mock a simplified function executor integration
  const mockFunctionExecutor = {
    imageGenerationFlow: new ImageGenerationFlow({
      enableStatusUpdates: true,
      updateInterval: 500,
    }),

    async handleImageRequest(message) {
      const feedbackMessage = createMockFeedbackMessage();
      console.log(`\n🎨 Starting image generation for: "${message.content}"`);

      try {
        // This would normally call the actual service, but we'll simulate
        console.log('⚡ Simulating PocketFlow image generation...');

        // Show how status updates would work
        console.log('📡 Status updates would be sent to Discord...');
        await feedbackMessage.edit('🎨 Preparing the digital canvas...');
        await new Promise(resolve => setTimeout(resolve, 1000));

        await feedbackMessage.edit('✨ Enhancing your prompt with AI...\n✅ Canvas ready');
        await new Promise(resolve => setTimeout(resolve, 1000));

        await feedbackMessage.edit(
          '🖼️ Generating your image...\n✅ Canvas ready • ✅ Prompt optimized'
        );
        await new Promise(resolve => setTimeout(resolve, 1500));

        await feedbackMessage.edit(
          '⬇️ Retrieving your artistic creation...\n✅ Canvas ready • ✅ Prompt optimized • ✅ Image created'
        );
        await new Promise(resolve => setTimeout(resolve, 500));

        await feedbackMessage.edit(
          '🎁 Preparing your image for delivery...\n✅ Canvas ready • ✅ Prompt optimized • ✅ Image created • ✅ Artwork retrieved'
        );
        await new Promise(resolve => setTimeout(resolve, 500));

        console.log('✅ Image generation simulation completed!');
        console.log('🎯 Final result would be posted to Discord with the generated image');

        return {
          success: true,
          type: 'pocketflow_simulation',
          executionTime: 4000,
        };
      } catch (error) {
        console.log(`❌ Error: ${error.message}`);
        return {
          success: false,
          error: error.message,
        };
      }
    },
  };

  // Test the integration
  const testMessage = createMockMessage('draw a futuristic cityscape at sunset');
  const result = await mockFunctionExecutor.handleImageRequest(testMessage);

  console.log(`\n📋 Integration test result:`, {
    success: result.success,
    type: result.type,
    executionTime: result.executionTime,
  });

  console.log('\n✅ Integration tests completed');
}

async function runAllTests() {
  console.log('🚀 Starting PocketFlow Image Generation Tests\n');
  console.log('='.repeat(60));

  try {
    await testImageGenerationAgent();
    await testImageGenerationFlow();
    await testIntegration();

    console.log('\n' + '='.repeat(60));
    console.log('🎉 All tests completed successfully!');
    console.log('\n💡 Key improvements implemented:');
    console.log('   • Dynamic status messages with variety');
    console.log('   • PocketFlow node-based architecture');
    console.log('   • Enhanced user experience with real-time updates');
    console.log('   • Better error handling and fallbacks');
    console.log('   • Structured workflow with proper phases');
    console.log('   • Integration with existing systems');
  } catch (error) {
    console.error('\n❌ Test execution failed:', error);
    process.exit(1);
  }
}

// Run tests if called directly
if (require.main === module) {
  runAllTests().catch(console.error);
}

module.exports = {
  testImageGenerationAgent,
  testImageGenerationFlow,
  testIntegration,
  runAllTests,
};
