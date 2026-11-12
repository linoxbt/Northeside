"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { useAccount, useConnect, useDisconnect } from "wagmi";
import { useAuthBridge } from "./providers";
import { Mark } from "./ui";
import { chain, isPreview, short } from "@/lib/client/env";
import { useSession, useSignIn } from "@/lib/client/session";

/** Only same-site paths, so ?next= cannot send people to another domain. */
function safeNext(raw: string | null) {
  return raw && raw.startsWith("/") && !raw.startsWith("//") && !raw.startsWith("/sign-in") ? raw : "/play";
}

const pill =
  "inline-flex min-h-[52px] w-full items-center justify-center gap-3 rounded-full px-6 text-[16px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50";
const primary = `${pill} bg-white text-[#0a0b0d] hover:bg-white/90`;
const secondary = `${pill} border border-white/15 bg-white/[0.03] text-white hover:bg-white/[0.08]`;
const field =
  "min-h-[52px] w-full rounded-full border border-white/15 bg-white/[0.03] px-6 text-[16px] text-white outline-none transition-colors placeholder:text-white/35 focus:border-white/60";
const link = "text-white/90 underline decoration-white/40 underline-offset-4 hover:decoration-white";

export function SignInScreen() {
  return (
    <div className="flex min-h-dvh flex-col bg-[#0a0b0d] text-white [color-scheme:dark]">
      <header className="mx-auto flex w-full max-w-6xl items-center px-5 py-5 sm:px-8 sm:py-7">
        <Link href="/" className="inline-flex items-center gap-2.5" aria-label="Northeside home">
          <Mark size={28} />
          <span className="text-[19px] font-medium tracking-[-0.03em]">Northeside</span>
        </Link>
      </header>
      <div className="flex flex-1 items-start justify-center px-5 pb-40 pt-10 sm:items-center sm:pt-0">
        <div className="w-full max-w-[440px]">{isPreview ? <Preview /> : <Live />}</div>
      </div>
    </div>
  );
}

function Intro({ children }: { children?: ReactNode }) {
  return (
    <div className="text-center">
      <h1 className="text-[34px] font-medium leading-[1.08] tracking-[-0.04em] sm:text-[44px]">Call the score. Seal it.</h1>
      <p className="mx-auto mt-4 max-w-[400px] text-[17px] leading-7 text-white/60">
        Sign in to seal your Premier League predictions on QIE before kickoff, join your league and keep every receipt.
      </p>
      {children}
    </div>
  );
}

function Preview() {
  return (
    <>
      <Intro />
      <p className="mt-10 rounded-2xl border border-white/10 bg-white/[0.03] p-5 text-center text-[15px] leading-6 text-white/70">
        Sign-in opens with the first live matchweek.
      </p>
      <Link href="/how-it-works" className={`${secondary} mt-6`}>
        See how it works
      </Link>
    </>
  );
}

