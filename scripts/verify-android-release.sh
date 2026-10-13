#!/usr/bin/env bash
# Release gate: reject different signing keys or non-increasing Android versions.
# Usage: verify-android-release.sh APK RELEASE_TAG ANDROID_BUILD_TOOLS_DIR
set -euo pipefail

apk="${1:?APK path required}"
tag="${2:?Release tag required}"
android_tools="${3:?Android build tools directory required}"
expected_package="app.watch.fieldwatch"

fail() { echo "::error::$*" >&2; exit 1; }

[[ -s "$apk" ]] || fail "Candidate APK missing or empty."
[[ "$tag" =~ ^v[0-9]+\.[0-9]+\.[0-9]+-watch\.[0-9]+$ ]] || fail "Invalid release tag."
[[ -x "$android_tools/apksigner" && -x "$android_tools/aapt" ]] || fail "Android build tools missing."
command -v gh >/dev/null || fail "GitHub CLI not available."

# Reject multiple APK signers, validate cryptographic signatures and metadata.
inspect_apk() {
  local path="$1" signatures badging count digest package code version
  signatures="$("$android_tools/apksigner" verify --verbose --print-certs "$path")" ||
    fail "APK signature invalid: $(basename "$path")"
  count="$(printf '%s\n' "$signatures" | grep -Ec '^Signer #[0-9]+ certificate SHA-256 digest:' || true)"
  [[ "$count" == 1 ]] || fail "Expected exactly one APK signing certificate."
  digest="$(printf '%s\n' "$signatures" |
    sed -n -E 's/^Signer #[0-9]+ certificate SHA-256 digest: ([[:xdigit:]]{64})$/\1/p')"
  [[ "$digest" =~ ^[0-9a-fA-F]{64}$ ]] || fail "Invalid certificate fingerprint."
  badging="$("$android_tools/aapt" dump badging "$path")" || fail "Cannot inspect APK manifest."
  badging="${badging%%$'\n'*}"
  package="$(printf '%s\n' "$badging" | sed -n -E "s/.*name='([^']+)'.*/\1/p")"
  code="$(printf '%s\n' "$badging" | sed -n -E "s/.*versionCode='([0-9]+)'.*/\1/p")"
  version="$(printf '%s\n' "$badging" | sed -n -E "s/.*versionName='([^']+)'.*/\1/p")"
  [[ "$package" == "$expected_package" ]] || fail "Unexpected Android package: $package"
  [[ "$code" =~ ^[0-9]+$ && -n "$version" ]] || fail "Missing Android version metadata."
  printf '%s|%s|%s\n' "${digest,,}" "$code" "$version"
}

IFS='|' read -r new_digest new_code new_version < <(inspect_apk "$apk")
[[ "$new_version" == "${tag#v}" ]] || fail "APK versionName differs from release tag."
echo "New APK: package=$expected_package versionCode=$new_code versionName=$new_version certificate=$new_digest"

# A network/API failure is NOT equivalent to having no previous release.
previous_tag="$(gh release list --limit 100 --json tagName --jq '.[0].tagName // empty')" ||
  fail "Could not check previously published releases."
if [[ -n "$previous_tag" ]]; then
  [[ "$previous_tag" =~ ^v[0-9]+\.[0-9]+\.[0-9]+-watch\.[0-9]+$ ]] ||
    fail "Unexpected prior release tag: $previous_tag"
  temp_dir="$(mktemp -d)"
  trap 'rm -rf "$temp_dir"' EXIT
  gh release download "$previous_tag" --pattern 'Watch-Fieldwatch-*.apk' --dir "$temp_dir" ||
    fail "Failed to download prior signed APK."
  shopt -s nullglob
  previous_files=("$temp_dir"/Watch-Fieldwatch-*.apk)
  [[ "${#previous_files[@]}" == 1 ]] || fail "Prior release must contain exactly one Watch APK."
  IFS='|' read -r previous_digest previous_code previous_version < <(inspect_apk "${previous_files[0]}")
  [[ "$previous_version" == "${previous_tag#v}" ]] || fail "Previous versionName does not match tag."
  [[ "$new_digest" == "$previous_digest" ]] ||
    fail "Publisher certificate changed: existing Android users cannot upgrade."
  [[ "$((10#$new_code))" -gt "$((10#$previous_code))" ]] ||
    fail "versionCode must increase (previous=$previous_code new=$new_code)."
  echo "Upgrade compatible: versionCode $previous_code -> $new_code; signing key unchanged."
else
  echo "First signed release. Preserve this keystore for future updates."
fi

if [[ -n "${GITHUB_ENV:-}" ]]; then
  printf 'WATCH_RELEASE_CERT_SHA256=%s\nWATCH_RELEASE_VERSION_CODE=%s\n' \
    "$new_digest" "$new_code" >> "$GITHUB_ENV"
fi
