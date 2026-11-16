import { badgeById } from "@northeside/core";
import { HttpError, json, route } from "@/lib/server/api";

export const dynamic = "force-dynamic";

/** GET /api/v1/badges/:id — ERC-1155 metadata for a NorthesideBadges token id. */
export const GET = route(async (req, { params }: { params: Promise<{ id: string }> }) => {
  const raw = (await params).id.replace(/\.json$/, "");
  const n = /^\d{1,3}$/.test(raw) ? Number(raw) : NaN;
  const b = Number.isInteger(n) ? badgeById(n) : null;
  if (!b) throw new HttpError(404, "not_found", "No such badge");
  const origin = new URL(req.url).origin;
  return json(
    {
      name: `Northeside · ${b.name}`,
      description: `${b.how}. A non-transferable Northeside achievement, earned from on-chain play. It has no monetary value and cannot be sold or redeemed.`,
      image: `${origin}/api/v1/badges/${n}/image`,
      external_url: `${origin}/docs#levels`,
      attributes: [
        { trait_type: "Badge", value: b.name },
        { trait_type: "Transferable", value: "No" },
      ],
    },
    { headers: { "cache-control": "public, max-age=3600" } },
  );
});
