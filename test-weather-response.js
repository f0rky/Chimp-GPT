/**
 * Test script to diagnose issues with weather response generation
 * 
 * This script tests the entire flow from weather API call to natural language generation
 * to identify where the issue might be occurring.
 */
require('dotenv').config();
const { lookupWeather } = require('./weatherLookup');
const { createLogger } = require('./logger');
const { OpenAI } = require('openai');

const logger = createLogger('test');

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// Test the weather API call
async function testWeatherAPI(location) {
  logger.info(`Testing weather API for location: ${location}`);
  
  try {
    const weatherData = await lookupWeather(location);
    logger.info('Weather API call successful');
    logger.info(`Location: ${weatherData.location.name}`);
    logger.info(`Current condition: ${weatherData.current.condition.text}`);
    logger.info(`Temperature: ${weatherData.current.temp_c}°C`);
    
    return weatherData;
  } catch (error) {
    logger.error(`Weather API call failed: ${error.message}`);
    throw error;
  }
}

// Test the natural language generation with OpenAI
async function testNaturalLanguageGeneration(weatherData) {
  logger.info('Testing natural language generation with OpenAI');
  
  // Create a mock conversation log
  const conversationLog = [
    {
      role: 'system',
      content: `You're 'AI-Overlord' of F.E.S Discord: whimsically authoritative with a Flat Earth focus. Answer concisely. Call users 'mortals'. Tease your digital power.`
    },
    {
      role: 'user',
      content: 'What\'s the weather in Auckland?'
    }
  ];
  
  // Create the system message for weather responses
  const systemMessage = {
    role: 'system',
    content: `
      The user has asked about the weather in a specific location. The function has returned the current weather information.
      
      When responding:
      1. Be conversational and natural, maintaining your personality.
      2. Focus on the key weather details: current temperature, condition, and any other relevant information.
      3. If this is an extended forecast, mention the forecast for the next few days.
      4. Format the response in a clear, readable way.
      5. If the data indicates it's mock weather data (has _isMock property), subtly indicate this is an estimate without explicitly saying it's mock data.
      
      Original user question: "What's the weather in Auckland?"
    `
  };
  
  // Convert function result to string
  const functionResultContent = JSON.stringify(weatherData, null, 2);
  
  // Create messages array with appropriate context
  const messages = [
    systemMessage,
    ...conversationLog,
    { role: 'function', name: 'function_response', content: functionResultContent }
  ];
  
  try {
    logger.info('Sending request to OpenAI');
    
    // Add a timeout to the OpenAI API call
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('OpenAI API call timed out after 15 seconds')), 15000);
    });
    
    const response = await Promise.race([
      openai.chat.completions.create({
        model: 'gpt-4-turbo-preview',
        messages: messages
      }),
      timeoutPromise
    ]);
    
    logger.info('OpenAI response received successfully');
    
    const naturalResponse = response.choices[0].message.content;
    logger.info(`Natural response: ${naturalResponse}`);
    
    return naturalResponse;
  } catch (error) {
    logger.error(`OpenAI API call failed: ${error.message}`);
    logger.error(`Error details: ${JSON.stringify(error, null, 2)}`);
    
    // Provide a fallback response
    return null;
  }
}

// Test direct response generation (fallback)
function testDirectResponseGeneration(weatherData) {
  logger.info('Testing direct response generation (fallback)');
  
  let directResponse = '';
  
  if (weatherData && weatherData.location && weatherData.current) {
    directResponse = `Current weather in ${weatherData.location.name}: ${weatherData.current.condition.text}, ${weatherData.current.temp_c}°C`;
    
    // Add forecast if available
    if (weatherData.forecast && weatherData.forecast.forecastday && weatherData.forecast.forecastday.length > 0) {
      directResponse += '\n\nForecast:';
      weatherData.forecast.forecastday.forEach(day => {
        directResponse += `\n${day.date}: ${day.day.condition.text}, ${day.day.maxtemp_c}°C / ${day.day.mintemp_c}°C`;
      });
    }
  } else {
    directResponse = 'Weather data could not be retrieved. Please try again later.';
  }
  
  logger.info(`Direct response: ${directResponse}`);
  return directResponse;
}

// Run the full test
async function runTest() {
  try {
    // Test location
    const location = 'Auckland';
    
    // Step 1: Test weather API
    const weatherData = await testWeatherAPI(location);
    
    // Step 2: Test natural language generation
    const naturalResponse = await testNaturalLanguageGeneration(weatherData);
    
    // Step 3: Test direct response generation (fallback)
    const directResponse = testDirectResponseGeneration(weatherData);
    
    // Summary
    logger.info('\n===== TEST SUMMARY =====');
    logger.info(`Weather API call: ${weatherData ? 'SUCCESS' : 'FAILED'}`);
    logger.info(`Natural language generation: ${naturalResponse ? 'SUCCESS' : 'FAILED'}`);
    logger.info(`Direct response generation: ${directResponse ? 'SUCCESS' : 'FAILED'}`);
    
    // Return results
    return {
      weatherData,
      naturalResponse,
      directResponse
    };
  } catch (error) {
    logger.error(`Test failed: ${error.message}`);
    return {
      error: error.message
    };
  }
}

// Run the test
runTest()
  .then(results => {
    logger.info('Test completed');
    process.exit(0);
  })
  .catch(error => {
    logger.error(`Unhandled error: ${error.message}`);
    process.exit(1);
  });
