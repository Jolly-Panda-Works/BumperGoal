#!/usr/bin/env bash
set -euo pipefail

out="$GITHUB_WORKSPACE/out"
mkdir -p "$out"
prefix="$out/BumperGoal-$BUMPER_VERSION-$EDITION"
outputs=app/build/outputs
signer="$ANDROID_HOME/build-tools/35.0.0/apksigner"

if [[ "$EDITION" == debug ]]; then
  ./gradlew assembleDebug --no-daemon
  cp "$outputs/apk/debug/app-debug.apk" "$prefix.apk"
  "$signer" verify "$prefix.apk"
  exit 0
fi

signing=()
if [[ -n "$KEYSTORE_BASE64" ]]; then
  : "${KEYSTORE_PASSWORD:?Missing ANDROID_KEYSTORE_PASSWORD}"
  : "${KEY_ALIAS:?Missing ANDROID_KEY_ALIAS}"
  : "${KEY_PASSWORD:?Missing ANDROID_KEY_PASSWORD}"
  keystore=$(mktemp "$RUNNER_TEMP/bumper-goal.XXXXXX")
  trap 'rm -f "$keystore"' EXIT
  printf '%s' "$KEYSTORE_BASE64" | tr -d '[:space:]' | base64 --decode > "$keystore"
  signing=(
    "-Pandroid.injected.signing.store.file=$keystore"
    "-Pandroid.injected.signing.store.password=$KEYSTORE_PASSWORD"
    "-Pandroid.injected.signing.key.alias=$KEY_ALIAS"
    "-Pandroid.injected.signing.key.password=$KEY_PASSWORD"
  )
fi

./gradlew assembleRelease bundleRelease --no-daemon "${signing[@]}"
if (( ${#signing[@]} )); then
  cp "$outputs/apk/release/app-release.apk" "$prefix.apk"
  cp "$outputs/bundle/release/app-release.aab" "$prefix.aab"
  "$signer" verify "$prefix.apk"
  LC_ALL=C jarsigner -verify "$prefix.aab" | grep -F 'jar verified.'
else
  cp "$outputs/apk/release/app-release-unsigned.apk" "$prefix-unsigned.apk"
  cp "$outputs/bundle/release/app-release.aab" "$prefix-unsigned.aab"
fi
(cd "$out" && sha256sum *.apk *.aab > "$EDITION-SHA256SUMS.txt")
