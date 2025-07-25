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

# Create nodejs user with specific UID/GID
RUN addgroup -g 1001 -S nodejs && \
    adduser -S -D -H -u 1001 -s /sbin/nologin -G nodejs nodejs

# Change ownership of app directory to nodejs user
RUN chown -R nodejs:nodejs /usr/src/app

# Expose ports for Discord bot and status server
EXPOSE 3000

# Set environment variables
ENV NODE_ENV=production

# Use an init system to handle signals properly
RUN apk add --no-cache tini
ENTRYPOINT ["/sbin/tini", "--"]

# Switch to non-root user
USER nodejs

# Start the application
CMD ["node", "combined.js"]
