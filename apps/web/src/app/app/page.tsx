import type { Metadata } from "next";
import { InstallOptions } from "@/components/install-app";
import { Container } from "@/components/ui";
import { ANDROID_RELEASE } from "@/lib/app-release";

export const metadata: Metadata = {
  title: "Get the app",
  description: "Install Northeside on your phone: the Android app, or add it to your iPhone home screen. Free.",
};

/** Download page for the Android app (APK) and home-screen install on iPhone. */
export default function AppPage() {
  return (
    <Container className="pb-24 pt-6 sm:pt-10">
      <div className="mx-auto max-w-lg space-y-4">
        <section className="overflow-hidden rounded-3xl bg-ink p-6 text-white">
          { }
          <img src="/icon-192.png" alt="" width={72} height={72} className="rounded-[18px]" />
          <h1 className="mt-4 text-[34px] font-medium leading-tight tracking-[-0.04em]">Northeside on your phone</h1>
          <p className="mt-2 text-[16px] text-white/70">Call the scores, seal them on QIE and follow every game live. Free, 18+.</p>
          <InstallOptions release={ANDROID_RELEASE} />
        </section>

        <section className="rounded-2xl border border-line bg-white p-5">
          <h2 className="text-[20px] tracking-[-0.02em]">Android: install in 3 steps</h2>
          <ol className="mt-3 space-y-3 text-[15px] leading-6">
            {[
              ["Download", `Tap “Download for Android” (${ANDROID_RELEASE.sizeMb} MB).`],
              ["Allow the install", "Open the file. If Android asks, allow your browser to install apps (Settings → Install unknown apps), then go back."],
              ["Install and play", "Tap Install, open Northeside and sign in with your email or wallet."],
            ].map(([t, b], i) => (
              <li key={t} className="grid grid-cols-[32px_1fr] gap-2">
                <span className="flex size-7 items-center justify-center rounded-full bg-accent font-mono text-[13px] text-accent-ink">{i + 1}</span>
                <span>
                  <b className="font-medium">{t}.</b> {b}
                </span>
              </li>
            ))}
          </ol>
          <p className="mt-4 rounded-xl bg-subtle px-3 py-2.5 text-[13px] leading-5 text-muted">
            Northeside is not on Google Play yet, so Android may warn that the app comes from outside the Play Store. Only install the file from this page.
          </p>
        </section>

        <section className="rounded-2xl border border-line bg-white p-5">
          <h2 className="text-[20px] tracking-[-0.02em]">iPhone: add to Home Screen</h2>
          <ol className="mt-3 space-y-2 text-[15px] leading-6">
            <li>1. Open this site in Safari.</li>
            <li>
              2. Tap the Share button (the square with an arrow), then <b className="font-medium">Add to Home Screen</b>.
            </li>
            <li>3. Open Northeside from your home screen. It runs full-screen like an app.</li>
          </ol>
        </section>

        <details className="rounded-2xl border border-line bg-white p-5 text-[13px] text-muted">
          <summary className="cursor-pointer text-[15px] text-ink">Check the download</summary>
          <dl className="mt-3 space-y-2 break-all font-mono text-[12px]">
            <div>
              <dt className="text-ink">Version</dt>
              <dd>
                {ANDROID_RELEASE.version} · {ANDROID_RELEASE.packageName} · Android {ANDROID_RELEASE.minAndroid}+
              </dd>
            </div>
            <div>
              <dt className="text-ink">File SHA-256</dt>
              <dd>{ANDROID_RELEASE.sha256}</dd>
            </div>
            <div>
              <dt className="text-ink">Signing certificate SHA-256</dt>
              <dd>{ANDROID_RELEASE.certSha256}</dd>
            </div>
          </dl>
          <p className="mt-3">The app opens this website full-screen (a Trusted Web Activity), so it always runs the latest version. The site publishes the same certificate at /.well-known/assetlinks.json.</p>
        </details>
      </div>
    </Container>
  );
}
