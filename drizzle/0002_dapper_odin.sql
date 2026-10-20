ALTER TABLE `liveViewers` ADD `lastSeenAt` timestamp DEFAULT (now()) NOT NULL;--> statement-breakpoint
ALTER TABLE `streams` ADD `readyAt` timestamp;--> statement-breakpoint
ALTER TABLE `streams` ADD `lastHeartbeatAt` timestamp DEFAULT (now()) NOT NULL;