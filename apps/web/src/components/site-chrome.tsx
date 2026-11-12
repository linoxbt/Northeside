"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

/** Focused pages (sign-in) render without the site header and footer. */
const BARE = ["/sign-in"];

export function SiteChrome({ children }: { children: ReactNode }) {
  const path = usePathname();
  if (BARE.some((p) => path === p || path.startsWith(`${p}/`))) return null;
  return <>{children}</>;
}
