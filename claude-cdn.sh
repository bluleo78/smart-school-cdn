#!/bin/zsh

export CLAUDE_CONFIG_DIR=~/.claude-cdn
##export CLAUDE_CODE_OAUTH_TOKEN=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
claude --dangerously-skip-permissions "$@"

