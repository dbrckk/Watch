#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
gate="$PWD/scripts/verify-android-release.sh"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
mkdir -p "$tmp/bin" "$tmp/buildtools"
printf 'new test apk\n' > "$tmp/new.apk"
printf 'prior test apk\n' > "$tmp/previous.apk"

cat > "$tmp/buildtools/apksigner" <<'MOCK'
#!/usr/bin/env bash
set -euo pipefail
path="${@: -1}"
if [[ "$path" != "$MOCK_NEW_APK" ]]; then digest="${OLD_DIGEST:-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa}"
else digest="${NEW_DIGEST:-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa}"; fi
[[ "${MOCK_INVALID_SIGNATURE:-0}" != 1 ]] || exit 2
echo "Signer #1 certificate SHA-256 digest: $digest"
MOCK
cat > "$tmp/buildtools/aapt" <<'MOCK'
#!/usr/bin/env bash
set -euo pipefail
path="${@: -1}"
if [[ "$path" != "$MOCK_NEW_APK" ]]; then
  code="${OLD_CODE:-36}"; version="1.1.26-watch.1"
else
  code="${NEW_CODE:-37}"; version="${NEW_VERSION:-1.1.26-watch.2}"
fi
echo "package: name='${PACKAGE_ID:-app.watch.fieldwatch}' versionCode='$code' versionName='$version' platformBuildVersionName='35'"
MOCK
cat > "$tmp/bin/gh" <<'MOCK'
#!/usr/bin/env bash
set -euo pipefail
if [[ "$1" == release && "$2" == list ]]; then
  [[ "${MOCK_GITHUB_UNAVAILABLE:-0}" != 1 ]] || exit 40
  printf '%s\n' "${PREVIOUS_TAG:-}"
elif [[ "$1" == release && "$2" == download ]]; then
  [[ "${MOCK_MISSING_APK:-0}" != 1 ]] || exit 42
  while [[ "$#" -gt 0 ]]; do
    if [[ "$1" == --dir ]]; then
      shift
      cp "$MOCK_PREVIOUS_APK" "$1/Watch-Fieldwatch-v1.1.26-watch.1.apk"
      exit 0
    fi
    shift
  done
  exit 51
else
  echo "Unexpected gh arguments: $*" >&2
  exit 52
fi
MOCK
chmod +x "$tmp/buildtools/apksigner" "$tmp/buildtools/aapt" "$tmp/bin/gh"
export PATH="$tmp/bin:$PATH" MOCK_PREVIOUS_APK="$tmp/previous.apk" MOCK_NEW_APK="$tmp/new.apk"
run() { bash "$gate" "$tmp/new.apk" "v1.1.26-watch.2" "$tmp/buildtools"; }
ok() {
  local description="$1"
  shift
  if ! ( export "$@"; run ) >"$tmp/output" 2>&1; then
    echo "FAIL $description (should have succeeded)" >&2
    cat "$tmp/output" >&2
    exit 1
  fi
  echo "PASS $description"
}
reject() {
  local description="$1"
  shift
  if ( export "$@"; run ) >"$tmp/output" 2>&1; then
    echo "FAIL $description (should have rejected)" >&2
    cat "$tmp/output" >&2
    exit 1
  fi
  echo "PASS $description"
}

ok "first release without prior APK" PREVIOUS_TAG=""
ok "same signing certificate and strictly newer versionCode" PREVIOUS_TAG="v1.1.26-watch.1"
reject "different signing key" PREVIOUS_TAG="v1.1.26-watch.1" NEW_DIGEST="bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
reject "reused versionCode" PREVIOUS_TAG="v1.1.26-watch.1" NEW_CODE=36
reject "lower versionCode" PREVIOUS_TAG="v1.1.26-watch.1" NEW_CODE=35
reject "wrong Android application ID" PREVIOUS_TAG="" PACKAGE_ID="app.fieldwatch"
reject "release version and APK version mismatch" PREVIOUS_TAG="" NEW_VERSION="1.1.26-watch.99"
reject "invalid candidate signature" PREVIOUS_TAG="" MOCK_INVALID_SIGNATURE=1
reject "GitHub API inaccessible" MOCK_GITHUB_UNAVAILABLE=1
reject "prior signed artifact unavailable" PREVIOUS_TAG="v1.1.26-watch.1" MOCK_MISSING_APK=1
echo "All signed release compatibility checks passed."
