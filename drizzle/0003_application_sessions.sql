CREATE TABLE `applicationSessions` (
	`sessionFingerprint` varchar(64) NOT NULL,
	`userOpenId` varchar(64) NOT NULL,
	`appId` varchar(128) NOT NULL,
	`expiresAt` timestamp NOT NULL,
	`revokedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `applicationSessions_sessionFingerprint` PRIMARY KEY(`sessionFingerprint`)
);
--> statement-breakpoint
CREATE INDEX `application_sessions_user_app_idx` ON `applicationSessions` (`userOpenId`,`appId`);
--> statement-breakpoint
CREATE INDEX `application_sessions_expiry_idx` ON `applicationSessions` (`expiresAt`);
