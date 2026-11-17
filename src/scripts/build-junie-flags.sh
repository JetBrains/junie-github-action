#!/usr/bin/env bash
# Shared Junie CLI flag assembly (CUSTOM_JUNIE_ARGS + MODEL).
# Used by "Run Junie" and "Auto-collect code review feedback" steps.
#
# Expects env:
#   CUSTOM_JUNIE_ARGS, MODEL
#
# SECURITY (JUNIE-5037): credentials must NEVER be emitted as CLI flags.
# Anything returned by this script ends up in the process argv (visible via `ps`
# / /proc/<pid>/cmdline to every process on the runner, including MCP servers and
# project scripts spawned by the agent) and is echoed to the step log. Older Junie
# CLI builds (<= 3419.x) also wrote the full argv into ~/.junie/logs, which used to
# be uploaded as a workflow artifact. The Junie API key and BYOK provider keys are
# therefore passed to the CLI exclusively through environment variables
# (JUNIE_API_KEY, JUNIE_OPENAI_API_KEY, JUNIE_ANTHROPIC_API_KEY, JUNIE_GROK_API_KEY,
# JUNIE_OPENROUTER_API_KEY, JUNIE_GOOGLE_API_KEY), see action.yml.
#
# Prints flags on stdout (may be empty / leading-space trimmed by caller if needed).

set -euo pipefail

JUNIE_FLAGS="${CUSTOM_JUNIE_ARGS:-}"

# If no custom --model flag in CUSTOM_JUNIE_ARGS, use MODEL input
if [ -n "${MODEL:-}" ] && ! echo "${CUSTOM_JUNIE_ARGS:-}" | grep -q -E '(^|[[:space:]])--model([=[:space:]]|$)'; then
  JUNIE_FLAGS="${JUNIE_FLAGS} --model=${MODEL}"
fi

# Trim leading whitespace
JUNIE_FLAGS="${JUNIE_FLAGS#"${JUNIE_FLAGS%%[![:space:]]*}"}"
printf '%s' "${JUNIE_FLAGS}"
