import { relations } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const users = sqliteTable("users", {
  id: integer("id", { mode: "number" }).primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
});

export const usersRelations = relations(users, ({ many }) => ({
  hostGames: many(games, {
    relationName: "host",
  }),
  guestGames: many(games, {
    relationName: "guest",
  }),
}));

export type User = typeof users.$inferSelect; // return type when queried
export type InsertUser = typeof users.$inferInsert; // insert type

export const games = sqliteTable("games", {
  id: integer("id", { mode: "number" }).primaryKey({ autoIncrement: true }),
  hostId: integer("hostId").notNull(),
  guestId: integer("guestId"),
  player1: integer("player1").notNull(),
  currentTurn: text("currentTurn").notNull(),
  board: text("board").notNull(),
});

export const gamesRelations = relations(games, ({ one }) => ({
  host: one(users, {
    relationName: "host",
    fields: [games.hostId],
    references: [users.id],
  }),
  guest: one(users, {
    relationName: "guest",
    fields: [games.guestId],
    references: [users.id],
  }),
}));

export type Game = typeof games.$inferSelect; // return type when queried
export type InsertGame = typeof games.$inferInsert; // insert type
