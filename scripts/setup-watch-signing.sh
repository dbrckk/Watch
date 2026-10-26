#!/usr/bin/env bash
# One-time local Watch Android release signing setup (Android Termux or PC).
# This script never prints keystore bytes, passwords, or secret values.
set +x
set -euo pipefail
umask 077

repo="dbrckk/Watch"
key_alias="watch-release"
release_version="v1.1.26-watch.2"
launch_release=false
signing_dir="${XDG_DATA_HOME:-$HOME/.local/share}/watch-signing"
keystore="$signing_dir/watch-release.p12"

if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
  cat <<'HELP'
Set up the independent Watch Fieldwatch Android signing key.
Requirements: GitHub CLI (gh), JDK 17 (keytool), coreutils.
Log in first: gh auth login
Usage: bash scripts/setup-watch-signing.sh [--publish]
This command creates or reuses a private PKCS12 keystore on your device and
uploads four encrypted Actions secrets to dbrckk/Watch.
By default, it NEVER publishes an APK and NEVER overwrites an existing signing key.
--publish asks you to confirm your offline backup before dispatching the
official GitHub release workflow. No release is dispatched without confirmation.
Keep an offline backup of the .p12 file and its password.
HELP
  exit 0
fi
if [[ "$#" -eq 1 && "$1" == "--publish" ]]; then
  launch_release=true
elif [[ "$#" -ne 0 ]]; then
  echo "Unknown argument. Use --help." >&2
  exit 2
fi

for command_name in gh keytool base64 tr; do
  command -v "$command_name" >/dev/null 2>&1 || {
    echo "Missing $command_name. Termux: pkg install gh openjdk-17 coreutils" >&2
    exit 1
  }
done
gh auth status >/dev/null 2>&1 || {
  echo "GitHub CLI is not authenticated. Run: gh auth login" >&2
  exit 1
}
gh repo view "$repo" >/dev/null 2>&1 || {
  echo "Cannot access $repo with your GitHub CLI account." >&2
  exit 1
}

mkdir -p "$signing_dir"
chmod 700 "$signing_dir"
if [[ -e "$keystore" && ! -f "$keystore" ]]; then
  echo "Signing path exists but is not a regular file. Refusing to continue." >&2
  exit 1
fi

if [[ ! -e "$keystore" ]]; then
  echo "Generating a NEW private signing identity in: $keystore"
  read -r -s -p "Choose a strong signing password (12 characters minimum): " signing_password
  printf '\n'
  read -r -s -p "Repeat signing password: " confirmation
  printf '\n'
  [[ "$signing_password" == "$confirmation" && "${#signing_password}" -ge 12 ]] || {
    unset signing_password confirmation
    echo "Passwords differ or are too short. Nothing uploaded." >&2
    exit 1
  }
  unset confirmation
  export WATCH_SETUP_PASSWORD="$signing_password"
  # The password is supplied via a private subprocess environment, not argv.
  keytool -genkeypair -noprompt -storetype PKCS12 \
    -keystore "$keystore" \
    -storepass:env WATCH_SETUP_PASSWORD -keypass:env WATCH_SETUP_PASSWORD \
    -alias "$key_alias" -keyalg RSA -keysize 3072 -validity 3650 \
    -dname "CN=Watch Fieldwatch, OU=Watch, O=Independent, C=FR" >/dev/null
  [[ -s "$keystore" ]] || { echo "Signing key creation failed." >&2; exit 1; }
  chmod 600 "$keystore"
else
  echo "Reusing existing private keystore. The signing identity will NOT be regenerated."
  read -r -s -p "Enter your existing signing password: " signing_password
  printf '\n'
  export WATCH_SETUP_PASSWORD="$signing_password"
fi

# Verify the password + alias before touching GitHub secrets.
if ! keytool -list -storetype PKCS12 -keystore "$keystore" \
  -storepass:env WATCH_SETUP_PASSWORD -alias "$key_alias" >/dev/null 2>&1; then
  unset WATCH_SETUP_PASSWORD signing_password
  echo "Keystore password or alias is invalid; GitHub secrets were not modified." >&2
  exit 1
fi

echo "Uploading encrypted Actions secrets to $repo (values are never displayed)..."
base64 < "$keystore" | tr -d '\r\n' | gh secret set WATCH_KEYSTORE_BASE64 --repo "$repo"
printf '%s' "$signing_password" | gh secret set WATCH_STORE_PASSWORD --repo "$repo"
printf '%s' "$key_alias" | gh secret set WATCH_KEY_ALIAS --repo "$repo"
printf '%s' "$signing_password" | gh secret set WATCH_KEY_PASSWORD --repo "$repo"
unset WATCH_SETUP_PASSWORD signing_password

# GitHub displays only secret names and timestamps; never the values.
names="$(gh secret list --repo "$repo" --json name --jq '.[].name')"
for name in WATCH_KEYSTORE_BASE64 WATCH_STORE_PASSWORD WATCH_KEY_ALIAS WATCH_KEY_PASSWORD; do
  if ! printf '%s\n' "$names" | grep -Fxq "$name"; then
    echo "Secret $name could not be verified. Re-run this script." >&2
    exit 1
  fi
done
echo "All four GitHub Actions secret names are present."
echo "IMPORTANT: Make an offline backup of this file: $keystore"
echo "Store its PASSWORD separately; losing either blocks future app upgrades."
echo "Version: $release_version"
if [[ "$launch_release" != true ]]; then
  echo "Next: Actions -> Signed Watch Android release -> Run workflow on main."
  echo "To dispatch after backing up the key, rerun with --publish (using the SAME keystore)."
  exit 0
fi

# Key material is only retained on this device and in encrypted Actions secrets.
# Publishing without a separate backup risks permanently stranding upgrades.
echo "A signed APK can be published only after the private keystore is backed up."
echo "Backup required: $keystore (keep the password in a separate location)."
read -r -p 'Type BACKUP to confirm a separate, verified backup exists: ' backup_check
if [[ "$backup_check" != "BACKUP" ]]; then
  echo "No release dispatched. Your signing key and GitHub secrets are intact."
  exit 0
fi
unset backup_check

echo "Dispatching signed Android release $release_version from main..."
if ! gh workflow run android-release.yml --repo "$repo" --ref main -f "version=$release_version"; then
  echo "Workflow dispatch failed. Secrets remain configured." >&2
  echo "Try manually: https://github.com/$repo/actions/workflows/android-release.yml" >&2
  exit 1
fi
echo "Release requested; GitHub Actions will still verify tests, signing and version."
echo "Progress: https://github.com/$repo/actions/workflows/android-release.yml"
echo "Download after successful publication: https://github.com/$repo/releases"
