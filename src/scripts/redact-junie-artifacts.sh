#!/usr/bin/env bash
# Stages files for the `junie-artifacts` workflow artifact and redacts secrets from the copy (JUNIE-5037).
#
# Workflow artifacts can be downloaded by anyone with *read* access to the repository, so
# nothing uploaded by the action may contain credentials. `core.setSecret` only masks values
# in the Actions step log, not in files, hence this explicit pass.
#
# Usage:
#   redact-junie-artifacts.sh <stage-dir> <path> [<path>...]
#
# Expects env:
#   REDACT_SECRETS - newline-separated list of secret values to replace (empty entries ignored)
#
# Every existing <path> is copied into <stage-dir> under its absolute path (e.g. /tmp/junie-work ->
# <stage-dir>/tmp/junie-work) and only the copy is redacted, so the live working directory, which may
# be the checkout that is committed later, and the CLI's own logs are never modified. The caller
# uploads <stage-dir> only. Symlinks and other non-regular files are dropped from the copy:
# actions/upload-artifact follows symlinks, which would let a link bypass the redaction.
#
# In addition to the exact secret values (and their JSON-escaped forms), well-known credential
# shapes are redacted defensively (CLI auth flags, JUNIE_* key env assignments, Bearer headers,
# GitHub/OpenAI/Anthropic token prefixes).
#
# This script must FAIL CLOSED: a non-zero exit code makes the caller skip the artifact upload
# (see the `steps.redact-artifacts.outcome == 'success'` gate in action.yml), and the stage
# directory is removed. Every regular file is processed regardless of its size - skipping "too
# large" files would upload them unredacted.

set -euo pipefail

REDACTED='***REDACTED***'
export REDACTED

if [ "$#" -lt 1 ] || [ -z "${1}" ]; then
  echo "Usage: redact-junie-artifacts.sh <stage-dir> <path> [<path>...]" >&2
  exit 2
fi

STAGE_DIR="${1%/}"
shift

rm -rf "${STAGE_DIR}"
mkdir -p "${STAGE_DIR}"
STAGE_DIR="$(cd "${STAGE_DIR}" && pwd -P)"
trap 'rc=$?; [ "${rc}" -eq 0 ] || rm -rf "${STAGE_DIR}"' EXIT

staged=0
for p in "$@"; do
  # Expand a leading "~" (upload-artifact style paths such as ~/.junie/logs)
  p="${p/#\~/$HOME}"
  if [ ! -e "${p}" ]; then
    continue
  fi
  abs="$(cd "$(dirname "${p}")" && pwd -P)/$(basename "${p}")"
  case "${STAGE_DIR}/" in
    "${abs%/}/"*)
      echo "::error::Artifact path ${abs} contains the stage directory ${STAGE_DIR}" >&2
      exit 1
      ;;
  esac
  dest="${STAGE_DIR}${abs}"
  mkdir -p "$(dirname "${dest}")"
  # -R does not follow symlinks inside the tree, -H follows <path> itself if it is a link
  cp -RH "${abs}" "${dest}"
  staged=$((staged + 1))
done

if [ "${staged}" -eq 0 ]; then
  echo "No artifact paths to redact"
  exit 0
fi

dropped="$(find "${STAGE_DIR}" ! -type f ! -type d -print)"
if [ -n "${dropped}" ]; then
  echo "Dropping symlinks and special files from the artifact:"
  printf '%s\n' "${dropped}" | sed 's/^/  /'
  find "${STAGE_DIR}" ! -type f ! -type d -exec rm -f {} +
fi
# Copies keep the source modes; make sure the in-place rewrite below can replace every file
chmod -R u+rwX "${STAGE_DIR}"

echo "Redacting secrets in: ${STAGE_DIR}"

# A "token" for the shape-based patterns below stops at whitespace and at JSON/shell delimiters
# (quotes, backslash, comma, semicolon). A plain \S+ would swallow the rest of a minified JSON line
# (junie_output.json, session transcripts) and leave the artifact unparsable.
find "${STAGE_DIR}" -type f -print0 | xargs -0 -r perl -i -pe '
  BEGIN {
    # perl only *warns* when it cannot rewrite a file in place (Cannot do inplace edit ...) and
    # moves on with exit code 0, which would leave that file unredacted. Turn every warning
    # into a fatal error so the caller skips the upload.
    $SIG{__WARN__} = sub { die @_ };
    my %variants;
    for my $s (grep { length($_) } split /\n/, ($ENV{REDACT_SECRETS} // "")) {
      $variants{$s} = 1;
      # How the value looks inside JSON: escaped quote/backslash, optionally escaped "/" and
      # HTML-safe escapes (e.g. Gson writes "=" as =, which is common in base64 tokens)
      (my $json = $s) =~ s/(["\\])/\\$1/g;
      $variants{$json} = 1;
      (my $slash = $json) =~ s{/}{\\/}g;
      $variants{$slash} = 1;
      for my $base ($json, $slash) {
        (my $lower = $base) =~ s/([<>&=\x27])/sprintf("\\u%04x", ord($1))/ge;
        (my $upper = $base) =~ s/([<>&=\x27])/sprintf("\\u%04X", ord($1))/ge;
        $variants{$lower} = 1;
        $variants{$upper} = 1;
      }
    }
    # Longest first, so an escaped form is not partially consumed by a shorter variant
    @secrets = sort { length($b) <=> length($a) } keys %variants;
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
