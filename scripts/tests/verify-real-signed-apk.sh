#!/usr/bin/env bash
# End-to-end signing probe: a fresh disposable key, never an official release.
set -euo pipefail
cd "$(dirname "$0")/../.."
sdk="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-}}"
[[ -n "$sdk" ]] || { echo "::error::Android SDK missing" >&2; exit 1; }
tools="$sdk/build-tools/35.0.0"
[[ -x "$tools/apksigner" && -x "$tools/aapt" ]] || {
  echo "::error::Android build tools 35.0.0 missing" >&2; exit 1;
}
command -v openssl >/dev/null
command -v keytool >/dev/null
base="${RUNNER_TEMP:-/tmp}"
tmp="$(mktemp -d "$base/watch-ci-signer-XXXXXXXX")"
trap 'rm -rf "$tmp"' EXIT
umask 077
secret="$(openssl rand -hex 24)"
keystore="$tmp/ephemeral.p12"
alias_name="watch-ci-never-publish"
keytool -genkeypair -noprompt -storetype PKCS12 -keystore "$keystore" \
  -storepass "$secret" -keypass "$secret" -alias "$alias_name" \
  -keyalg RSA -keysize 3072 -validity 2 \
  -dname "CN=Watch CI Signing Test, O=Never Publish, C=FR" >/dev/null 2>&1

[[ -s "$keystore" ]] || { echo "::error::Temporary signer creation failed" >&2; exit 1; }
WATCH_KEYSTORE_FILE="$keystore" WATCH_STORE_PASSWORD="$secret" \
WATCH_KEY_ALIAS="$alias_name" WATCH_KEY_PASSWORD="$secret" \
./gradlew --no-daemon assembleRelease --stacktrace

apk="app/build/outputs/apk/release/app-release.apk"
[[ -s "$apk" ]] || { echo "::error::Signed release APK missing" >&2; exit 1; }
sign="$("$tools/apksigner" verify --verbose --print-certs "$apk")" ||
  { echo "::error::APK signature invalid" >&2; exit 1; }
printf '%s\n' "$sign" | grep -q '^Verified using v2 scheme (APK Signature Scheme v2): true$' ||
  { echo "::error::Missing v2 APK signature" >&2; exit 1; }
fingerprint="$(printf '%s\n' "$sign" |
  sed -nE 's/^Signer #[0-9]+ certificate SHA-256 digest: ([[:xdigit:]]{64})$/\1/p')"
[[ "$fingerprint" =~ ^[[:xdigit:]]{64}$ ]] || {
  echo "::error::Cannot read signing certificate digest" >&2; exit 1;
}
key_fingerprint="$(
  keytool -exportcert -keystore "$keystore" -storepass "$secret" -alias "$alias_name" 2>/dev/null |
  openssl x509 -inform DER -noout -fingerprint -sha256 |
  sed -E 's/^[^=]*=//' | tr -d ':' | tr '[:upper:]' '[:lower:]'
)"
[[ "$fingerprint" == "$key_fingerprint" ]] || {
  echo "::error::Signer identity mismatch" >&2; exit 1;
}
badging="$("$tools/aapt" dump badging "$apk")"
package="$(printf '%s\n' "$badging" | sed -n '1p')"
[[ "$package" == *"name='app.watch.fieldwatch'"* ]] || {
  echo "::error::Unexpected Android package" >&2; exit 1;
}
expected_name="$(sed -nE 's/^[[:space:]]*versionName[[:space:]]*=[[:space:]]*"([^"]+)".*$/\1/p' app/build.gradle.kts)"
expected_code="$(sed -nE 's/^[[:space:]]*versionCode[[:space:]]*=[[:space:]]*([0-9]+).*$/\1/p' app/build.gradle.kts)"
[[ -n "$expected_name" && -n "$expected_code" ]] || {
  echo "::error::No Gradle version metadata" >&2; exit 1;
}
[[ "$package" == *"versionName='$expected_name'"* && "$package" == *"versionCode='$expected_code'"* ]] || {
  echo "::error::APK and Gradle versions disagree" >&2; exit 1;
}
echo "PASS: real optimized APK signature, certificate, package and version verified."
echo "Test key will be deleted. This APK is NOT an official signed release."
