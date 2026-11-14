"use client";

import { identityAbi } from "@northeside/chain";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import type { Hex } from "viem";
import { safeGas } from "@/lib/client/gas";
import { useAccount, usePublicClient, useSwitchChain, useWriteContract } from "wagmi";
import { txError } from "@/lib/client/tx-errors";
import { useAuthBridge } from "./auth-bridge";
import { PanelSkeleton, SignInPanel } from "./sign-in";
import { Button, Card, Pill } from "./ui";
import { api, track } from "@/lib/client/api";
import { chain, publicEnv, short } from "@/lib/client/env";
import { useSession } from "@/lib/client/session";
import { useSignIn } from "@/lib/client/sign-in-hooks";

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
  const { chainId } = useAccount();
  const { switchChainAsync } = useSwitchChain();
  const bridge = useAuthBridge();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteText, setDeleteText] = useState("");

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

  if (session.isLoading) return <PanelSkeleton />;
  if (!user) return <SignInPanel title="Sign in to see your profile" />;
  const wallets = session.data?.wallets ?? [];

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setErr(null);
    setMsg(null);
    try {
      await fn();
      setMsg(ok);
      await qc.invalidateQueries({ queryKey: ["session"] });
    } catch (e) {
      setErr(txError(e));
    }
  };

  async function finishVerification() {
    await run(async () => {
      const att = await api<{ alreadyVerified?: boolean; identityAddress: Hex; wallet: Hex; personHash: Hex; deadline: string; signature: Hex }>(
        "/api/v1/identity/attestation",
      );
      if (att.alreadyVerified) return;
      if (chainId !== chain.id) await switchChainAsync({ chainId: chain.id });
      const attArgs = [att.wallet, att.personHash, BigInt(att.deadline), att.signature] as const;
      const estimate = await publicClient
        ?.estimateContractGas({ address: publicEnv.identity, abi: identityAbi, functionName: "submitAttestation", args: attArgs, account: att.wallet })
        .catch(() => null);
      const hash = await writeContractAsync({
        address: publicEnv.identity,
        abi: identityAbi,
        functionName: "submitAttestation",
        args: attArgs,
        chainId: chain.id,
        gas: safeGas(estimate, 250_000n),
      });
      const receipt = await publicClient?.waitForTransactionReceipt({ hash, timeout: 90_000 });
      if (receipt && receipt.status !== "success") throw new Error("The verification transaction failed on-chain");
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
          <span className="text-[14px] text-muted">QIE ID (e.g. yourname.qie), self-reported</span>
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
        <h2 className="text-[20px] tracking-[-0.02em]">Verified human (QIE Pass)</h2>
        {session.data?.verified ? null : session.data?.verificationAvailable ? (
          <Button variant="ghost" onClick={() => { track("verification_started"); location.href = "/api/v1/identity/start"; }}>Get verified</Button>
        ) : (
          // Spec 9.4: never offer or claim QIE Pass verification before a real one works on mainnet.
          <p className="rounded-xl bg-subtle px-4 py-3 text-[14px] leading-6 text-ink-2">
            Coming soon.
          </p>
        )}
      </Card>

      <Card className="space-y-3">
        <h2 className="text-[20px] tracking-[-0.02em]">Wallets</h2>
        <ul className="divide-y divide-line text-[15px]">
          {wallets.map((w) => (
            <li key={w.address} className="flex items-center justify-between gap-3 py-2">
              <span className="font-mono text-[13px]">{short(w.address)}</span>
              <span className="flex items-center gap-2">
                {w.address.toLowerCase() === session.data!.wallet!.toLowerCase() ? <Pill tone="ink">Signed in</Pill> : null}
                <Pill>{w.kind === "embedded" ? "Northeside wallet" : "External"}</Pill>
              </span>
            </li>
          ))}
        </ul>
        <div className="flex flex-wrap gap-2">
          {wallets.length < 3 ? (
            <a href="/sign-in?link=1&next=/me" className="inline-flex min-h-11 items-center rounded-full border border-line px-5 text-[15px] font-medium hover:border-line-strong">
              Link another wallet
            </a>
          ) : null}
          {bridge.privyEnabled && bridge.embeddedAddress ? (
            <Button variant="ghost" onClick={() => void run(() => bridge.exportWallet(), "Wallet export opened")}>
              Export my Northeside wallet
            </Button>
          ) : null}
        </div>
        <p className="text-[13px] leading-5 text-muted">Up to 3 wallets count as one person.</p>
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
        <div className="flex flex-wrap gap-2">
          <Button variant="ghost" onClick={() => void signOut()}>Sign out</Button>
          {confirmDelete ? null : (
            <Button variant="danger" onClick={() => setConfirmDelete(true)}>
              Delete account
            </Button>
          )}
        </div>
        {confirmDelete ? (
          // In-page confirmation: window.prompt is blocked in some in-app browsers (Telegram).
          <div className="space-y-2 rounded-xl border border-bad/30 p-4">
            <label className="block text-[14px]">
              Type <b>DELETE</b> to erase your account
              <input value={deleteText} onChange={(e) => setDeleteText(e.target.value)} className="mt-1.5 min-h-11 w-full rounded-xl border border-line-strong bg-white px-4 text-[16px] outline-none focus:border-ink" />
            </label>
            <div className="flex gap-2">
              <Button
                variant="danger"
                disabled={deleteText !== "DELETE"}
                onClick={() =>
                  void run(async () => {
                    await api("/api/v1/account/delete", { method: "POST", json: { confirm: "DELETE" } });
                    // Nothing of this account stays on this device either.
                    await bridge.logout().catch(() => {});
                    for (const k of Object.keys(localStorage)) if (k.startsWith("ns_")) localStorage.removeItem(k);
                    setTimeout(() => (location.href = "/"), 1500);
                  }, "Your account is deleted. Taking you home…")
                }
              >
                Delete for good
              </Button>
              <Button variant="ghost" onClick={() => { setConfirmDelete(false); setDeleteText(""); }}>
                Cancel
              </Button>
            </div>
          </div>
        ) : null}
      </Card>
      {msg ? <p role="status" className="text-sm text-accent-deep">{msg}</p> : null}
      {err ? <p role="alert" className="text-sm text-bad">{err}</p> : null}
    </div>
  );
}
