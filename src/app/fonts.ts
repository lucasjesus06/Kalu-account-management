import localFont from "next/font/local";

export const sora = localFont({
  src: "../../node_modules/@fontsource-variable/sora/files/sora-latin-wght-normal.woff2",
  weight: "100 800",
  variable: "--font-sora",
  display: "swap",
});

export const manrope = localFont({
  src: "../../node_modules/@fontsource-variable/manrope/files/manrope-latin-wght-normal.woff2",
  weight: "200 800",
  variable: "--font-manrope",
  display: "swap",
});
