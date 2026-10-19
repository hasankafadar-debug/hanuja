import type { Metadata } from "next";
import { getSellerPanelUrl } from "@hanuja/api/lib/platform-info";
import { InvitationExperience } from "./invitation-experience";

// An unlisted invitation, deliberately outside the storefront route group.
// Do not add this route to navigation, recommendations or the public sitemap.
export const metadata: Metadata = {
  title: "Tasarımcı Daveti",
  description:
    "İyi tasarım, doğru insanlarla buluşmalı. Hanuja tasarımcı topluluğuna katılın; görünürlüğünüzü birlikte büyütelim.",
  robots: {
    index: false,
    follow: false,
    googleBot: { index: false, follow: false, noimageindex: true },
  },
  openGraph: {
    title: "İyi tasarım, doğru insanlarla buluşmalı. — Hanuja",
    description: "Tasarımınıza yer açtık. Hanuja tasarımcı daveti.",
    images: [
      { url: "/designer-invitation/hero.webp", width: 1672, height: 941 },
    ],
  },
};

export default function DesignerInvitationPage() {
  return (
    <InvitationExperience applicationUrl={`${getSellerPanelUrl()}/basvuru`} />
  );
}
