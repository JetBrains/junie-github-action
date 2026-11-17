#!/usr/bin/env bash
# Redacts secrets from files before they are uploaded as a workflow artifact (JUNIE-5037).
#
# Workflow artifacts can be downloaded by anyone with *read* access to the repository, so
# nothing uploaded by the action may contain credentials. `core.setSecret` only masks values
# in the Actions step log, not in files, hence this explicit pass.
#
# Usage:
#   redact-junie-artifacts.sh <path> [<path>...]
#
# Expects env:
#   REDACT_SECRETS - newline-separated list of secret values to replace (empty entries ignored)
#
# Non-existing paths are skipped. In addition to the exact secret values, well-known credential
# shapes are redacted defensively (CLI auth flags, JUNIE_* key env assignments, Bearer headers,
# GitHub/OpenAI/Anthropic token prefixes).

set -euo pipefail

REDACTED='***REDACTED***'
export REDACTED

existing=()
for p in "$@"; do
  # Expand a leading "~" (upload-artifact style paths such as ~/.junie/logs)
  p="${p/#\~/$HOME}"
  if [ -e "${p}" ]; then
    existing+=("${p}")
  fi
done

if [ "${#existing[@]}" -eq 0 ]; then
  echo "No artifact paths to redact"
  exit 0
fi

echo "Redacting secrets in: ${existing[*]}"

find "${existing[@]}" -type f -size -50M -print0 | xargs -0 -r perl -i -pe '
  BEGIN {
    @secrets = grep { length($_) } split /\n/, ($ENV{REDACT_SECRETS} // "");
    $r = $ENV{REDACTED};
  }
  for my $secret (@secrets) {
    s/\Q$secret\E/$r/g;
  }
  # Credentials passed as CLI flags (any Junie CLI version)
  s/(--(?:auth|[a-z]+-api-key)[= ])\S+/$1$r/g;
  # Environment assignments dumped into logs or session transcripts
  s/((?:JUNIE_[A-Z_]*API_KEY|JUNIE_[A-Z_]*TOKEN|EJ_AUTH_GITHUB_TOKEN|GH_TOKEN|GITHUB_TOKEN|JIRA_API_TOKEN|YOUTRACK_TOKEN)=)\S+/$1$r/g;
  # Authorization headers
  s/(Bearer\s+)\S{16,}/$1$r/g;
  # Well-known token shapes
  s/\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}/$r/g;
  s/\bgithub_pat_[A-Za-z0-9_]{20,}/$r/g;
  s/\bsk-(?:ant-|proj-)?[A-Za-z0-9_\-]{20,}/$r/g;
'

echo "Redaction complete"
