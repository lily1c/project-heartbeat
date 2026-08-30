import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Blind Bazaar — Midnight-Verified Ad Auctions" },
      {
        name: "description",
        content:
          "Watch one advertiser negotiate with blind publishers in live, Midnight-verified fair ad auctions.",
      },
      { property: "og:title", content: "Blind Bazaar — Midnight-Verified Ad Auctions" },
      {
        property: "og:description",
        content:
          "Watch one advertiser negotiate with blind publishers in live, Midnight-verified fair ad auctions.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

function Index() {
  return (
    <iframe
      src="/blindbazaar/index.html"
      title="Blind Bazaar"
      className="h-screen w-screen border-0"
    />
  );
}