function Live() {
  const router = useRouter();
  const next = safeNext(useSearchParams().get("next"));
  const bridge = useAuthBridge();
  const session = useSession();
  const { connectors, connectAsync, isPending: connecting } = useConnect();
  const { isConnected, address } = useAccount();
  const { disconnect } = useDisconnect();
  const { signIn, error: signError, pending: signing } = useSignIn();
  const wantSignIn = useRef(false);

  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [codeSent, setCodeSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const signedIn = !!session.data?.user;
  useEffect(() => {
    if (signedIn) router.replace(next);
  }, [signedIn, next, router]);

  // Once a wallet (external or the email account's embedded one) is connected, ask for the signature.
  useEffect(() => {
    if (wantSignIn.current && isConnected && !signedIn && !signing) {
      wantSignIn.current = false;
      void signIn();
    }
  }, [isConnected, signedIn, signing, signIn]);

  // Never branch on isMetaMask: QIE Wallet sets it for compatibility. Match on rdns instead.
  const wallets = connectors
    .filter((c) => c.id !== "injected" || connectors.length === 1)
    .sort((a, b) => (a.id === "me.qiewallet" ? -1 : b.id === "me.qiewallet" ? 1 : 0));

  async function connect(c: (typeof connectors)[number]) {
    setError(null);
    wantSignIn.current = true;
    try {
      await connectAsync({ connector: c, chainId: chain.id });
    } catch (e) {
      wantSignIn.current = false;
      const msg = e instanceof Error ? e.message : String(e);
      setError(/4902|Unrecognized chain/i.test(msg) ? "Add the QIE network to your wallet, then try again" : /rejected|4001/i.test(msg) ? "You cancelled the connection" : msg);
    }
  }

  async function onEmail(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (!codeSent) {
        await bridge.sendEmailCode(email.trim());
        setCodeSent(true);
      } else {
        wantSignIn.current = true;
        await bridge.loginWithEmailCode(code.trim());
      }
    } catch (err) {
      wantSignIn.current = false;
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const shownError = error ?? signError;

  return (
    <>
      <Intro>
        <p className="mt-8 text-[15px] text-white/60">
          New to Northeside? Signing in creates your account.{" "}
          <Link href="/how-it-works" className={`${link} whitespace-nowrap`}>
            How it works
          </Link>
        </p>
      </Intro>

      <div className="mt-10">
        {isConnected && address && !signedIn ? (
          <div className="space-y-4">
            <p className="text-center text-[15px] leading-6 text-white/60">
              Connected as <span className="font-mono text-white">{short(address)}</span>. Sign a message to prove it is you. It is free and sends no
              transaction.
            </p>
            <button type="button" className={primary} disabled={signing} onClick={() => void signIn()}>
              {signing ? "Waiting for your signature…" : "Sign in"}
            </button>
            <button type="button" className="w-full text-center text-[14px] text-white/50 hover:text-white" onClick={() => disconnect()}>
              Use a different wallet
            </button>
          </div>
        ) : (
          <>
            {bridge.privyEnabled ? (
              <form onSubmit={onEmail} className="space-y-6">
                <label className="block">
                  <span className="mb-2.5 block text-[15px] font-medium">Email</span>
                  <input
                    type="email"
                    required
                    autoComplete="email"
                    inputMode="email"
                    placeholder="you@example.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    disabled={codeSent}
                    className={field}
                  />
                </label>
                {codeSent ? (
                  <label className="block">
                    <span className="mb-2.5 flex items-baseline justify-between text-[15px] font-medium">
                      Code from your email
                      <button
                        type="button"
                        className={`${link} text-[14px] font-normal`}
                        onClick={() => {
                          setCodeSent(false);
                          setCode("");
                        }}
                      >
                        Change email
                      </button>
                    </span>
                    <input
                      required
                      autoComplete="one-time-code"
                      inputMode="numeric"
                      pattern="[0-9]{6}"
                      maxLength={6}
                      placeholder="6-digit code"
                      value={code}
                      onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                      className={`${field} font-mono tracking-[0.3em]`}
                      autoFocus
                    />
                  </label>
                ) : null}
                <button type="submit" className={primary} disabled={busy || !bridge.ready}>
                  {busy ? "One moment…" : codeSent ? "Sign in" : "Continue with email"}
                </button>
              </form>
            ) : null}

            {bridge.privyEnabled && wallets.length > 0 ? (
              <div className="my-7 flex items-center gap-4 text-[15px] text-white/45" aria-hidden>
                <span className="h-px flex-1 bg-white/12" />
                or
                <span className="h-px flex-1 bg-white/12" />
              </div>
            ) : null}

            <div className="space-y-3">
              {wallets.map((c, i) => (
                <button
                  key={c.uid}
                  type="button"
                  disabled={connecting}
                  onClick={() => void connect(c)}
                  className={!bridge.privyEnabled && i === 0 ? primary : secondary}
                >
                  {c.icon ? <img src={c.icon} alt="" className="size-5 rounded" /> : <WalletGlyph />}
                  {c.id === "me.qiewallet" ? "Continue with QIE Wallet" : c.name === "Injected" ? "Continue with browser wallet" : `Continue with ${c.name}`}
                </button>
              ))}
              {wallets.length === 0 && !bridge.privyEnabled ? (
                <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 text-center text-[15px] leading-6 text-white/70">
                  No wallet found in this browser. Install{" "}
                  <a className={link} href="https://www.qie.digital/" target="_blank" rel="noreferrer">
                    QIE Wallet
                  </a>
                  , or open Northeside in your wallet app&apos;s browser, then reload.
                </div>
              ) : null}
            </div>
          </>
        )}

        {shownError ? (
          <p role="alert" className="mt-5 text-center text-[14px] text-[#ff8a80]">
            {shownError}
          </p>
        ) : null}

        <p className="mt-8 text-center text-[13px] leading-6 text-white/45">
          By continuing you confirm you are 18 or older and accept the{" "}
          <Link href="/legal/terms" className={link}>
            Terms of use
          </Link>{" "}
          and{" "}
          <Link href="/legal/privacy" className={link}>
            Privacy notice
          </Link>
          . Free to play: no purchase, no stakes, no prizes.
        </p>
      </div>
    </>
  );
}

function WalletGlyph() {
  return (
    <svg viewBox="0 0 20 20" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
      <rect x="2.5" y="5" width="15" height="11" rx="2.5" />
      <path d="M2.5 8h15M13 12h1.5" strokeLinecap="round" />
    </svg>
  );
}
