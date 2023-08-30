const axios = require('axios');

async function getWolframShortAnswer(query) {
  const appId = process.env.WOLFRAM_APP_ID;  // Assume the Wolfram App ID is stored in an environment variable

  const options = {
    method: 'GET',
    url: `http://api.wolframalpha.com/v1/result`,
    params: {
      i: query,
      appid: appId
    }
  };

  try {
    const response = await axios.request(options);
    const answer = response.data;
    return `Wolfram Alpha says: ${answer}`;
  } catch (error) {
    console.error(error);
    if (error.response && error.response.data) {
      return `Error: ${error.response.data}`;
    }
    return `Error: ${error.message}`;
  }
}

module.exports = {
  getWolframShortAnswer
};
