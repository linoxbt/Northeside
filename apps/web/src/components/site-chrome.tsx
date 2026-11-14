"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

/** Focused pages (sign-in) render without the site header and footer. */
const BARE = ["/sign-in", "/tg"];

/** Header everywhere except focused pages; the footer only on the landing page. */
export function SiteChrome({ children, landingOnly = false }: { children: ReactNode; landingOnly?: boolean }) {
  const path = usePathname();
  if (landingOnly) return path === "/" || path === "/about" ? <>{children}</> : null;
  if (BARE.some((p) => path === p || path.startsWith(`${p}/`))) return null;
  return <>{children}</>;
}
