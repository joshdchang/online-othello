import type { Config } from "drizzle-kit";

export default {
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  driver: "turso",
  dbCredentials: {
    url: process.env.TURSO_URL ?? "https://othello-joshdchang.turso.io/",
    authToken: process.env.TURSO_AUTH_TOKEN,
  },
} satisfies Config;
