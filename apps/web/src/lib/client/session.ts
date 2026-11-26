"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "./api";

export interface SessionData {
  user: {
    id: string;
    displayName: string | null;
    qieId: string | null;
    qieIdResolved: boolean;
    adultConfirmed: boolean;
    emailVerified: boolean;
    attributedLeagueId: string | null;
  } | null;
  wallet?: `0x${string}`;
  wallets?: { address: string; kind: string }[];
  verified?: boolean;
  verificationAvailable?: boolean;
  /** "qie-name": a .qie name owned by the signed-in wallet verifies one person. */
  verificationMethod?: "mock" | "qie-name" | null;
}

export function useSession() {
  return useQuery({ queryKey: ["session"], queryFn: () => api<SessionData>("/api/v1/session") });
}
