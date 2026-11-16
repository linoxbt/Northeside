/** The current Android app release (Trusted Web Activity in mobile/android). Update with each build. */
export const ANDROID_RELEASE = {
  version: "1.0.2",
  file: "/downloads/northeside-1.0.2.apk",
  sizeMb: "3.8",
  packageName: "com.northeside.app",
  minAndroid: "7.0",
  /** sha256sum of the APK file. */
  sha256: "0f8f9ed2b4664a8dac62d7687dbdbe43d57aa7222164398367a69c7ae401560f",
  /** Signing certificate (also in /.well-known/assetlinks.json). */
  certSha256: "D6:76:94:5A:36:A0:D5:91:DE:91:F0:11:1C:14:76:3E:4B:D9:58:B9:31:34:E7:D3:64:17:D6:53:89:C2:12:9D",
} as const;
