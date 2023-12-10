import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";

const TURSO_URL = process.env.TURSO_URL ?? "https://othello-joshdchang.turso.io/";
const TURSO_AUTH_TOKEN = process.env.TURSO_AUTH_TOKEN;

const client = createClient({
  url: TURSO_URL,
  authToken: TURSO_AUTH_TOKEN,
});
const db = drizzle(client);

// This will run migrations on the database, skipping the ones already applied
await migrate(db, { migrationsFolder: "./drizzle" });


