"use client";

import { usePathname } from "next/navigation";
import { useMounted } from "@/lib/client/use-mounted";
import { useState } from "react";
import { Button, ButtonLink, Card } from "./ui";
import { api } from "@/lib/client/api";
import { isPreview } from "@/lib/client/env";
import { useSession } from "@/lib/client/session";
import { useQueryClient } from "@tanstack/react-query";

/**
 * Shown where a page needs a signed-in player. While the session is still loading it shows a
 * placeholder (no "Sign in" flash for signed-in players); otherwise it sends people to the
 * dedicated /sign-in page and back here afterwards (audit B14).
 */
export function SignInPanel({ title = "Sign in to play" }: { title?: string }) {
  const session = useSession();
  const pathname = usePathname();
  // The query string is read after mount (useSearchParams would force a Suspense boundary on
  // statically rendered pages such as /me).
  const mounted = useMounted();
  if (isPreview) return <LaunchingSoon title={title} />;
  if (session.isLoading) return <PanelSkeleton />;
  const here = `${pathname}${mounted ? window.location.search : ""}`;
  return (
    <Card className="space-y-5 p-6 sm:p-7">
      <div>
        <h2 className="text-[22px] tracking-[-0.03em]">{title}</h2>
        <p className="mt-1 text-[15px] text-muted">Email or wallet.</p>
      </div>
      <ButtonLink href={`/sign-in?next=${encodeURIComponent(here)}`} variant="primary" className="w-full" arrow>
        Sign in
      </ButtonLink>
      <p className="border-t border-line pt-4 font-mono text-[11px] uppercase tracking-[0.06em] text-muted">18+ · Free</p>
    </Card>
  );
}

export function PanelSkeleton() {
  return (
    <Card className="space-y-4 p-6 sm:p-7" aria-busy="true" aria-label="Loading">
      <div className="h-6 w-1/2 animate-pulse rounded bg-subtle" />
      <div className="h-4 w-3/4 animate-pulse rounded bg-subtle" />
      <div className="h-12 w-full animate-pulse rounded-full bg-subtle" />
    </Card>
  );
}

function LaunchingSoon({ title }: { title: string }) {
  return (
    <Card className="space-y-4 p-6 sm:p-7">
      <p className="eyebrow">Preview</p>
      <h2 className="text-[22px] tracking-[-0.03em]">{title.replace(/^Sign in to/, "Soon you can")}</h2>
      <p className="text-[15px] leading-6 text-muted">Opens with the first live matchweek.</p>
      <a href="/docs" className="inline-flex min-h-11 items-center gap-2 rounded-full border border-line-strong px-5 text-[15px] font-medium hover:bg-subtle">
        See how it works
      </a>
    </Card>
  );
}

/** Spec FR-34: 18+ confirmation before playing. */
export function AdultGate() {
  const session = useSession();
  const qc = useQueryClient();
  const [checked, setChecked] = useState(false);
  const [name, setName] = useState("");
  const [err, setErr] = useState<string | null>(null);
  if (!session.data?.user || session.data.user.adultConfirmed) return null;
  return (
    <Card className="space-y-4 border-ink">
      <h2 className="text-[22px] tracking-[-0.03em]">One more step</h2>
      <label className="block text-sm">
        <span className="text-[14px] text-muted">Display name (optional)</span>
        <input value={name} onChange={(e) => setName(e.target.value)} maxLength={24} className="mt-1.5 min-h-12 w-full rounded-xl border border-line-strong bg-white px-4 text-[16px] outline-none focus:border-ink" />
      </label>
      <label className="flex min-h-11 items-center gap-3 text-sm">
        <input type="checkbox" className="size-5" checked={checked} onChange={(e) => setChecked(e.target.checked)} />
        I am 18 or older and accept the <a href="/docs/terms" className="text-accent-deep underline">terms</a> and <a href="/docs/privacy" className="text-accent-deep underline">privacy notice</a>.
      </label>
      <Button
        disabled={!checked}
        onClick={async () => {
          try {
            await api("/api/v1/profile", { method: "POST", json: { adultConfirmed: true, ...(name.trim().length >= 2 ? { displayName: name.trim() } : {}) } });
            await qc.invalidateQueries({ queryKey: ["session"] });
          } catch (e) {
            setErr(e instanceof Error ? e.message : String(e));
          }
        }}
      >
        Continue
      </Button>
      {err ? <p className="text-sm text-bad">{err}</p> : null}
    </Card>
  );
}
