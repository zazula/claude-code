#!/usr/bin/env bash

# Claude -c workaround
# This script intercepts 'claude -c' and uses the workaround

# Get the real claude command (bypass any aliases)
REAL_CLAUDE="/opt/homebrew/bin/claude"

if [[ "$1" == "-c" || "$1" == "--continue" ]]; then
  # Use our workaround script
  shift  # Remove the -c flag
  claude-continue "$@"
else
  # Pass through to normal claude with all arguments
  $REAL_CLAUDE "$@"
fi