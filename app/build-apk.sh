#!/usr/bin/env bash
#
# Builds the signed Shridhar Stock APK on this machine.
#
#   bash app/build-apk.sh
#
# This is a separate app from the billing app ("Simple Sales Book"). It has its own package,
# com.shridhar.stock, and its own signing key, so the two install side by side and neither can
# ever update over the other.
#
# What it needs, once:
#   - JDK 17 and the Android SDK, the same ones the billing build uses
#   - the key: C:/Users/hp/.keystores/shridhar-stock.jks, and beside it
#     shridhar-stock.properties with the four MYAPP_RELEASE_* lines. Both stay OUTSIDE the
#     repository. Lose them and no update can ever be installed over this app again; back them up.

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$HERE"

JAVA_HOME="${JAVA_HOME:-/c/Program Files/Eclipse Adoptium/jdk-17.0.20.101-hotspot}"
ANDROID_HOME="${ANDROID_HOME:-/c/android-sdk}"
SIGNING="${STOCK_SIGNING:-/c/Users/hp/.keystores/shridhar-stock.properties}"
export JAVA_HOME ANDROID_HOME
export ANDROID_SDK_ROOT="$ANDROID_HOME"
export PATH="$JAVA_HOME/bin:$PATH"

[ -x "$JAVA_HOME/bin/java" ] || { echo "No JDK at $JAVA_HOME -- set JAVA_HOME."; exit 1; }
[ -d "$ANDROID_HOME/platforms" ] || { echo "No Android SDK at $ANDROID_HOME -- set ANDROID_HOME."; exit 1; }
[ -f "$SIGNING" ] || { echo "No signing settings at $SIGNING -- see the top of this file."; exit 1; }

# Expo would otherwise treat the workspace root as the app root and look for the entry file in
# the wrong place (the billing repo's docs/building-the-apk.md tells that story).
export EXPO_NO_METRO_WORKSPACE_ROOT=1

# The shared rules are compiled first: the app imports @stock/core's build, not its source.
(cd .. && npm run build:core >/dev/null)

[ -d android ] || npx expo prebuild --platform android --no-install

# Keep the native version in step with app.json; prebuild only writes it once.
VERSION_CODE="$(node -p "require('./app.json').expo.android.versionCode")"
VERSION_NAME="$(node -p "require('./app.json').expo.version")"
sed -i -E "s/^([[:space:]]*)versionCode .*/\1versionCode $VERSION_CODE/" android/app/build.gradle
sed -i -E "s/^([[:space:]]*)versionName .*/\1versionName \"$VERSION_NAME\"/" android/app/build.gradle
echo "  version $VERSION_NAME ($VERSION_CODE)"

printf 'sdk.dir=%s\n' "$(cd "$ANDROID_HOME" && pwd -W 2>/dev/null || echo "$ANDROID_HOME")" > android/local.properties

# Signing, put back on every build: android/ is not kept in git, and a fresh prebuild signs
# release builds with the debug key, which is not something to hand a shop.
# Prebuild leaves no newline at the end of the file, and a key glued onto its last line is lost,
# so the file is rewritten: old signing lines out, one clean newline, then the four lines in.
node scripts/signing.js android/gradle.properties "$SIGNING"
node - <<'NODE'
const fs = require('fs');
const f = 'android/app/build.gradle';
let g = fs.readFileSync(f, 'utf8');
if (!g.includes('MYAPP_RELEASE_STORE_FILE')) {
  g = g.replace(
    /signingConfigs \{\s*debug \{/,
    `signingConfigs {
        release {
            storeFile file(MYAPP_RELEASE_STORE_FILE)
            storePassword MYAPP_RELEASE_STORE_PASSWORD
            keyAlias MYAPP_RELEASE_KEY_ALIAS
            keyPassword MYAPP_RELEASE_KEY_PASSWORD
        }
        debug {`,
  );
}
// Only the release block: the debug build keeps the debug key.
g = g.replace(/(release \{\s*\/\/[^\n]*\n(?:\s*\/\/[^\n]*\n)*\s*)signingConfig signingConfigs\.debug/, '$1signingConfig signingConfigs.release');
g = g.replace(/(buildTypes \{[\s\S]*?release \{[\s\S]*?)signingConfig signingConfigs\.debug/, '$1signingConfig signingConfigs.release');
fs.writeFileSync(f, g);
if (!/release \{[\s\S]*?signingConfig signingConfigs\.release/.test(g.slice(g.indexOf('buildTypes')))) {
  console.error('Could not point the release build at the release key.');
  process.exit(1);
}
NODE

cd android
./gradlew assembleRelease --no-daemon

APK="$HERE/android/app/build/outputs/apk/release/app-release.apk"
[ -f "$APK" ] || { echo "Gradle finished but produced no APK."; exit 1; }
OUT="$HERE/dist-apk/shridhar-stock-$VERSION_NAME-$VERSION_CODE.apk"
mkdir -p "$HERE/dist-apk"
cp "$APK" "$OUT"

echo
echo "  $OUT"
echo "  $(du -h "$OUT" | cut -f1)"
"$ANDROID_HOME/build-tools/35.0.0/apksigner.bat" verify --print-certs "$OUT" 2>/dev/null | grep "certificate DN" | head -1
echo
