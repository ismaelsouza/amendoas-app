#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

sdk="${ANDROID_SDK_ROOT:?Configure ANDROID_SDK_ROOT}"
platform="$sdk/platforms/android-35/android.jar"
tools="${ANDROID_BUILD_TOOLS_DIR:-$sdk/build-tools/35.0.0}"
variant="${1:-piloto}"
case "$variant" in
  piloto)
    output="${PILOT_APK_PATH:-$PWD/dist/amendoas-piloto.apk}"
    keystore="${PILOT_KEYSTORE:?Configure PILOT_KEYSTORE com o caminho da chave do piloto}"
    : "${PILOT_STORE_PASS:?Configure PILOT_STORE_PASS}"
    alias="${PILOT_KEY_ALIAS:-amendoas-piloto}"
    pass_var=PILOT_STORE_PASS
    manifest=android/AndroidManifest.xml
    source=android/src/MainActivity.java
    ;;
  homologacao)
    output="${HOMOLOG_APK_PATH:-$PWD/dist/amendoas-homologacao.apk}"
    keystore="${HOMOLOG_APK_KEYSTORE:?Configure HOMOLOG_APK_KEYSTORE com o caminho da chave de homologação}"
    : "${HOMOLOG_APK_STORE_PASS:?Configure HOMOLOG_APK_STORE_PASS}"
    alias="${HOMOLOG_APK_KEY_ALIAS:-amendoas-homologacao}"
    pass_var=HOMOLOG_APK_STORE_PASS
    manifest=android/homologacao/AndroidManifest.xml
    source=android/homologacao/MainActivity.java
    ;;
  *) echo "Variante de APK desconhecida: $variant" >&2; exit 1 ;;
esac
if [[ ! -f "$platform" || ! -x "$tools/apksigner" ]]; then
  echo "Instale a plataforma Android 35 e os Build Tools 35.0.0." >&2
  exit 1
fi

work="$(mktemp -d)"
trap 'rm -r -- "$work"' EXIT
mkdir -p "$work/classes" "$work/dex" "$work/assets" "$(dirname "$output")"
if [[ "$variant" == homologacao ]]; then
  npm run build:apk:web
  cp dist/android-homologacao/{index.html,mobile.css,acompanhamento.js} "$work/assets/"
else
  npm run build
  mkdir "$work/assets/js"
  cp android/web/index.html android/web/mobile.css "$work/assets/"
  ./node_modules/.bin/esbuild dist/mobile-ui.js --bundle --format=esm --target=chrome92 \
    --outfile="$work/assets/js/mobile-ui.js"
fi
javac -encoding UTF-8 --release 8 -classpath "$platform" -d "$work/classes" "$source"
mapfile -d '' classes < <(find "$work/classes" -name '*.class' -type f -print0)
"$tools/d8" --min-api 26 --lib "$platform" --output "$work/dex" "${classes[@]}"
"$tools/aapt" package -f -M "$manifest" -S android/res -A "$work/assets" -I "$platform" -F "$work/unsigned.apk"
(cd "$work/dex" && "$tools/aapt" add "$work/unsigned.apk" classes.dex)
"$tools/zipalign" -f 4 "$work/unsigned.apk" "$work/aligned.apk"
"$tools/apksigner" sign --ks "$keystore" --ks-key-alias "$alias" \
  --ks-pass "env:$pass_var" --v4-signing-enabled false --out "$output" "$work/aligned.apk"
"$tools/apksigner" verify --print-certs "$output"
