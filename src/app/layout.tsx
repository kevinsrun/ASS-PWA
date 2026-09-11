import type { Metadata, Viewport } from "next";
import "./globals.css";
import BottomNav from "@/components/BottomNav";
import { AuthProvider } from "@/providers/AuthProvider";
import { AppProvider } from "@/providers/AppProvider";
import InstallPrompt from "@/components/InstallPrompt";

export const metadata: Metadata = {
  title: {
    default: "ASS",
    template: "%s | ASS",
  },
  description: "A calm, intelligent place to decide what comes next.",
  applicationName: "ASS",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "ASS",
  },
  formatDetection: {
    telephone: false,
  },
  icons: {
    icon: [
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180" }],
  },
};

export const viewport: Viewport = {
  themeColor: "#f7f7f8",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-dvh overflow-x-hidden">
        <AuthProvider>
          <AppProvider>
            {children}
            <InstallPrompt />
            <BottomNav />
          </AppProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
