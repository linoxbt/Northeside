import { redirect } from "next/navigation";
import { Profile } from "@/components/profile";
import { Container } from "@/components/ui";
import { backendConfigured } from "@/lib/server/configured";
import { getSession } from "@/lib/server/session";

export const dynamic = "force-dynamic";
export const metadata = { title: "Your profile" };

export default async function MePage({ searchParams }: { searchParams: Promise<{ verify?: string }> }) {
  // Signed out: go straight to sign-in and come back, instead of loading the wallet code (about 3 MB)
  // only to show a sign-in card (audit 27 Nov, FE-9). The verification result is kept in the return URL.
  if (backendConfigured() && !(await getSession())) {
    const { verify } = await searchParams;
    const back = verify && /^[a-z-]{1,20}$/.test(verify) ? `/me?verify=${verify}` : "/me";
    redirect(`/sign-in?next=${encodeURIComponent(back)}`);
  }
  return (
    <Container className="pb-24 pt-14">
      <div className="mx-auto max-w-2xl">
        <Profile />
      </div>
    </Container>
  );
}
