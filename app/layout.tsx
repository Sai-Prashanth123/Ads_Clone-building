import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AdClone Studio · Thought Pilot",
  description:
    "Paste a high-performing X ad. Get its framework deconstructed and rebuilt as fresh copy and new creative.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
