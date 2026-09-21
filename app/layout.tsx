import type { Metadata } from "next";
import { Sidebar } from "@/components/Sidebar";
import "./globals.css";

export const metadata: Metadata = {
  title: "AdClone Studio · Thought Pilot",
  description:
    "Paste a high-performing ad. Get its framework deconstructed and rebuilt as fresh copy and new creative, in the target platform's format.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex">
        <Sidebar />
        <div className="flex-1 min-w-0 flex flex-col">{children}</div>
      </body>
    </html>
  );
}
