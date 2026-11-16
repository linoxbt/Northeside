/** The current Android app release (Trusted Web Activity in mobile/android). Update with each build. */
export const ANDROID_RELEASE = {
  version: "1.0.0",
  file: "/downloads/northeside-1.0.0.apk",
  sizeMb: "3.8",
  packageName: "com.northeside.app",
  minAndroid: "7.0",
  /** sha256sum of the APK file. */
  sha256: "1e9992dd5a1f008f60085bbbb73fcf3dbd618bc2c8d505f206fa58c85e50f2b0",
  /** Signing certificate (also in /.well-known/assetlinks.json). */
  certSha256: "D6:76:94:5A:36:A0:D5:91:DE:91:F0:11:1C:14:76:3E:4B:D9:58:B9:31:34:E7:D3:64:17:D6:53:89:C2:12:9D",
} as const;
