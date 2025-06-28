#!/bin/bash
# ChimpGPT Startup Script
# This script provides an easy way to start ChimpGPT in different modes

# Default values
MODE="development"
COMPONENT="all"
DEMO=false
DEBUG=false
QUIET=false

# Display help message
function show_help {
  echo "ChimpGPT Startup Script"
  echo "Usage: ./start.sh [options]"
  echo ""
  echo "Options:"
  echo "  -m, --mode MODE       Set run mode (production, development, test, demo)"
  echo "  -c, --component COMP  Component to run (all, bot, status)"
  echo "  -d, --demo            Enable demo mode (generates mock data)"
  echo "  --debug               Enable debug logging"
  echo "  -q, --quiet           Minimize logging (errors only)"
  echo "  -h, --help            Show this help message"
  echo ""
  echo "Examples:"
  echo "  ./start.sh                        # Start in development mode"
  echo "  ./start.sh -m production          # Start in production mode"
  echo "  ./start.sh -c status --demo       # Start only status server in demo mode"
  echo "  ./start.sh -m test                # Run tests"
  echo "  ./start.sh --debug                # Start with debug logging enabled"
}

# Parse command line arguments
while [[ $# -gt 0 ]]; do
  case $1 in
    -m|--mode)
      MODE="$2"
      shift 2
      ;;
    -c|--component)
      COMPONENT="$2"
      shift 2
      ;;
    -d|--demo)
      DEMO=true
      shift
      ;;
    --debug)
      DEBUG=true
      shift
      ;;
    -q|--quiet)
      QUIET=true
      shift
      ;;
    -h|--help)
      show_help
      exit 0
      ;;
    *)
      echo "Unknown option: $1"
      show_help
      exit 1
      ;;
  esac
done

# Validate mode
if [[ "$MODE" != "production" && "$MODE" != "development" && "$MODE" != "test" && "$MODE" != "demo" ]]; then
  echo "Error: Invalid mode '$MODE'. Must be one of: production, development, test, demo"
  exit 1
fi

# Validate component
if [[ "$COMPONENT" != "all" && "$COMPONENT" != "bot" && "$COMPONENT" != "status" ]]; then
  echo "Error: Invalid component '$COMPONENT'. Must be one of: all, bot, status"
  exit 1
fi

# Build command
CMD="node ../src/core/combined.js --mode $MODE"

# Add component flags
if [[ "$COMPONENT" == "bot" ]]; then
  CMD="$CMD --bot-only"
elif [[ "$COMPONENT" == "status" ]]; then
  CMD="$CMD --status-only"
fi

# Add other flags
if [[ "$DEMO" == true ]]; then
  CMD="$CMD --demo"
fi

if [[ "$DEBUG" == true ]]; then
  CMD="$CMD --debug"
fi

if [[ "$QUIET" == true ]]; then
  CMD="$CMD --quiet"
fi

# Display startup information
echo "Starting ChimpGPT with the following configuration:"
echo "  Mode: $MODE"
echo "  Component: $COMPONENT"
echo "  Demo mode: $DEMO"
echo "  Debug logging: $DEBUG"
echo "  Quiet logging: $QUIET"
echo ""
echo "Command: $CMD"
echo ""
echo "Press Ctrl+C to stop"
echo "-------------------------------------"

# Execute the command
exec $CMD
