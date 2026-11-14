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
}

export function useSession() {
  return useQuery({ queryKey: ["session"], queryFn: () => api<SessionData>("/api/v1/session") });
}
