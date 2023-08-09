const axios = require('axios');
const moment = require('moment-timezone');

async function lookupTime(location) {
  try {
    const response = await axios.get(`http://worldtimeapi.org/api/timezone/${location}`);
    const { datetime } = response.data;
    const dateTime = moment.tz(datetime, location).format("h:mmA");
    return `The current time in ${location} is ${dateTime}.`;
  } catch (error) {
    console.error(error);
    return "Error fetching time. Please provide a valid timezone.(checkout: http://worldtimeapi.org/api/timezone)";
  }
}

module.exports = lookupTime;
