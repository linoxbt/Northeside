import { ButtonLink, Container } from "./ui";

/** Full-bleed accent call to action, shared by marketing pages. */
export function CtaBand() {
  return (
    <section className="bg-accent text-accent-ink">
      <Container className="relative overflow-hidden py-20 sm:py-24">
        <div aria-hidden className="absolute -right-16 top-1/2 hidden -translate-y-1/2 opacity-90 md:block">
          {/* A centre circle drawn as pitch markings: the mark, in outline, on the accent band. */}
          <svg width="380" height="380" viewBox="0 0 40 40" fill="none" stroke="var(--color-accent-ink)" strokeWidth="1.1">
            <circle cx="20" cy="20" r="18" />
            <path d="M2 20h36" />
            <circle cx="20" cy="20" r="7" />
            <circle cx="20" cy="20" r="1.3" fill="var(--color-accent-ink)" />
          </svg>
        </div>
        <h2 className="display relative max-w-xl text-[36px] sm:text-[52px]">Your call. Sealed before kickoff.</h2>
        <div className="relative mt-8 flex flex-wrap gap-3">
          <ButtonLink href="/play" variant="primary" arrow>
            Play this week
          </ButtonLink>
          <ButtonLink href="/host" variant="inverse">
            Host a league
          </ButtonLink>
        </div>
      </Container>
    </section>
  );
}

