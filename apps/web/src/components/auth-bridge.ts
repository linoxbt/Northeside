"use client";

import { createContext, useContext } from "react";

export interface AuthBridge {
  privyEnabled: boolean;
  ready: boolean;
  /** Signed in with Privy (email). The app session is separate: it needs the wallet signature. */
  authenticated: boolean;
  /** Inline email sign-in: send a one-time code, then submit it. */
  sendEmailCode(email: string): Promise<void>;
  loginWithEmailCode(code: string): Promise<void>;
  /** Privy: open the connect-wallet modal (detected wallets first, e.g. QIE Wallet). */
  connectExternalWallet(): void;
  /** The user's Privy embedded wallet, once created. */
  embeddedAddress: string | null;
  /** Create the embedded wallet if Privy did not on login, and make it the active wallet. */
  ensureEmbeddedWallet(): Promise<void>;
  /** FR-04: Privy's export modal for the embedded wallet's private key. */
  exportWallet(): Promise<void>;
  getAccessToken(): Promise<string | null>;
  isEmbedded(address?: string): boolean;
  logout(): Promise<void>;
}

const unavailable = async () => {
  throw new Error("Email sign-in is not available yet");
};

export const noop: AuthBridge = {
  privyEnabled: false,
  ready: true,
  authenticated: false,
  sendEmailCode: unavailable,
  loginWithEmailCode: unavailable,
  connectExternalWallet: () => {},
  embeddedAddress: null,
  ensureEmbeddedWallet: unavailable,
  exportWallet: unavailable,
  getAccessToken: async () => null,
  isEmbedded: () => false,
  logout: async () => {},
};

export const AuthBridgeContext = createContext<AuthBridge>(noop);
export const useAuthBridge = () => useContext(AuthBridgeContext);

