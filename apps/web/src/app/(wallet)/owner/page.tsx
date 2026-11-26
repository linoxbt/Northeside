import type { Metadata } from "next";
import { OwnerConsole } from "@/components/owner-console";

export const metadata: Metadata = { title: "Owner console", robots: { index: false, follow: false } };

/** Admin-wallet actions (docs/OWNER-ACTIONS.md). Not linked from the app; the contracts check every role. */
export default function OwnerPage() {
  return (
    <div className="mx-auto max-w-[720px] px-4 pb-24 pt-8 sm:px-6">
      <h1 className="text-[28px] font-medium tracking-[-0.02em]">Owner console</h1>
      <p className="mt-2 text-[15px] leading-6 text-muted">
        Fund the $NSD reward pool, set its cap and move the pause power, from the admin wallet. Each button sends a transaction your wallet asks you to
        confirm. This page holds no keys and grants no power: the contracts check every role.
      </p>
      <OwnerConsole />
    </div>
  );
}
