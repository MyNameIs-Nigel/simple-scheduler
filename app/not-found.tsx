import type { Metadata } from "next";
import Link from "next/link";

import { Container } from "@/components/Container";
import { openGraphImageSize } from "@/lib/opengraph";

export const metadata: Metadata = {
  title: "404",
  description: "The requested schedule page could not be found.",
  openGraph: {
    title: "404",
    images: [
      {
        url: "/api/opengraph/404",
        alt: "404",
        ...openGraphImageSize,
      },
    ],
  },
};

export default function NotFound() {
  return (
    <Container className="py-10">
      <h1 className="font-mono text-3xl font-bold tracking-tight text-fg">
        <span className="text-accent-1">{">"}</span>
        <span className="ml-2">404</span>
      </h1>
      <p className="mt-3 text-sm text-muted">This page does not exist.</p>
      <Link className="mt-6 inline-block text-sm text-accent-1 hover:underline" href="/">
        Return to schedule
      </Link>
    </Container>
  );
}
