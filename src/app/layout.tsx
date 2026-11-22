import type { Metadata, Viewport } from "next";
import { restoreHideValuesScript } from "@/lib/privacy";
import { manrope, sora } from "./fonts";
import "./globals.css";

export const metadata: Metadata = {
  title: "Kalu",
  description: "Finanças da casa em um só lugar",
  applicationName: "Kalu",
  appleWebApp: {
    capable: true,
    title: "Kalu",
    statusBarStyle: "black",
  },
  formatDetection: {
    telephone: false,
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#08080a",
  colorScheme: "dark",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="pt-BR"
      className={`dark ${manrope.variable} ${sora.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: restoreHideValuesScript }} />
      </head>
      <body className="min-h-full flex flex-col font-sans">{children}</body>
    </html>
  );
}
