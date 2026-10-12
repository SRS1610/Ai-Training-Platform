import type { Metadata, Viewport } from "next";
import { fontDisplay, fontSans } from "./fonts";
import "./globals.css";
import { Providers } from "./providers";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000"),
  title: { default: "Praxis — AI-powered training that builds real competence", template: "%s · Praxis" },
  description:
    "Learn, practise, simulate, perform, get assessed and improve. Praxis is the AI-powered training platform for teams that need proven skills, not just completions.",
  applicationName: "Praxis",
  icons: { icon: "/icon.svg" },
};

export const viewport: Viewport = {
  themeColor: "#4f46e5",
  colorScheme: "light",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${fontSans.variable} ${fontDisplay.variable}`} style={{ colorScheme: "light" }}>
      <body className="min-h-dvh font-sans">
        <a href="#main" className="skip-link">
          Skip to content
        </a>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
