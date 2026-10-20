CREATE TABLE `bookmarks` (
	`id` int AUTO_INCREMENT NOT NULL,
	`postId` int NOT NULL,
	`userId` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `bookmarks_id` PRIMARY KEY(`id`),
	CONSTRAINT `bookmarks_post_user_unique` UNIQUE(`postId`,`userId`)
);
--> statement-breakpoint
CREATE TABLE `circles` (
	`id` int AUTO_INCREMENT NOT NULL,
	`ownerId` int NOT NULL,
	`name` varchar(140) NOT NULL,
	`description` text NOT NULL,
	`category` varchar(80) NOT NULL,
	`privacy` enum('public','private') NOT NULL DEFAULT 'public',
	`image` varchar(2048) NOT NULL DEFAULT '',
	`color` varchar(32) NOT NULL DEFAULT '#ED604A',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `circles_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `comments` (
	`id` int AUTO_INCREMENT NOT NULL,
	`postId` int NOT NULL,
	`authorId` int NOT NULL,
	`text` text NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `comments_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `conversationParticipants` (
	`id` int AUTO_INCREMENT NOT NULL,
	`conversationId` int NOT NULL,
	`userId` int NOT NULL,
	`lastReadAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `conversationParticipants_id` PRIMARY KEY(`id`),
	CONSTRAINT `conversation_participants_conversation_user_unique` UNIQUE(`conversationId`,`userId`)
);
--> statement-breakpoint
CREATE TABLE `conversations` (
	`id` int AUTO_INCREMENT NOT NULL,
	`kind` enum('direct','circle') NOT NULL,
	`directKey` varchar(64),
	`circleId` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `conversations_id` PRIMARY KEY(`id`),
	CONSTRAINT `conversations_direct_key_unique` UNIQUE(`directKey`),
	CONSTRAINT `conversations_circle_id_unique` UNIQUE(`circleId`)
);
--> statement-breakpoint
CREATE TABLE `follows` (
	`id` int AUTO_INCREMENT NOT NULL,
	`followerId` int NOT NULL,
	`followingId` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `follows_id` PRIMARY KEY(`id`),
	CONSTRAINT `follows_follower_following_unique` UNIQUE(`followerId`,`followingId`)
);
--> statement-breakpoint
CREATE TABLE `memberships` (
	`id` int AUTO_INCREMENT NOT NULL,
	`circleId` int NOT NULL,
	`userId` int NOT NULL,
	`role` enum('owner','moderator','member','pending') NOT NULL DEFAULT 'member',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `memberships_id` PRIMARY KEY(`id`),
	CONSTRAINT `memberships_circle_user_unique` UNIQUE(`circleId`,`userId`)
);
--> statement-breakpoint
CREATE TABLE `messages` (
	`id` int AUTO_INCREMENT NOT NULL,
	`conversationId` int NOT NULL,
	`authorId` int NOT NULL,
	`text` text NOT NULL,
	`media` varchar(2048),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `messages_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `posts` (
	`id` int AUTO_INCREMENT NOT NULL,
	`authorId` int NOT NULL,
	`circleId` int,
	`text` text NOT NULL,
	`media` varchar(2048),
	`mediaType` enum('text','photo','video') NOT NULL DEFAULT 'text',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `posts_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `profiles` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`name` varchar(120) NOT NULL,
	`handle` varchar(48) NOT NULL,
	`bio` text NOT NULL,
	`avatar` varchar(2048) NOT NULL,
	`cover` varchar(2048),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `profiles_id` PRIMARY KEY(`id`),
	CONSTRAINT `profiles_user_id_unique` UNIQUE(`userId`),
	CONSTRAINT `profiles_handle_unique` UNIQUE(`handle`)
);
--> statement-breakpoint
CREATE TABLE `reactions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`postId` int NOT NULL,
	`userId` int NOT NULL,
	`type` enum('like') NOT NULL DEFAULT 'like',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `reactions_id` PRIMARY KEY(`id`),
	CONSTRAINT `reactions_post_user_unique` UNIQUE(`postId`,`userId`)
);
--> statement-breakpoint
CREATE TABLE `reports` (
	`id` int AUTO_INCREMENT NOT NULL,
	`postId` int NOT NULL,
	`reporterId` int NOT NULL,
	`reason` varchar(500) NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `reports_id` PRIMARY KEY(`id`),
	CONSTRAINT `reports_post_reporter_unique` UNIQUE(`postId`,`reporterId`)
);
--> statement-breakpoint
CREATE TABLE `socialSeedMarkers` (
	`key` varchar(100) NOT NULL,
	`completedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `socialSeedMarkers_key` PRIMARY KEY(`key`)
);
--> statement-breakpoint
CREATE TABLE `socialUploads` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`storageKey` varchar(1024) NOT NULL,
	`url` varchar(2048) NOT NULL,
	`mimeType` varchar(128) NOT NULL,
	`bytes` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `socialUploads_id` PRIMARY KEY(`id`),
	CONSTRAINT `social_uploads_storage_key_unique` UNIQUE(`storageKey`)
);
--> statement-breakpoint
CREATE TABLE `liveChat` (
	`id` int AUTO_INCREMENT NOT NULL,
	`streamId` int NOT NULL,
	`userId` int NOT NULL,
	`userName` varchar(160) NOT NULL,
	`avatar` varchar(2048) NOT NULL DEFAULT '',
	`text` varchar(500) NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `liveChat_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `liveSignals` (
	`id` int AUTO_INCREMENT NOT NULL,
	`streamId` int NOT NULL,
	`fromId` int NOT NULL,
	`toId` int,
	`kind` enum('join','offer','answer','ice','leave') NOT NULL,
	`payload` text NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `liveSignals_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `liveViewers` (
	`streamId` int NOT NULL,
	`userId` int NOT NULL,
	`joinedAt` timestamp NOT NULL DEFAULT (now()),
	`leftAt` timestamp,
	CONSTRAINT `liveViewers_streamId_userId_pk` PRIMARY KEY(`streamId`,`userId`)
);
--> statement-breakpoint
CREATE TABLE `streams` (
	`id` int AUTO_INCREMENT NOT NULL,
	`hostId` int NOT NULL,
	`title` varchar(160) NOT NULL,
	`circleId` int,
	`thumbnail` varchar(2048) NOT NULL DEFAULT '',
	`status` enum('live','ended') NOT NULL DEFAULT 'live',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`endedAt` timestamp,
	CONSTRAINT `streams_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `bookmarks` ADD CONSTRAINT `bookmarks_postId_posts_id_fk` FOREIGN KEY (`postId`) REFERENCES `posts`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `bookmarks` ADD CONSTRAINT `bookmarks_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `circles` ADD CONSTRAINT `circles_ownerId_users_id_fk` FOREIGN KEY (`ownerId`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `comments` ADD CONSTRAINT `comments_postId_posts_id_fk` FOREIGN KEY (`postId`) REFERENCES `posts`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `comments` ADD CONSTRAINT `comments_authorId_users_id_fk` FOREIGN KEY (`authorId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `conversationParticipants` ADD CONSTRAINT `conversationParticipants_conversationId_conversations_id_fk` FOREIGN KEY (`conversationId`) REFERENCES `conversations`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `conversationParticipants` ADD CONSTRAINT `conversationParticipants_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `conversations` ADD CONSTRAINT `conversations_circleId_circles_id_fk` FOREIGN KEY (`circleId`) REFERENCES `circles`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `follows` ADD CONSTRAINT `follows_followerId_users_id_fk` FOREIGN KEY (`followerId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `follows` ADD CONSTRAINT `follows_followingId_users_id_fk` FOREIGN KEY (`followingId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `memberships` ADD CONSTRAINT `memberships_circleId_circles_id_fk` FOREIGN KEY (`circleId`) REFERENCES `circles`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `memberships` ADD CONSTRAINT `memberships_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `messages` ADD CONSTRAINT `messages_conversationId_conversations_id_fk` FOREIGN KEY (`conversationId`) REFERENCES `conversations`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `messages` ADD CONSTRAINT `messages_authorId_users_id_fk` FOREIGN KEY (`authorId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `posts` ADD CONSTRAINT `posts_authorId_users_id_fk` FOREIGN KEY (`authorId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `posts` ADD CONSTRAINT `posts_circleId_circles_id_fk` FOREIGN KEY (`circleId`) REFERENCES `circles`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `profiles` ADD CONSTRAINT `profiles_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `reactions` ADD CONSTRAINT `reactions_postId_posts_id_fk` FOREIGN KEY (`postId`) REFERENCES `posts`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `reactions` ADD CONSTRAINT `reactions_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `reports` ADD CONSTRAINT `reports_postId_posts_id_fk` FOREIGN KEY (`postId`) REFERENCES `posts`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `reports` ADD CONSTRAINT `reports_reporterId_users_id_fk` FOREIGN KEY (`reporterId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `socialUploads` ADD CONSTRAINT `socialUploads_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `bookmarks_user_created_idx` ON `bookmarks` (`userId`,`createdAt`);--> statement-breakpoint
CREATE INDEX `circles_category_idx` ON `circles` (`category`);--> statement-breakpoint
CREATE INDEX `circles_owner_idx` ON `circles` (`ownerId`);--> statement-breakpoint
CREATE INDEX `comments_post_created_idx` ON `comments` (`postId`,`createdAt`);--> statement-breakpoint
CREATE INDEX `conversation_participants_user_idx` ON `conversationParticipants` (`userId`);--> statement-breakpoint
CREATE INDEX `conversations_kind_updated_idx` ON `conversations` (`kind`,`updatedAt`);--> statement-breakpoint
CREATE INDEX `follows_following_idx` ON `follows` (`followingId`);--> statement-breakpoint
CREATE INDEX `memberships_user_role_idx` ON `memberships` (`userId`,`role`);--> statement-breakpoint
CREATE INDEX `messages_conversation_created_idx` ON `messages` (`conversationId`,`createdAt`);--> statement-breakpoint
CREATE INDEX `posts_created_at_idx` ON `posts` (`createdAt`);--> statement-breakpoint
CREATE INDEX `posts_circle_created_idx` ON `posts` (`circleId`,`createdAt`);--> statement-breakpoint
CREATE INDEX `posts_author_created_idx` ON `posts` (`authorId`,`createdAt`);--> statement-breakpoint
CREATE INDEX `reactions_user_idx` ON `reactions` (`userId`);--> statement-breakpoint
CREATE INDEX `reports_post_idx` ON `reports` (`postId`);--> statement-breakpoint
CREATE INDEX `social_uploads_user_idx` ON `socialUploads` (`userId`);