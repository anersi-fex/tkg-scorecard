import type { MetadataRoute } from "next";

/** Makes "Add to Home Screen" open Scorecard as its own app (and the TV's browser can install it too). */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "Scorecard by TKG",
    short_name: "Scorecard",
    description: "The team's month, live on the office TV.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    lang: "en",
    categories: ["business", "productivity"],
    background_color: "#f2f3f7",
    theme_color: "#f2f3f7",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
      { src: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" },
    ],
  };
}
