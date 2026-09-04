import type { Metadata } from "next";
import { Analytics } from "@vercel/analytics/next";
import { Toaster } from "react-hot-toast";
import { ConfirmProvider } from "@/components/ConfirmDialog";
import "./globals.css";

export const metadata: Metadata = {
  title: "GLB Configurator",
  description: "Three.js GLB mesh inspector, material editor & exporter",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="antialiased overflow-hidden bg-[#0e1120] text-[#c8cef0]">
        <ConfirmProvider>
          {children}
        </ConfirmProvider>
        <Analytics />
        <Toaster
          position="bottom-center"
          toastOptions={{
            duration: 3000,
            style: {
              background: "#12152a",
              color: "#c8cef0",
              border: "1px solid #1e2440",
              borderRadius: "12px",
              fontSize: "12px",
            },
            success: {
              iconTheme: {
                primary: "#4caf90",
                secondary: "#fff",
              },
            },
            error: {
              iconTheme: {
                primary: "#ff6b6b",
                secondary: "#fff",
              },
            },
          }}
        />
      </body>
    </html>
  );
}
