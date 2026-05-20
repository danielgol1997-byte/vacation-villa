import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "וילה משפחתית 2026",
  description: "ניהול משימות, קניות והתנדבויות לחופשה המשפחתית.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="he" dir="rtl">
      <body>{children}</body>
    </html>
  );
}
