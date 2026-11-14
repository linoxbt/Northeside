import { Profile } from "@/components/profile";
import { Container } from "@/components/ui";
export const metadata = { title: "Your profile" };
export default function MePage() {
  return (
    <Container className="pb-24 pt-14">
      <div className="mx-auto max-w-2xl">
        <Profile />
      </div>
    </Container>
  );
}
