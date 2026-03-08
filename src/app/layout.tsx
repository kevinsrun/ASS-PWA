import type { Metadata, Viewport } from "next";
import "./globals.css";
import BottomNav from "@/components/BottomNav";
import { AppProvider } from "@/providers/AppProvider";

export const metadata: Metadata = {
  title: "ASS",
  description: "Todo, habits, and AI assistant",
};

export const viewport: Viewport = {
  themeColor: "#ffffff",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="pb-24">
        <AppProvider>
          {children}
          <BottomNav />
        </AppProvider>
      </body>
    </html>
  );
}