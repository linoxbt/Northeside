"use client";

import { useEffect, useRef, useState } from "react";
import { useAccount, useConnect } from "wagmi";
import { useAuthBridge } from "./providers";
import { Button, Card } from "./ui";
import { api } from "@/lib/client/api";
import { chain, short } from "@/lib/client/env";
import { useSession, useSignIn } from "@/lib/client/session";
import { useQueryClient } from "@tanstack/react-query";

/** Email (Privy embedded wallet) or an EIP-6963 wallet, preferring QIE Wallet by rdns. */
export function SignInPanel({ title = "Sign in to play" }: { title?: string }) {
  const bridge = useAuthBridge();
  const { connectors, connectAsync, isPending } = useConnect();
  const { isConnected, address } = useAccount();
  const { signIn, error, pending } = useSignIn();
  const session = useSession();
  const wantSignIn = useRef(false);
  const [connectError, setConnectError] = useState<string | null>(null);

  // Never branch on isMetaMask: QIE Wallet sets it for compatibility. Match on rdns instead.
  const wallets = connectors
    .filter((c) => c.type !== "injected" || connectors.length === 1)
    .sort((a, b) => (a.id === "me.qiewallet" ? -1 : b.id === "me.qiewallet" ? 1 : 0));

  useEffect(() => {
    if (wantSignIn.current && isConnected && !session.data?.user && !pending) {
      wantSignIn.current = false;
      void signIn();
    }
  }, [isConnected, session.data?.user, pending, signIn]);

  async function connect(c: (typeof connectors)[number]) {
    setConnectError(null);
    wantSignIn.current = true;
    try {
      await connectAsync({ connector: c, chainId: chain.id });
    } catch (e) {
      wantSignIn.current = false;
      const msg = e instanceof Error ? e.message : String(e);
      setConnectError(/4902|Unrecognized chain/i.test(msg) ? "Add QIE to your wallet (testnet users: turn on the testnet toggle in QIE Wallet settings)" : /rejected|4001/i.test(msg) ? "You cancelled the connection" : msg);
    }
  }

  return (
    <Card className="space-y-4">
      <h2 className="text-lg font-bold">{title}</h2>
      {isConnected && address ? (
        <div className="space-y-3">
          <p className="text-sm text-muted">Connected as {short(address)}. Sign a message to prove it is you. It is free.</p>
          <Button onClick={() => void signIn()} disabled={pending} className="w-full">
            {pending ? "Waiting for signature…" : "Sign in"}
          </Button>
        </div>
      ) : (
        <div className="space-y-2">
          {bridge.privyEnabled ? (
            <Button
              className="w-full"
              onClick={() => {
                wantSignIn.current = true;
                bridge.emailLogin();
              }}
            >
              Continue with email
            </Button>
          ) : null}
          {wallets.map((c) => (
            <Button key={c.uid} variant={bridge.privyEnabled ? "ghost" : "primary"} className="w-full" disabled={isPending} onClick={() => void connect(c)}>
              {c.id === "me.qiewallet" ? "QIE Wallet" : c.name === "Injected" ? "Browser wallet" : c.name}
            </Button>
          ))}
          {wallets.length === 0 && !bridge.privyEnabled ? (
            <p className="text-sm text-muted">
              No wallet found. Install <a className="text-accent underline" href="https://www.qie.digital/" target="_blank" rel="noreferrer">QIE Wallet</a> and reload.
            </p>
          ) : null}
        </div>
      )}
      {error || connectError ? <p role="alert" className="text-sm text-bad">{error ?? connectError}</p> : null}
      <p className="text-xs text-muted">18+ only. Free to play: no purchase, no stakes, no prizes.</p>
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
    <Card className="space-y-3 border-warn/40">
      <h2 className="text-lg font-bold">One more step</h2>
      <label className="block text-sm">
        <span className="text-muted">Display name (optional)</span>
        <input value={name} onChange={(e) => setName(e.target.value)} maxLength={24} className="mt-1 min-h-11 w-full rounded-xl border border-line bg-bg px-3" />
      </label>
      <label className="flex min-h-11 items-center gap-3 text-sm">
        <input type="checkbox" className="size-5" checked={checked} onChange={(e) => setChecked(e.target.checked)} />
        I am 18 or older and accept the <a href="/legal/terms" className="text-accent underline">terms</a> and <a href="/legal/privacy" className="text-accent underline">privacy notice</a>.
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
