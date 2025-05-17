# Docker Deployment Guide for ChimpGPT

This guide explains how to deploy ChimpGPT using Docker and Docker Compose for simplified deployment and management.

## Prerequisites

- [Docker](https://docs.docker.com/get-docker/)
- [Docker Compose](https://docs.docker.com/compose/install/)
- A valid `.env` file with all required environment variables

## Quick Start

1. Clone the repository:

   ```bash
   git clone https://github.com/yourusername/Chimp-GPT.git
   cd Chimp-GPT
   ```

2. Create a `.env` file based on the example:

   ```bash
   cp .env.example .env
   ```

3. Edit the `.env` file to add your Discord token, OpenAI API key, and other required variables:

   ```bash
   nano .env
   ```

4. Build and start the container:

   ```bash
   docker-compose up -d
   ```

5. Check the logs:
   ```bash
   docker-compose logs -f
   ```

## Configuration

The Docker setup uses the following configuration:

- The status page is exposed on port 3000 by default (configurable via `STATUS_PORT` in .env)
- Persistent data is stored in the `./data` directory
- The container automatically restarts unless explicitly stopped
- Health checks ensure the application is running properly

## Environment Variables

All environment variables from `.env` are passed to the container. See `.env.example` for a complete list of available options.

## Updating

To update to a new version:

1. Pull the latest changes:

   ```bash
   git pull
   ```

2. Rebuild and restart the container:
   ```bash
   docker-compose down
   docker-compose up -d --build
   ```

## Troubleshooting

### Container fails to start

Check the logs for errors:

```bash
docker-compose logs
```

### Status page is not accessible

Verify the container is running and the port mapping is correct:

```bash
docker-compose ps
```

### Discord bot is not responding

Check if the Discord token is correctly set in the `.env` file and that the bot has the necessary permissions in your Discord server.

## Advanced Configuration

### Custom Port

To use a different port for the status page, set the `STATUS_PORT` environment variable:

```bash
STATUS_PORT=8080 docker-compose up -d
```

### Custom Time Zone

The default time zone is UTC. To use a different time zone, modify the `TZ` environment variable in the `docker-compose.yml` file.

## GitHub Actions CI/CD

This repository includes GitHub Actions workflows for:

1. **Continuous Integration (CI)**: Runs on every push and pull request to verify code quality and test coverage
2. **Continuous Deployment (CD)**: Builds and publishes Docker images to GitHub Container Registry when changes are pushed to main or when a new tag is created

To use the GitHub Container Registry images:

```bash
docker pull ghcr.io/yourusername/chimp-gpt:latest
```

Replace `yourusername` with your actual GitHub username or organization name.
