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
#
# This script must FAIL CLOSED: a non-zero exit code makes the caller skip the artifact upload
# (see the `steps.redact-artifacts.outcome == 'success'` gate in action.yml). Every regular file
# under the given paths is processed regardless of its size - skipping "too large" files would
# upload them unredacted.

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

# A "token" for the shape-based patterns below stops at whitespace and at JSON/shell delimiters
# (quotes, backslash, comma, semicolon). A plain \S+ would swallow the rest of a minified JSON line
# (junie_output.json, session transcripts) and leave the artifact unparsable.
find "${existing[@]}" -type f -print0 | xargs -0 -r perl -i -pe '
  BEGIN {
    # perl only *warns* when it cannot rewrite a file in place (Cannot do inplace edit ...) and
    # moves on with exit code 0, which would leave that file unredacted. Turn every warning
    # into a fatal error so the caller skips the upload.
    $SIG{__WARN__} = sub { die @_ };
    @secrets = grep { length($_) } split /\n/, ($ENV{REDACT_SECRETS} // "");
    $r = $ENV{REDACTED};
    $tok = qr/[^\s"\x27\\,;]/;
    # optional opening quote of the value, possibly JSON-escaped: --auth="x", --auth=\"x\"
    $q = qr/(?:\\?["\x27])?/;
  }
  for my $secret (@secrets) {
    s/\Q$secret\E/$r/g;
  }
  # Credentials passed as CLI flags (any Junie CLI version)
  s/(--(?:auth|[a-z]+-api-key)[= ]${q})${tok}+/$1$r/g;
  # Environment assignments dumped into logs or session transcripts
  s/((?:JUNIE_[A-Z_]*API_KEY|JUNIE_[A-Z_]*TOKEN|EJ_AUTH_GITHUB_TOKEN|GH_TOKEN|GITHUB_TOKEN|JIRA_API_TOKEN|YOUTRACK_TOKEN)=${q})${tok}+/$1$r/g;
  # Authorization headers
  s/(Bearer\s+)${tok}{16,}/$1$r/g;
  # Well-known token shapes
  s/\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}/$r/g;
  s/\bgithub_pat_[A-Za-z0-9_]{20,}/$r/g;
  s/\bsk-(?:ant-|proj-)?[A-Za-z0-9_\-]{20,}/$r/g;
'

echo "Redaction complete"
