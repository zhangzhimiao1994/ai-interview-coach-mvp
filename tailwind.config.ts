import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#111827",
        muted: "#6b7280",
        panel: "#ffffff",
        line: "#e5e7eb",
        brand: "#2563eb",
        accent: "#059669"
      }
    }
  },
  plugins: []
};

export default config;
