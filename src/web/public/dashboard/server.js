const express = require('express');
const path = require('path');
const app = express();
const port = process.env.PORT || 3000;

// Serve static files from the public directory
app.use(express.static(path.join(__dirname, '..')));

// Route for the dashboard
app.get('/dashboard', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Start the server
app.listen(port, () => {
  // Server startup messages for standalone dashboard server
  console.log(`Dashboard server running at http://localhost:${port}/dashboard`);
  console.log('Press Ctrl+C to stop the server');
});
