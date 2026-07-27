#!/usr/bin/env bash
# Shared Junie CLI flag assembly (CUSTOM_JUNIE_ARGS + MODEL + BYOK keys).
# Used by "Run Junie" and "Auto-collect code review feedback" steps.
#
# Expects env:
#   CUSTOM_JUNIE_ARGS, MODEL,
#   OPENAI_API_KEY, ANTHROPIC_API_KEY, GROK_API_KEY, OPENROUTER_API_KEY, GOOGLE_API_KEY
#
# Prints flags on stdout (may be empty / leading-space trimmed by caller if needed).

set -euo pipefail

JUNIE_FLAGS="${CUSTOM_JUNIE_ARGS:-}"

# If no custom --model flag in CUSTOM_JUNIE_ARGS, use MODEL input
if [ -n "${MODEL:-}" ] && ! echo "${CUSTOM_JUNIE_ARGS:-}" | grep -q -- "--model="; then
  JUNIE_FLAGS="${JUNIE_FLAGS} --model=${MODEL}"
fi

# Add BYOK API key flags if provided
[ -n "${OPENAI_API_KEY:-}" ] && JUNIE_FLAGS="${JUNIE_FLAGS} --openai-api-key=${OPENAI_API_KEY}"
[ -n "${ANTHROPIC_API_KEY:-}" ] && JUNIE_FLAGS="${JUNIE_FLAGS} --anthropic-api-key=${ANTHROPIC_API_KEY}"
[ -n "${GROK_API_KEY:-}" ] && JUNIE_FLAGS="${JUNIE_FLAGS} --grok-api-key=${GROK_API_KEY}"
[ -n "${OPENROUTER_API_KEY:-}" ] && JUNIE_FLAGS="${JUNIE_FLAGS} --openrouter-api-key=${OPENROUTER_API_KEY}"
[ -n "${GOOGLE_API_KEY:-}" ] && JUNIE_FLAGS="${JUNIE_FLAGS} --google-api-key=${GOOGLE_API_KEY}"

# Trim leading whitespace
JUNIE_FLAGS="${JUNIE_FLAGS#"${JUNIE_FLAGS%%[![:space:]]*}"}"
printf '%s' "${JUNIE_FLAGS}"
