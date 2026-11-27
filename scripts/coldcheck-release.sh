#!/usr/bin/env bash
# Cold verification of the Ed25519 release signature and its signed self-asserted timestamp.
# Requires jq, sha256sum, base64 and openssl. Does not validate an RFC 3161 TSA trust chain.
set -euo pipefail
F=${1:-}
PUB=${2:-}
if [ -z "$F" ] || [ ! -f "$F" ]; then
  echo "Usage: scripts/coldcheck-release.sh <NEVERHELD-release-seal.json> [public_key_b64]" >&2
  exit 2
fi
if [ -z "$PUB" ]; then PUB=$(jq -er '.public_key_b64' "$(dirname "$0")/../release/release-public-key.json"); fi
[ -n "$PUB" ] || { echo "No NEVERHELD release public key is configured." >&2; exit 2; }
T=$(mktemp -d)
trap 'rm -rf "$T"' EXIT
H=$(jq -er '.content_hash.value' "$F")
R=$(jq -cjS '.record' "$F" | sha256sum | cut -d' ' -f1)
echo "stated record hash     : $H"
echo "recomputed record hash : $R"
[ "$H" = "$R" ] || { echo "record hash mismatch: NOT VALID"; exit 1; }
[ "$(jq -r '.seal_format_version' "$F")" = "2" ] || { echo "unsupported release seal format"; exit 1; }
[ "$(jq -r '.canonicalization' "$F")" = "RFC 8785 (JCS)" ] || { echo "unexpected canonicalisation"; exit 1; }
[ "$(jq -r '.signature.alg' "$F")" = "Ed25519" ] || { echo "unexpected signature algorithm"; exit 1; }
[ "$(jq -r '.signature.key_id' "$F")" = "$(jq -r '.record.key_id' "$F")" ] || { echo "signature key id does not match the signed record"; exit 1; }
[ "$(jq -r '.signature.signed_message' "$F")" = "content_hash.value (ASCII hex)" ] || { echo "unexpected signature message"; exit 1; }
{ printf '\x30\x2a\x30\x05\x06\x03\x2b\x65\x70\x03\x21\x00'; printf '%s' "$PUB" | tr '_-' '/+' | base64 -d; } > "$T/pub.der"
openssl pkey -pubin -inform DER -in "$T/pub.der" -out "$T/pub.pem" >/dev/null
printf '%s' "$H" > "$T/msg.txt"
jq -er '.signature.value_b64' "$F" | base64 -d > "$T/sig.bin"
echo -n "release signature      : "
openssl pkeyutl -verify -pubin -inkey "$T/pub.pem" -rawin -in "$T/msg.txt" -sigfile "$T/sig.bin"
TYPE=$(jq -r '.timestamps[0].type // empty' "$F")
[ "$TYPE" = "self-asserted" ] || { echo "no signed self-asserted timestamp in first timestamp slot"; exit 1; }
TS=$(jq -er '.timestamps[0].time' "$F")
jq -cjS '.timestamps[0] | {content_hash,key_id,time,type}' "$F" > "$T/ts.txt"
[ "$(jq -r '.timestamps[0].content_hash' "$F")" = "$H" ] || { echo "timestamp names a different hash"; exit 1; }
[ "$(jq -r '.timestamps[0].key_id' "$F")" = "$(jq -r '.record.key_id' "$F")" ] || { echo "timestamp key id does not match the release key"; exit 1; }
jq -er '.timestamps[0].signature_b64' "$F" | base64 -d > "$T/ts.bin"
echo -n "signed release time     : "
openssl pkeyutl -verify -pubin -inkey "$T/pub.pem" -rawin -in "$T/ts.txt" -sigfile "$T/ts.bin"
echo "release id              : $(jq -r '.record.release.id' "$F")"
echo "file manifest SHA-256   : $(jq -r '.record.release.manifest_sha256' "$F")"
echo "RFC 3161 token          : present-but-not-validated-by-this-script"
