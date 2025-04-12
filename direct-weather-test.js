/**
 * Direct test script for weather API and response generation
 * 
 * This script simulates the exact flow used in the bot to test the weather API
 * and response generation in isolation.
 */
require('dotenv').config();
const axios = require('axios');
const { OpenAI } = require('openai');

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// Simple logging function
function log(message) {
  console.log(`[${new Date().toISOString()}] ${message}`);
}

// Direct weather API call
async function getWeather(location) {
  log(`Getting weather for ${location}`);
  
  try {
    // Get API key from environment
    const apiKey = process.env.X_RAPIDAPI_KEY;
    const encodedLocation = encodeURIComponent(location);
    
    // Use the current.json endpoint which is working correctly
    const url = `https://weatherapi-com.p.rapidapi.com/current.json?q=${encodedLocation}`;
    
    log(`Making request to: ${url}`);
    
    // Make the request with the exact header format
    const response = await axios.get(url, {
      headers: {
        'X-RapidAPI-Key': apiKey,
        'X-RapidAPI-Host': 'weatherapi-com.p.rapidapi.com'
      }
    });
    
    log('Weather API call successful');
    
    // Add a mock forecast since we're only getting current weather
    const weatherData = {
      ...response.data,
      forecast: {
        forecastday: [{
          date: new Date().toISOString().split('T')[0],
          day: {
            maxtemp_c: response.data.current.temp_c + 2,
            mintemp_c: response.data.current.temp_c - 5,
            condition: response.data.current.condition
          }
        }]
      }
    };
    
    return weatherData;
  } catch (error) {
    log(`Weather API error: ${error.message}`);
    if (error.response) {
      log(`Status: ${error.response.status}`);
      log(`Headers: ${JSON.stringify(error.response.headers)}`);
    }
    throw error;
  }
}

// Generate natural language response
async function generateResponse(weatherData, userQuestion) {
  log('Generating natural language response');
  
  try {
    // Create a system message for weather responses
    const systemMessage = {
      role: 'system',
      content: `
        You're 'AI-Overlord' of F.E.S Discord: whimsically authoritative with a Flat Earth focus. Answer concisely. Call users 'mortals'. Tease your digital power.
        
        The user has asked about the weather in a specific location. The function has returned the current weather information.
        
        When responding:
        1. Be conversational and natural, maintaining your personality.
        2. Focus on the key weather details: current temperature, condition, and any other relevant information.
        3. If this is an extended forecast, mention the forecast for the next few days.
        4. Format the response in a clear, readable way.
        
        Original user question: "${userQuestion}"
      `
    };
    
    // Extract essential weather data to reduce payload size
    const essentialData = {
      location: weatherData.location ? {
        name: weatherData.location.name,
        country: weatherData.location.country,
        localtime: weatherData.location.localtime
      } : null,
      current: weatherData.current ? {
        temp_c: weatherData.current.temp_c,
        condition: weatherData.current.condition,
        humidity: weatherData.current.humidity,
        wind_kph: weatherData.current.wind_kph,
        wind_dir: weatherData.current.wind_dir
      } : null,
      forecast: weatherData.forecast ? {
        forecastday: weatherData.forecast.forecastday?.map(day => ({
          date: day.date,
          day: {
            maxtemp_c: day.day.maxtemp_c,
            mintemp_c: day.day.mintemp_c,
            condition: day.day.condition
          }
        }))
      } : null
    };
    
    const functionResultContent = JSON.stringify(essentialData);
    log(`Function result content length: ${functionResultContent.length} characters`);
    
    // Create messages array
    const messages = [
      systemMessage,
      { role: 'user', content: userQuestion },
      { role: 'function', name: 'function_response', content: functionResultContent }
    ];
    
    log('Sending request to OpenAI');
    
    // Add a timeout to the OpenAI API call
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('OpenAI API call timed out after 20 seconds')), 20000);
    });
    
    const response = await Promise.race([
      openai.chat.completions.create({
        model: 'gpt-4-turbo-preview',
        messages: messages
      }),
      timeoutPromise
    ]);
    
    log('OpenAI response received successfully');
    
    const naturalResponse = response.choices[0].message.content;
    log(`Response length: ${naturalResponse.length} characters`);
    log(`Natural response: ${naturalResponse}`);
    
    return naturalResponse;
  } catch (error) {
    log(`OpenAI API error: ${error.message}`);
    if (error.response) {
      log(`Status: ${error.response.status}`);
      log(`Error data: ${JSON.stringify(error.response.data)}`);
    }
    throw error;
  }
}

// Fallback response generation
function generateFallbackResponse(weatherData) {
  log('Generating fallback response');
  
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
  
  log(`Fallback response: ${directResponse}`);
  return directResponse;
}

// Run the full test
async function runTest() {
  try {
    // Test location and question
    const location = 'Auckland';
    const userQuestion = 'What\'s the weather in Auckland?';
    
    // Step 1: Get weather data
    const weatherData = await getWeather(location);
    log(`Weather data received for ${weatherData.location.name}`);
    
    // Step 2: Generate natural language response
    try {
      const naturalResponse = await generateResponse(weatherData, userQuestion);
      log('Test completed successfully with natural response');
    } catch (error) {
      log(`Natural response generation failed: ${error.message}`);
      
      // Step 3: Generate fallback response
      const fallbackResponse = generateFallbackResponse(weatherData);
      log('Test completed with fallback response');
    }
  } catch (error) {
    log(`Test failed: ${error.message}`);
  }
}

// Run the test
runTest()
  .then(() => {
    log('Test execution completed');
  })
  .catch(error => {
    log(`Unhandled error: ${error.message}`);
  });
