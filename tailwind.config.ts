import type { Config } from "tailwindcss";

export default {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#0f172a",
        subtle: "#64748b",
      },
    },
  },
  plugins: [],
} satisfies Config;
