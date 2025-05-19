# ChimpGPT Performance Dashboard

A retro-styled dashboard for monitoring ChimpGPT's performance metrics, API usage, and system health.

## Features

- Real-time API latency monitoring
- Active request tracking
- Memory usage visualization
- Function performance metrics
- Cost tracking for API usage
- Responsive design for all devices
- Retro CRT aesthetic

## Getting Started

### Prerequisites

- Node.js (v14 or higher)
- npm (comes with Node.js)

### Installation

1. Navigate to the dashboard directory:

   ```bash
   cd public/dashboard
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

### Running the Dashboard

1. Start the development server:

   ```bash
   npm start
   ```

   This will start the dashboard on http://localhost:3000/dashboard

2. For development with auto-reload:
   ```bash
   npm run dev
   ```
   (Requires nodemon to be installed globally or as a dev dependency)

## Development

### Project Structure

```
dashboard/
├── css/
│   └── retro.css        # Retro styling and animations
├── js/
│   └── dashboard.js    # Dashboard logic and data visualization
├── assets/              # Static assets (if any)
├── index.html          # Main HTML file
├── server.js           # Express server
└── package.json        # Project configuration
```

### Customization

- **Colors**: Edit the CSS variables in `css/retro.css` to change the color scheme.
- **Data Sources**: Modify `js/dashboard.js` to connect to real API endpoints.
- **Layout**: Adjust the grid layout in `index.html` and `css/retro.css` as needed.

## License

This project is part of the ChimpGPT bot and follows the same license.

## Screenshot

![Dashboard Screenshot](screenshot.png)
