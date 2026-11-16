# Northeside for Android

A Trusted Web Activity (TWA): the app opens https://northeside.netlify.app full-screen in the
phone's Chrome engine. Sign-in, wallets, sealing and push work exactly as on the web, and every web
deploy reaches the app at once; a new APK is only needed to change the icon, name, colours or host.

- Package: `com.northeside.app` · min Android 7.0 (API 24) · target API 35
- Library: `com.google.androidbrowserhelper:androidbrowserhelper`
- Verification: the site serves `/.well-known/assetlinks.json` with the signing certificate's
  SHA-256. If it does not match, Android shows a browser bar at the top of the app.

## Build

Needs JDK 17+ and the Android SDK (platform 36, build-tools 36).

```bash
cd mobile/android
echo "sdk.dir=$ANDROID_HOME" > local.properties
NS_KEYSTORE=/secure/path/northeside-release.jks \
NS_KEYSTORE_PASSWORD=... \
./gradlew assembleRelease
# -> app/build/outputs/apk/release/app-release.apk
```

The release key is **never** committed (`*.jks` is ignored). Keep it and its password safe and
backed up: every future update must be signed with the same key, or phones refuse to update the
installed app.

## Release a new version

1. Bump `versionCode` and `versionName` in `app/build.gradle.kts`.
2. Build as above, then copy the APK to `apps/web/public/downloads/northeside-<version>.apk`.
3. Update `apps/web/src/lib/app-release.ts` (version, file, size, `sha256sum` of the APK).
4. Deploy the web app. The download page at `/app` serves the new file.

Launch tests (Robolectric, no device needed): `./gradlew testReleaseUnitTest`. They open the
launcher on Android 7 and 14 with no browser, a browser without TWA support (the site must open
inside the app) and Chrome (picked to open the site full-screen).

Check a build: `apksigner verify --print-certs app/build/outputs/apk/release/app-release.apk`
(the certificate SHA-256 must equal the one in `assetlinks.json`).
