import type { Metadata } from "next";
import { HostDashboard } from "@/components/host";
import { ButtonLink, Container, PageHeader } from "@/components/ui";

export const metadata: Metadata = { title: "Host a league", description: "Run a Northeside league for your community and earn QUSDC from sponsors." };

export default function HostPage() {
  return (
    <Container className="pb-24">
      <PageHeader eyebrow="Hosts" title="Host a league.">
        <ButtonLink href="/docs/hosts" variant="secondary" arrow>
          How hosting works
        </ButtonLink>
      </PageHeader>
      <HostDashboard />
    </Container>
  );
}
