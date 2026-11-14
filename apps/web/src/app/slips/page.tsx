import type { Metadata } from "next";
import { MySlips } from "@/components/my-slips";
import { Container } from "@/components/ui";

export const metadata: Metadata = { title: "My slips", robots: { index: false } };

export default function SlipsPage() {
  return (
    <Container className="pb-24 pt-4 sm:pt-6">
      <div className="mx-auto max-w-2xl">
        <MySlips />
      </div>
    </Container>
  );
}
