CREATE TABLE `activeHostLeases` (
	`hostId` int NOT NULL,
	`streamId` int,
	`lastHeartbeatAt` timestamp,
	CONSTRAINT `activeHostLeases_hostId` PRIMARY KEY(`hostId`)
);
--> statement-breakpoint
ALTER TABLE `conversationParticipants` ADD `lastReadMessageId` int DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `liveSignals` ADD `fromGeneration` int DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `liveSignals` ADD `toGeneration` int DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `liveViewers` ADD `generation` int DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `streams` ADD `hostGeneration` int DEFAULT 1 NOT NULL;