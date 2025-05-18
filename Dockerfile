FROM node:20-alpine

# Create app directory
WORKDIR /usr/src/app

# Install dependencies
COPY package*.json ./
# Skip prepare script which tries to install husky
RUN npm pkg delete scripts.prepare && npm ci --omit=dev

# Copy app source
COPY . .

# Create data directory for persistent storage
RUN mkdir -p /usr/src/app/data
VOLUME /usr/src/app/data

# Expose ports for Discord bot and status server
EXPOSE 3000

# Set environment variables
ENV NODE_ENV=production

# Use an init system to handle signals properly
RUN apk add --no-cache tini
ENTRYPOINT ["/sbin/tini", "--"]

# Start the application
CMD ["node", "combined.js"]
