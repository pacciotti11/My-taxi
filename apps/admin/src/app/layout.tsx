import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "PrivateRide Admin",
  description: "Administration dashboard for the PrivateRide platform",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="bg">
      <body>{children}</body>
    </html>
  );
}
