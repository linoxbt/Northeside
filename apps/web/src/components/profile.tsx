"use client";

import { identityAbi } from "@northeside/chain";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import type { Hex } from "viem";
import { usePublicClient, useWriteContract } from "wagmi";
import { SignInPanel } from "./sign-in";
import { Button, Card, Pill } from "./ui";
import { api, track } from "@/lib/client/api";
import { chain, publicEnv, short } from "@/lib/client/env";
import { useSession, useSignIn } from "@/lib/client/session";

function urlB64ToUint8Array(base64: string) {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

export function Profile() {
  const session = useSession();
  const qc = useQueryClient();
  const { signOut } = useSignIn();
  const user = session.data?.user;
  const [name, setName] = useState("");
  const [qieId, setQieId] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const publicClient = usePublicClient({ chainId: chain.id });
  const { writeContractAsync } = useWriteContract();

  useEffect(() => {
    if (user) {
      setName(user.displayName ?? "");
      setQieId(user.qieId ?? "");
    }
  }, [user]);

  // Back from QIE Pass: submit the attestation from the player's own wallet.
  useEffect(() => {
    if (!user || new URLSearchParams(location.search).get("verify") !== "sign") return;
    void finishVerification();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  if (!user) return <SignInPanel title="Sign in to see your profile" />;

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setErr(null);
    setMsg(null);
    try {
      await fn();
      setMsg(ok);
      await qc.invalidateQueries({ queryKey: ["session"] });
    } catch (e) {
      setErr(e instanceof Error ? e.message.split("\n")[0]! : String(e));
    }
  };

  async function finishVerification() {
    await run(async () => {
      const att = await api<{ alreadyVerified?: boolean; identityAddress: Hex; wallet: Hex; personHash: Hex; deadline: string; signature: Hex }>(
        "/api/v1/identity/attestation",
      );
      if (att.alreadyVerified) return;
      const hash = await writeContractAsync({
        address: publicEnv.identity,
        abi: identityAbi,
        functionName: "submitAttestation",
        args: [att.wallet, att.personHash, BigInt(att.deadline), att.signature],
        chainId: chain.id,
      });
      await publicClient?.waitForTransactionReceipt({ hash });
      track("verification_completed");
      history.replaceState(null, "", "/me");
    }, "Verified. Your badge appears once the chain is indexed.");
  }

  async function enablePush() {
    await run(async () => {
      if (!("serviceWorker" in navigator) || !publicEnv.vapidKey) throw new Error("Web push is not available here");
      const reg = await navigator.serviceWorker.register("/sw.js");
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlB64ToUint8Array(publicEnv.vapidKey) });
      await api("/api/v1/notifications", { method: "POST", json: { webPush: sub.toJSON() } });
    }, "Browser reminders on");
  }

  return (
    <div className="space-y-4">
      <Card className="space-y-3">
        <div className="flex items-center justify-between">
          <h1 className="display text-[36px] sm:text-[44px]">Your profile</h1>
          {session.data?.verified ? <Pill tone="good">✓ Verified human</Pill> : <Pill>Not verified</Pill>}
        </div>
        <p className="text-[15px] leading-6 text-muted">Signed in as {short(session.data!.wallet!)}</p>
        <label className="block text-sm">
          <span className="text-[14px] text-muted">Display name</span>
          <input value={name} maxLength={24} onChange={(e) => setName(e.target.value)} className="mt-1.5 min-h-12 w-full rounded-xl border border-line-strong bg-white px-4 text-[16px] outline-none focus:border-ink" />
        </label>
        <label className="block text-sm">
          <span className="text-[14px] text-muted">QIE ID (e.g. lino.qie), shown as self-reported until it can be checked</span>
          <input value={qieId} maxLength={40} onChange={(e) => setQieId(e.target.value.toLowerCase())} className="mt-1.5 min-h-12 w-full rounded-xl border border-line-strong bg-white px-4 text-[16px] outline-none focus:border-ink" />
        </label>
        <Button
          onClick={() =>
            void run(
              () => api("/api/v1/profile", { method: "POST", json: { ...(name.trim().length >= 2 ? { displayName: name.trim() } : {}), qieId: qieId.trim() ? qieId.trim() : null } }),
              "Saved",
            )
          }
        >
          Save
        </Button>
      </Card>

      <Card className="space-y-2">
        <h2 className="text-[20px] tracking-[-0.02em]">Get verified with QIE Pass</h2>
        <p className="text-[15px] leading-6 text-muted">A verified badge shows you are one real person. It is what sponsors pay your host for. Northeside stores only an encrypted reference, never your documents.</p>
        {session.data?.verified ? null : (
          <Button variant="ghost" onClick={() => { track("verification_started"); location.href = "/api/v1/identity/start"; }}>Get verified</Button>
        )}
      </Card>

      <Card className="space-y-2">
        <h2 className="text-[20px] tracking-[-0.02em]">Reminders</h2>
        <p className="text-[15px] leading-6 text-muted">24 hours and 2 hours before each lock, and when results are in.</p>
        <div className="flex flex-wrap gap-2">
          {publicEnv.telegramBot ? (
            <Button variant="ghost" onClick={() => void run(async () => { const { url } = await api<{ url: string }>("/api/v1/telegram/link"); window.open(url, "_blank"); }, "Open Telegram and press Start")}>Telegram</Button>
          ) : null}
          {publicEnv.vapidKey ? <Button variant="ghost" onClick={() => void enablePush()}>Browser notifications</Button> : null}
          {user.emailVerified ? (
            <Button variant="ghost" onClick={() => void run(() => api("/api/v1/notifications", { method: "POST", json: { emailOptIn: true } }), "Email reminders on")}>Email</Button>
          ) : null}
          <Button variant="ghost" onClick={() => void run(() => api("/api/v1/notifications", { method: "POST", json: { remindLock: false, remindResults: false, emailOptIn: false, webPush: null, telegram: false } }), "All reminders off")}>Turn all off</Button>
        </div>
      </Card>

      <Card className="space-y-2">
        <h2 className="text-[20px] tracking-[-0.02em]">Your data</h2>
        <p className="text-[15px] leading-6 text-muted">Export your sealed picks from each matchweek page. Deleting your account removes your email, name and identity reference. On-chain commitments stay, unlinked from you.</p>
        <div className="flex flex-wrap gap-2">
          <Button variant="ghost" onClick={() => void signOut()}>Sign out</Button>
          <Button
            variant="danger"
            onClick={() => {
              if (prompt("Type DELETE to erase your account") !== "DELETE") return;
              void run(async () => {
                await api("/api/v1/account/delete", { method: "POST", json: { confirm: "DELETE" } });
                location.href = "/";
              }, "Deleted");
            }}
          >
            Delete account
          </Button>
        </div>
      </Card>
      {msg ? <p role="status" className="text-sm text-accent-deep">{msg}</p> : null}
      {err ? <p role="alert" className="text-sm text-bad">{err}</p> : null}
    </div>
  );
}
