CREATE TABLE `games` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`hostId` integer NOT NULL,
	`guestId` integer,
	`player1` integer NOT NULL,
	`currentTurn` text NOT NULL,
	`board` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL
);
