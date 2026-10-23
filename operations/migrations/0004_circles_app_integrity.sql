-- Circles social API integrity hardening.
-- Parent applies only after verifying the current private circles_app schema, role, and migration state.
-- This additive migration preserves all existing rows: CHECK constraints are NOT VALID, and no
-- existing application data is deleted, normalized, or rewritten.

BEGIN;

DO $guarded_social_integrity$
BEGIN
  IF pg_catalog.to_regclass('circles_app.conversations') IS NULL
     OR pg_catalog.to_regclass('circles_app.follows') IS NULL
     OR pg_catalog.to_regclass('circles_app.messages') IS NULL
     OR pg_catalog.to_regclass('circles_app."socialUploads"') IS NULL THEN
    RAISE EXCEPTION 'circles_app social baseline is required before 0004_circles_app_integrity';
  END IF;

  ALTER TABLE circles_app.messages
    ADD COLUMN IF NOT EXISTS "clientMessageId" varchar(96);
  ALTER TABLE circles_app."socialUploads"
    ADD COLUMN IF NOT EXISTS "claimedAt" timestamptz;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint
    WHERE conname = 'conversations_kind_target_check'
      AND conrelid = 'circles_app.conversations'::pg_catalog.regclass
  ) THEN
    ALTER TABLE circles_app.conversations
      ADD CONSTRAINT conversations_kind_target_check
      CHECK (
        (kind = 'direct'::circles_app.conversation_kind AND "directKey" IS NOT NULL AND "circleId" IS NULL)
        OR
        (kind = 'circle'::circles_app.conversation_kind AND "directKey" IS NULL AND "circleId" IS NOT NULL)
      ) NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint
    WHERE conname = 'follows_not_self_check'
      AND conrelid = 'circles_app.follows'::pg_catalog.regclass
  ) THEN
    ALTER TABLE circles_app.follows
      ADD CONSTRAINT follows_not_self_check
      CHECK ("followerId" <> "followingId") NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint
    WHERE conname = 'messages_content_check'
      AND conrelid = 'circles_app.messages'::pg_catalog.regclass
  ) THEN
    ALTER TABLE circles_app.messages
      ADD CONSTRAINT messages_content_check
      CHECK (pg_catalog.btrim(text) <> ''::text OR media IS NOT NULL) NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint
    WHERE conname = 'messages_client_message_id_check'
      AND conrelid = 'circles_app.messages'::pg_catalog.regclass
  ) THEN
    ALTER TABLE circles_app.messages
      ADD CONSTRAINT messages_client_message_id_check
      CHECK (
        "clientMessageId" IS NULL
        OR "clientMessageId" ~ '^[A-Za-z0-9][A-Za-z0-9_-]{15,95}$'
      ) NOT VALID;
  END IF;
END;
$guarded_social_integrity$;

CREATE UNIQUE INDEX IF NOT EXISTS messages_conversation_author_client_message_id_unique
  ON circles_app.messages ("conversationId", "authorId", "clientMessageId")
  WHERE "clientMessageId" IS NOT NULL;

-- This constraint trigger only evaluates messages written after this migration. It does not scan,
-- reject, delete, or repair historic rows. Service transactions take the same parent-circle lock
-- as membership revocation so the current-member check has a defined serialization point.
CREATE FUNCTION circles_app.enforce_message_author_authorized()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, circles_app
AS $function$
DECLARE
  v_kind circles_app.conversation_kind;
  v_circle_id integer;
BEGIN
  SELECT conversation.kind, conversation."circleId"
    INTO v_kind, v_circle_id
    FROM circles_app.conversations AS conversation
   WHERE conversation.id = NEW."conversationId";

  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '23503', MESSAGE = 'message conversation is missing';
  END IF;

  IF v_kind = 'direct'::circles_app.conversation_kind THEN
    IF NOT EXISTS (
      SELECT 1
      FROM circles_app."conversationParticipants" AS participant
      WHERE participant."conversationId" = NEW."conversationId"
        AND participant."userId" = NEW."authorId"
    ) THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'direct message author is not a participant';
    END IF;
  ELSIF v_kind = 'circle'::circles_app.conversation_kind THEN
    IF v_circle_id IS NULL OR NOT EXISTS (
      SELECT 1
      FROM circles_app.memberships AS membership
      WHERE membership."circleId" = v_circle_id
        AND membership."userId" = NEW."authorId"
        AND membership.role IN (
          'owner'::circles_app.membership_role,
          'moderator'::circles_app.membership_role,
          'member'::circles_app.membership_role
        )
    ) THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'circle message author is not an approved member';
    END IF;
  ELSE
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'message conversation kind is invalid';
  END IF;

  RETURN NEW;
END;
$function$;

ALTER FUNCTION circles_app.enforce_message_author_authorized() OWNER TO postgres;
REVOKE ALL ON FUNCTION circles_app.enforce_message_author_authorized()
  FROM PUBLIC, anon, authenticated, service_role, circles_app_runtime;
GRANT EXECUTE ON FUNCTION circles_app.enforce_message_author_authorized()
  TO circles_app_runtime;

DO $guarded_message_trigger$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_trigger
    WHERE tgname = 'messages_author_authorized_trigger'
      AND tgrelid = 'circles_app.messages'::pg_catalog.regclass
      AND NOT tgisinternal
  ) THEN
    CREATE CONSTRAINT TRIGGER messages_author_authorized_trigger
      AFTER INSERT OR UPDATE OF "conversationId", "authorId"
      ON circles_app.messages
      DEFERRABLE INITIALLY IMMEDIATE
      FOR EACH ROW
      EXECUTE FUNCTION circles_app.enforce_message_author_authorized();
  END IF;
END;
$guarded_message_trigger$;

COMMIT;
