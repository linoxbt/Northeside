import Link from "next/link";
import { Card } from "@/components/ui";

export default function NotFound() {
  return (
    <Card>
      <h1 className="text-xl font-bold">Not found</h1>
      <p className="mt-2 text-muted">That page does not exist. <Link className="text-accent underline" href="/">Back to this week's games</Link></p>
    </Card>
  );
}
