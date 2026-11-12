"use client";

import { useEffect, useState } from "react";

/** False during SSR and the first client render, so time- and browser-dependent text cannot cause hydration mismatches. */
export function useMounted() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return mounted;
}
