#!/usr/bin/env bash
# Hash-only cold check of a proof. Does not recompute Control Answers or authenticate the session.
# Requires jq and sha256sum.
set -euo pipefail
F=${1:-}
if [ -z "$F" ] || [ ! -f "$F" ]; then
  echo "Usage: scripts/coldcheck-proof.sh <NEVERHELD-proof.json>" >&2
  exit 2
fi
[ "$(jq -r 'keys | join(",")' "$F")" = "body,format,proofHash" ] || { echo "Unexpected proof envelope fields: NOT VALID"; exit 1; }
H=$(jq -er '.proofHash.value' "$F")
R=$(jq -cjS '.body' "$F" | sha256sum | cut -d' ' -f1)
echo "stated proof hash     : $H"
echo "recomputed proof hash : $R"
[ "$H" = "$R" ] && echo "proof: MATCH (hash unchanged)" || { echo "proof: MISMATCH (do not rely on it)"; exit 1; }
echo "release named         : $(jq -r '.body.release.id' "$F")"
echo "release file list     : $(jq -r '.body.release.manifestSha256' "$F")"
echo "page requests post-seal: $(jq -r '.body.seal.pageRequestsSinceSealing' "$F")"
echo "NOTE: this does not prove that the session occurred or verify Control Answers."
