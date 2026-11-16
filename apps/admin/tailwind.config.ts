import type { Config } from "tailwindcss";

export default {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          50: "#eef7f2",
          500: "#1d7a53",
          600: "#17603f",
          700: "#124d33",
        },
      },
    },
  },
  plugins: [],
} satisfies Config;
