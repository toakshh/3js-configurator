import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "GLB Configurator",
  description: "Three.js GLB mesh inspector, material editor & exporter",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="antialiased overflow-hidden">{children}</body>
    </html>
  );
}
