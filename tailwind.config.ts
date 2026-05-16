import type { Config } from "tailwindcss";

/**
 * Design tokens mirror raghavakk-campaign-app/tailwind.config.ts so the
 * inventory surface reads as the same institution as the campaign surface
 * and the public site. Single accent (red), three font families.
 */
const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}"
  ],
  theme: {
    extend: {
      colors: {
        paper: {
          1: "#F4F1EA",
          2: "#ECE7DA",
          3: "#E3DCC8"
        },
        ink: "#0E0E0C",
        red: {
          DEFAULT: "#E63D22",
          ink: "#B82E1B"
        },
        rule: "#D4CDB8",
        muted: "#6B6555"
      },
      fontFamily: {
        display: ['"Instrument Serif"', "serif"],
        body: ['"Fraunces"', "Georgia", "serif"],
        mono: ['"JetBrains Mono"', "ui-monospace", "monospace"]
      },
      fontSize: {
        eyebrow: ["0.7rem", { lineHeight: "1.4", letterSpacing: "0.16em" }],
        meta: ["0.78rem", { lineHeight: "1.5", letterSpacing: "0.04em" }],
        lede: ["clamp(1rem, 2.5vw, 1.13rem)", { lineHeight: "1.65" }],
        dek: ["clamp(1.15rem, 3.2vw, 1.35rem)", { lineHeight: "1.4" }],
        h2: ["clamp(1.8rem, 6vw, 2.4rem)", { lineHeight: "1.1" }],
        h1: ["clamp(2.2rem, 7.5vw, 3.6rem)", { lineHeight: "1.05" }],
        display: ["clamp(2.2rem, 8vw, 4.8rem)", { lineHeight: "1.05" }]
      },
      maxWidth: {
        reading: "660px",
        editorial: "1480px"
      },
      letterSpacing: {
        caps: "0.18em"
      },
      boxShadow: {
        polaroid: "0 1px 1px rgba(14,14,12,0.06), 0 12px 28px rgba(14,14,12,0.10)"
      }
    }
  },
  plugins: []
};

export default config;
