"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { useAccount, useConnect, useDisconnect } from "wagmi";
import { useAuthBridge } from "./auth-bridge";
import { Mark } from "./ui";
import { chain, isPreview, short } from "@/lib/client/env";
import { safeNext } from "@/lib/safe-next";
import { useSession } from "@/lib/client/session";
import { useSignIn } from "@/lib/client/sign-in-hooks";

/** Plain-language messages for the errors people actually hit. */
function friendly(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  if (/invalid.*code|code.*(invalid|incorrect|expired)|otp/i.test(msg)) return "That code did not work. Check the latest email, or send a new code.";
  if (/rejected|denied|4001|cancel/i.test(msg)) return "You cancelled. Try again when you are ready.";
  if (/4902|Unrecognized chain|chain/i.test(msg) && /add|unrecognized|switch/i.test(msg)) return "Add the QIE network to your wallet, then try again.";
  if (/network|fetch|timeout/i.test(msg)) return "Network problem. Check your connection and try again.";
  return msg.length > 160 ? "Something went wrong. Please try again." : msg;
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

type Step = "start" | "code" | "setting-up" | "signing" | "stuck";

function Live() {
  const router = useRouter();
  const params = useSearchParams();
  const next = safeNext(params.get("next"));
  // ?link=1: a signed-in player adding another wallet (G6); the server links it to the account.
  const linking = params.get("link") === "1";
  const bridge = useAuthBridge();
  const session = useSession();
  const { connectors, connectAsync, isPending: connecting } = useConnect();
  const { isConnected, address } = useAccount();
  const { disconnect } = useDisconnect();
  const { signIn, error: signError, pending: signing } = useSignIn();
  const wantSignIn = useRef(false);

  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<Step>("start");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showWallets, setShowWallets] = useState(false);
  const startAddress = useRef<string | undefined>(undefined);

  const signedIn = !!session.data?.user;
  useEffect(() => {
    if (signedIn && !linking) router.replace(next);
  }, [signedIn, linking, next, router]);

  // Once a wallet (the email account's embedded one, or an external one) is connected, sign in.
  useEffect(() => {
    if (!wantSignIn.current || !isConnected || signing) return;
    if (linking && address === startAddress.current) return; // wait for the newly connected wallet
    wantSignIn.current = false;
    setStep("signing");
    void signIn().then((ok) => {
      if (ok && linking) router.replace(next);
      if (!ok) setStep("start");
    });
  }, [isConnected, address, signing, signIn, linking, next, router]);

  // Email path: Privy is signed in but the wallet is not connected yet. Create it if Privy did not,
  // and give up with a clear message rather than leave the player on a silent screen (audit B8).
  useEffect(() => {
    if (step !== "setting-up" || isConnected) return;
    const nudge = setTimeout(() => void bridge.ensureEmbeddedWallet().catch(() => {}), 6_000);
    const stuck = setTimeout(() => setStep((s) => (s === "setting-up" ? "stuck" : s)), 25_000);
    return () => {
      clearTimeout(nudge);
      clearTimeout(stuck);
    };
  }, [step, isConnected, bridge]);

  // Without Privy: EIP-6963 wallets via wagmi. Never branch on isMetaMask (QIE Wallet sets it); use rdns.
  const injectedWallets = connectors
    .filter((c) => c.id !== "injected" || connectors.length === 1)
    .sort((a, b) => (a.id === "me.qiewallet" ? -1 : b.id === "me.qiewallet" ? 1 : 0));

  async function connectInjected(c: (typeof connectors)[number]) {
    setError(null);
    // Already connected (wagmi reconnects on load): just sign.
    if (isConnected && address && !linking) {
      setStep("signing");
      const ok = await signIn();
      if (!ok) setStep("start");
      return;
    }
    startAddress.current = address;
    wantSignIn.current = true;
    try {
      await connectAsync({ connector: c, chainId: chain.id });
    } catch (e) {
      wantSignIn.current = false;
      setError(friendly(e));
    }
  }

  function connectWithPrivy() {
    setError(null);
    startAddress.current = address;
    wantSignIn.current = true;
    bridge.connectExternalWallet();
  }

  async function sendCode() {
    setError(null);
    setBusy(true);
    try {
      await bridge.sendEmailCode(email.trim());
      setStep("code");
      setCode("");
    } catch (err) {
      setError(friendly(err));
    } finally {
      setBusy(false);
    }
  }

  async function onEmail(e: FormEvent) {
    e.preventDefault();
    if (step === "start") return sendCode();
    setError(null);
    setBusy(true);
    try {
      wantSignIn.current = true;
      await bridge.loginWithEmailCode(code.trim());
      setStep("setting-up");
    } catch (err) {
      wantSignIn.current = false;
      setError(friendly(err));
    } finally {
      setBusy(false);
    }
  }

  const shownError = error ?? signError;

  if (session.isLoading || (signedIn && !linking)) {
    return (
      <div className="flex flex-col items-center gap-4 py-16 text-white/60" role="status">
        <Spinner />
        {signedIn ? "Taking you back…" : "Loading…"}
      </div>
    );
  }

  if (step === "setting-up" || step === "signing") {
    return (
      <>
        <Intro />
        <div className="mt-12 flex flex-col items-center gap-4 text-center text-[16px] text-white/70" role="status" aria-live="polite">
          <Spinner />
          {step === "setting-up" ? "Setting up your account…" : bridge.isEmbedded(address) ? "Signing you in…" : "Confirm the sign-in message in your wallet. It is free and sends no transaction."}
        </div>
        {shownError ? <ErrorLine text={shownError} /> : null}
      </>
    );
  }

  if (step === "stuck") {
    return (
      <>
        <Intro />
        <div className="mt-10 space-y-4 text-center">
          <p className="text-[15px] leading-6 text-white/70">Your email is confirmed, but your Northeside wallet is taking longer than usual to set up.</p>
          <button
            type="button"
            className={primary}
            onClick={() => {
              wantSignIn.current = true;
              setStep("setting-up");
              void bridge.ensureEmbeddedWallet().catch((e) => setError(friendly(e)));
            }}
          >
            Try again
          </button>
          <button type="button" className="text-[14px] text-white/55 hover:text-white" onClick={() => void bridge.logout().then(() => setStep("start"))}>
            Start over with a different email
          </button>
        </div>
        {shownError ? <ErrorLine text={shownError} /> : null}
      </>
    );
  }

  const walletButtons = bridge.privyEnabled ? (
    <button type="button" className={secondary} onClick={connectWithPrivy}>
      <WalletGlyph />
      {linking ? "Connect another wallet" : "Continue with a wallet (QIE Wallet and others)"}
    </button>
  ) : (
    <>
      {injectedWallets.map((c, i) => (
        <button key={c.uid} type="button" disabled={connecting} onClick={() => void connectInjected(c)} className={i === 0 ? primary : secondary}>
          {c.icon ? <img src={c.icon} alt="" className="size-5 rounded" /> : <WalletGlyph />}
          {c.id === "me.qiewallet" ? "Continue with QIE Wallet" : c.name === "Injected" ? "Continue with browser wallet" : `Continue with ${c.name}`}
        </button>
      ))}
      {injectedWallets.length === 0 ? (
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 text-center text-[15px] leading-6 text-white/70">
          No wallet found in this browser. Install{" "}
          <a className={link} href="https://www.qie.digital/" target="_blank" rel="noreferrer">
            QIE Wallet
          </a>
          , or open Northeside in your wallet app&apos;s browser, then reload.
        </div>
      ) : null}
    </>
  );

  return (
    <>
      <Intro>
        {linking ? (
          <p className="mt-8 text-[15px] text-white/60">Connect the wallet you want to add, then sign the message. Up to 3 wallets per account.</p>
        ) : (
          <p className="mt-8 text-[15px] text-white/60">
            New to Northeside? Signing in creates your account.{" "}
            <Link href="/how-it-works" className={`${link} whitespace-nowrap`}>
              How it works
            </Link>
          </p>
        )}
      </Intro>

      <div className="mt-10">
        {isConnected && address && !signedIn && !wantSignIn.current && !bridge.isEmbedded(address) ? (
          <div className="mb-6 space-y-3">
            <p className="text-center text-[15px] leading-6 text-white/60">
              Connected as <span className="font-mono text-white">{short(address)}</span>. Sign a message to prove it is you. It is free and sends no transaction.
            </p>
            <button type="button" className={primary} disabled={signing} onClick={() => void signIn()}>
              {signing ? "Waiting for your signature…" : "Sign in"}
            </button>
            <button type="button" className="w-full text-center text-[14px] text-white/50 hover:text-white" onClick={() => disconnect()}>
              Use a different wallet
            </button>
          </div>
        ) : null}

        {bridge.privyEnabled && !linking ? (
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
                disabled={step === "code"}
                className={field}
              />
            </label>
            {step === "code" ? (
              <label className="block">
                <span className="mb-2.5 flex items-baseline justify-between gap-4 text-[15px] font-medium">
                  Code from your email
                  <span className="flex gap-4 text-[14px] font-normal">
                    <button type="button" className={link} disabled={busy} onClick={() => void sendCode()}>
                      Resend code
                    </button>
                    <button
                      type="button"
                      className={link}
                      onClick={() => {
                        setStep("start");
                        setCode("");
                      }}
                    >
                      Change email
                    </button>
                  </span>
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
            <button type="submit" className={primary} disabled={busy || !bridge.ready || (step === "code" && code.length !== 6)}>
              {busy ? "One moment…" : step === "code" ? "Sign in" : "Continue with email"}
            </button>
          </form>
        ) : null}

        {isConnected && address && !signedIn && !bridge.isEmbedded(address) && !linking ? null : bridge.privyEnabled && !linking ? (
          showWallets ? (
            <>
              <div className="my-7 flex items-center gap-4 text-[15px] text-white/45" aria-hidden>
                <span className="h-px flex-1 bg-white/12" />
                or
                <span className="h-px flex-1 bg-white/12" />
              </div>
              <div className="space-y-3">{walletButtons}</div>
            </>
          ) : (
            <button type="button" className="mt-6 w-full text-center text-[14px] text-white/55 hover:text-white" onClick={() => setShowWallets(true)}>
              Use a crypto wallet instead
            </button>
          )
        ) : (
          <div className="space-y-3">{walletButtons}</div>
        )}

        {shownError ? <ErrorLine text={shownError} /> : null}

        <p className="mt-8 text-center text-[13px] leading-6 text-white/55">
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

function ErrorLine({ text }: { text: string }) {
  return (
    <p role="alert" className="mt-5 text-center text-[14px] text-[#ff8a80]">
      {text}
    </p>
  );
}

function Spinner() {
  return <span aria-hidden className="size-6 animate-spin rounded-full border-2 border-white/20 border-t-white" />;
}

function WalletGlyph() {
  return (
    <svg viewBox="0 0 20 20" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
      <rect x="2.5" y="5" width="15" height="11" rx="2.5" />
      <path d="M2.5 8h15M13 12h1.5" strokeLinecap="round" />
    </svg>
  );
}
