-- Force row-level security on every circles_app table that already has a
-- runtime policy, and add a surrogate primary key to publish receipts.
--
-- Runtime policies stay USING (true). This does not install per-user policies
-- and does not change anon, authenticated, or admin grants. The current API
-- connects as postgres, a superuser, so FORCE does not change that session.
-- It removes the table-owner bypass for a future non-superuser owner.
--
-- The receipt primary key is a new identity column. The existing
-- (actorId, operationId) unique constraint stays, so publication retries keep
-- the same conflict target and the unique index is not duplicated.

BEGIN;

ALTER TABLE circles_app."_dataMigrations" FORCE ROW LEVEL SECURITY;
ALTER TABLE circles_app."activeHostLeases" FORCE ROW LEVEL SECURITY;
ALTER TABLE circles_app."applicationSessions" FORCE ROW LEVEL SECURITY;
ALTER TABLE circles_app.bookmarks FORCE ROW LEVEL SECURITY;
ALTER TABLE circles_app.circles FORCE ROW LEVEL SECURITY;
ALTER TABLE circles_app.comments FORCE ROW LEVEL SECURITY;
ALTER TABLE circles_app."conversationParticipants" FORCE ROW LEVEL SECURITY;
ALTER TABLE circles_app.conversations FORCE ROW LEVEL SECURITY;
ALTER TABLE circles_app.follows FORCE ROW LEVEL SECURITY;
ALTER TABLE circles_app."liveChat" FORCE ROW LEVEL SECURITY;
ALTER TABLE circles_app."liveSignals" FORCE ROW LEVEL SECURITY;
ALTER TABLE circles_app."liveViewers" FORCE ROW LEVEL SECURITY;
ALTER TABLE circles_app.memberships FORCE ROW LEVEL SECURITY;
ALTER TABLE circles_app.messages FORCE ROW LEVEL SECURITY;
ALTER TABLE circles_app.posts FORCE ROW LEVEL SECURITY;
ALTER TABLE circles_app.profiles FORCE ROW LEVEL SECURITY;
ALTER TABLE circles_app.reactions FORCE ROW LEVEL SECURITY;
ALTER TABLE circles_app.reports FORCE ROW LEVEL SECURITY;
ALTER TABLE circles_app."socialSeedMarkers" FORCE ROW LEVEL SECURITY;
ALTER TABLE circles_app."socialUploads" FORCE ROW LEVEL SECURITY;
ALTER TABLE circles_app.streams FORCE ROW LEVEL SECURITY;
ALTER TABLE circles_app.users FORCE ROW LEVEL SECURITY;

ALTER TABLE circles_publish."postPublishReceipts"
  ADD COLUMN IF NOT EXISTS id bigint GENERATED ALWAYS AS IDENTITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint
    WHERE conrelid = 'circles_publish."postPublishReceipts"'::regclass
      AND contype = 'p'
  ) THEN
    ALTER TABLE circles_publish."postPublishReceipts"
      ADD CONSTRAINT post_publish_receipts_pkey PRIMARY KEY (id);
  END IF;
END $$;

COMMIT;
