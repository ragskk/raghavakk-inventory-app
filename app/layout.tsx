import type { Metadata, Viewport } from "next";
import "./globals.css";
import { SessionChip } from "./_components/SessionChip";

export const metadata: Metadata = {
  title: "RKK Inventory",
  description: "Studio inventory — registrar surface.",
  robots: { index: false, follow: false }
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover"
};

export default function RootLayout({
  children
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body suppressHydrationWarning>
        {/* Global sign-out chip — renders only when authenticated. */}
        <SessionChip />
        {children}
      </body>
    </html>
  );
}
