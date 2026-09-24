import type { Metadata } from "next";
import "./app.css";
import Shell from "@/components/Shell";

export const metadata: Metadata = {
  title: "Swiss GmbH Cockpit",
  description: "Financial operations suite for a founder-run Swiss GmbH",
};

const themeInit = `
try { if (localStorage.getItem('theme') === 'dark') document.documentElement.dataset.theme = 'dark'; } catch {}
`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head><script dangerouslySetInnerHTML={{ __html: themeInit }} /></head>
      <body><Shell>{children}</Shell></body>
    </html>
  );
}
