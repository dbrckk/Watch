#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
script="$PWD/scripts/setup-watch-signing.sh"
bash -n "$script"
bash "$script" --help | grep -q 'NEVER overwrites an existing signing key'

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
mkdir -p "$tmp/mock-bin" "$tmp/home" "$tmp/data"

cat > "$tmp/mock-bin/gh" <<'MOCK'
#!/usr/bin/env bash
set -euo pipefail
case "$1 $2" in
  "auth status")
    [[ "${MOCK_NO_AUTH:-0}" == 0 ]] || exit 1
    ;;
  "repo view") [[ "$3" == "dbrckk/Watch" ]] ;;
  "secret set")
    name="$3"
    # Consume the bytes, never log or print them.
    [[ "$4 $5" == "--repo dbrckk/Watch" ]] || exit 9
    [[ "$(wc -c | tr -d ' ')" -gt 0 ]] || exit 8
    printf '%s\n' "$name" >> "$TEST_CALLS"
    ;;
  "secret list")
    printf '%s\n' WATCH_KEYSTORE_BASE64 WATCH_STORE_PASSWORD WATCH_KEY_ALIAS WATCH_KEY_PASSWORD
    ;;
  "workflow run")
    [[ "$3" == "android-release.yml" && "$4" == "--repo" &&
       "$5" == "dbrckk/Watch" && "$6" == "--ref" && "$7" == "main" &&
       "$8" == "-f" && "$9" == "version=v1.1.26-watch.2" ]] || exit 12
    printf 'release-dispatched\n' >> "$TEST_WORKFLOW_CALLS"
    ;;
  *) echo "Unexpected gh call" >&2; exit 11 ;;
esac
MOCK

cat > "$tmp/mock-bin/keytool" <<'MOCK'
#!/usr/bin/env bash
set -euo pipefail
action="$1"
if [[ "$action" == "-genkeypair" ]]; then
  while [[ "$#" -gt 0 ]]; do
    if [[ "$1" == "-keystore" ]]; then shift; key="$1"; break; fi
    shift
  done
  [[ -n "$key" && -n "${WATCH_SETUP_PASSWORD:-}" ]] || exit 3
  [[ ! -e "$key" ]] || exit 4
  printf 'mock PKCS12 keystore bytes' > "$key"
  echo generated >> "$TEST_KEYTOOL_CALLS"
elif [[ "$action" == "-list" ]]; then
  [[ "${WATCH_SETUP_PASSWORD:-}" == "correctpassword123" ]] || exit 5
else
  exit 6
fi
MOCK
chmod +x "$tmp/mock-bin/gh" "$tmp/mock-bin/keytool"
export PATH="$tmp/mock-bin:$PATH" HOME="$tmp/home" XDG_DATA_HOME="$tmp/data"
export TEST_CALLS="$tmp/secrets-sent.txt" TEST_KEYTOOL_CALLS="$tmp/key-generation.txt"
export TEST_WORKFLOW_CALLS="$tmp/workflow-dispatches.txt"
touch "$TEST_CALLS" "$TEST_KEYTOOL_CALLS" "$TEST_WORKFLOW_CALLS"

# Simulate Termux: initial password + confirmation, no secret values printed.
printf 'correctpassword123\ncorrectpassword123\n' | bash "$script" > "$tmp/output"
[[ "$(wc -l < "$TEST_CALLS")" -eq 4 ]]
[[ "$(wc -l < "$TEST_KEYTOOL_CALLS")" -eq 1 ]]
[[ -s "$tmp/data/watch-signing/watch-release.p12" ]]
[[ "$(stat -c %a "$tmp/data/watch-signing/watch-release.p12")" == 600 ]]
! grep -q 'correctpassword123' "$tmp/output"
echo "PASS initial private-key setup + four secrets"

# Reuse existing identity, never regenerate and only re-upload same secret set.
printf 'correctpassword123\n' | bash "$script" > "$tmp/output"
[[ "$(wc -l < "$TEST_CALLS")" -eq 8 ]]
[[ "$(wc -l < "$TEST_KEYTOOL_CALLS")" -eq 1 ]]
echo "PASS rerun preserves original signing key"

# A mistaken password must fail BEFORE modifying secrets.
if printf 'invalid-password\n' | bash "$script" > "$tmp/output" 2>&1; then
  echo "Incorrect password unexpectedly accepted" >&2
  exit 1
fi
[[ "$(wc -l < "$TEST_CALLS")" -eq 8 ]]
echo "PASS incorrect password does not alter GitHub secrets"

# Missing auth must fail before creating keys or uploading secrets.
export MOCK_NO_AUTH=1 XDG_DATA_HOME="$tmp/missing-auth"
if printf 'correctpassword123\ncorrectpassword123\n' | bash "$script" > "$tmp/output" 2>&1; then
  echo "Unauthenticated setup unexpectedly accepted" >&2
  exit 1
fi
[[ ! -e "$tmp/missing-auth/watch-signing/watch-release.p12" ]]
[[ "$(wc -l < "$TEST_CALLS")" -eq 8 ]]
echo "PASS unauthenticated setup fails closed"

# A refused backup confirmation must NEVER dispatch a signed APK.
unset MOCK_NO_AUTH
export XDG_DATA_HOME="$tmp/data"
printf 'correctpassword123\nNO\n' | bash "$script" --publish > "$tmp/output"
[[ ! -s "$TEST_WORKFLOW_CALLS" ]]
[[ "$(wc -l < "$TEST_KEYTOOL_CALLS")" -eq 1 ]]
echo "PASS no signed publication without verified key backup confirmation"

# A confirmed backup performs precisely one official workflow dispatch.
printf 'correctpassword123\nBACKUP\n' | bash "$script" --publish > "$tmp/output"
[[ "$(wc -l < "$TEST_WORKFLOW_CALLS")" -eq 1 ]]
[[ "$(wc -l < "$TEST_KEYTOOL_CALLS")" -eq 1 ]]
! grep -q 'correctpassword123' "$tmp/output"
echo "PASS confirmed backup dispatches official signed release only once"
