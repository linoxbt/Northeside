import type { Metadata } from "next";
import { ButtonLink, Container, PageHeader } from "@/components/ui";

export const metadata: Metadata = { title: "Page not found", robots: { index: false } };

export default function NotFound() {
  return (
    <Container className="pb-24">
      <PageHeader eyebrow="404" title="Offside.">
        <ButtonLink href="/play" variant="primary" arrow>
          Play this week
        </ButtonLink>
        <ButtonLink href="/" variant="secondary">
          Home
        </ButtonLink>
      </PageHeader>
    </Container>
  );
}
