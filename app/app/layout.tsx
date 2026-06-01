import "@/styles/globals.css";
import type { Metadata } from "next";
import TopBar from "@/components/TopBar";
import AuroraBackground from "@/components/AuroraBackground";
import { loadConfig } from "@/lib/config";

export const metadata: Metadata = {
  title: "shippost",
  description: "Pick and publish your AI-drafted LinkedIn posts",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  let theme = "neutral";
  let brandName = "";
  try {
    const c = loadConfig();
    theme = c.app.theme || "neutral";
    brandName = c.brand.name || "";
  } catch {
    /* config missing — fall back to defaults */
  }

  return (
    <html lang="en" data-theme={theme} suppressHydrationWarning>
      <head>
        {/* apply saved theme before paint to avoid a flash */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              "try{var t=localStorage.getItem('shippost-theme');if(t)document.documentElement.dataset.theme=t;}catch(e){}",
          }}
        />
      </head>
      <body>
        <AuroraBackground />
        <TopBar brandName={brandName} />
        <main className="relative z-10 mx-auto max-w-3xl px-5 py-8">{children}</main>
        <footer className="relative z-10 mx-auto max-w-3xl px-5 pb-10 text-center text-xs text-muted">
          crafted with <span aria-label="love">❤️</span> by{" "}
          <a
            href="https://hakolkal.com"
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-fg underline-offset-2 transition hover:text-accent hover:underline"
          >
            HakolKal
          </a>
        </footer>
      </body>
    </html>
  );
}
