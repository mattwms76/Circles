-- DB-17 portable PG17 schema-only fixture.
-- Derived only from approved capture SHA-256:
-- 35cc5c0d8d01777d13b6b2bc08cae906e26c82c628fecdc49d18676c7d04320f
-- Scope: the seven DB-17 tables, their four required enums, five actual identity sequences,
-- and their primary keys. It intentionally contains no COPY/INSERT rows, roles, grants,
-- policies, foreign keys, or DB-17 candidate indexes.

CREATE SCHEMA circles_app;

CREATE TYPE circles_app.user_role AS ENUM (
    'user',
    'admin'
);

CREATE TYPE circles_app.circle_privacy AS ENUM (
    'public',
    'private'
);

CREATE TYPE circles_app.stream_status AS ENUM (
    'live',
    'ended'
);

CREATE TYPE circles_app.live_signal_kind AS ENUM (
    'join',
    'offer',
    'answer',
    'ice',
    'leave'
);

CREATE TABLE circles_app.users (
    id integer NOT NULL,
    "openId" character varying(64) NOT NULL,
    name text,
    email character varying(320),
    "loginMethod" character varying(64),
    role circles_app.user_role DEFAULT 'user'::circles_app.user_role NOT NULL,
    "createdAt" timestamp with time zone DEFAULT now() NOT NULL,
    "updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
    "lastSignedIn" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE circles_app.circles (
    id integer NOT NULL,
    "ownerId" integer NOT NULL,
    name character varying(140) NOT NULL,
    description text NOT NULL,
    category character varying(80) NOT NULL,
    privacy circles_app.circle_privacy DEFAULT 'public'::circles_app.circle_privacy NOT NULL,
    image character varying(2048) DEFAULT ''::character varying NOT NULL,
    color character varying(32) DEFAULT '#ED604A'::character varying NOT NULL,
    "createdAt" timestamp with time zone DEFAULT now() NOT NULL,
    "updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
    "welcomeMessage" text DEFAULT ''::text NOT NULL,
    rules jsonb DEFAULT '[]'::jsonb NOT NULL,
    "pinnedPostId" integer,
    CONSTRAINT circles_home_pinned_post_id_positive_check CHECK ((("pinnedPostId" IS NULL) OR ("pinnedPostId" > 0))),
    CONSTRAINT circles_home_rules_check CHECK (
CASE
    WHEN (jsonb_typeof(rules) = 'array'::text) THEN ((jsonb_array_length(rules) <= 10) AND (NOT jsonb_path_exists(rules, '$[*]?((((@.type() != "string" || @ like_regex "^.{150}.{150}." flag "s") || @ like_regex "[\r\n]") || @ like_regex "^[\t-\r    -     　﻿]|[\t-\r    -     　﻿]$") || @ like_regex "^[\t-\r    -     　﻿]*$")'::jsonpath)) AND (((rules ->> 0) IS NULL) OR ((rules ->> 1) IS NULL) OR (translate(btrim((rules ->> 0)), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'::text, 'abcdefghijklmnopqrstuvwxyz'::text) <> translate(btrim((rules ->> 1)), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'::text, 'abcdefghijklmnopqrstuvwxyz'::text))) AND (((rules ->> 0) IS NULL) OR ((rules ->> 2) IS NULL) OR (translate(btrim((rules ->> 0)), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'::text, 'abcdefghijklmnopqrstuvwxyz'::text) <> translate(btrim((rules ->> 2)), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'::text, 'abcdefghijklmnopqrstuvwxyz'::text))) AND (((rules ->> 0) IS NULL) OR ((rules ->> 3) IS NULL) OR (translate(btrim((rules ->> 0)), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'::text, 'abcdefghijklmnopqrstuvwxyz'::text) <> translate(btrim((rules ->> 3)), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'::text, 'abcdefghijklmnopqrstuvwxyz'::text))) AND (((rules ->> 0) IS NULL) OR ((rules ->> 4) IS NULL) OR (translate(btrim((rules ->> 0)), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'::text, 'abcdefghijklmnopqrstuvwxyz'::text) <> translate(btrim((rules ->> 4)), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'::text, 'abcdefghijklmnopqrstuvwxyz'::text))) AND (((rules ->> 0) IS NULL) OR ((rules ->> 5) IS NULL) OR (translate(btrim((rules ->> 0)), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'::text, 'abcdefghijklmnopqrstuvwxyz'::text) <> translate(btrim((rules ->> 5)), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'::text, 'abcdefghijklmnopqrstuvwxyz'::text))) AND (((rules ->> 0) IS NULL) OR ((rules ->> 6) IS NULL) OR (translate(btrim((rules ->> 0)), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'::text, 'abcdefghijklmnopqrstuvwxyz'::text) <> translate(btrim((rules ->> 6)), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'::text, 'abcdefghijklmnopqrstuvwxyz'::text))) AND (((rules ->> 0) IS NULL) OR ((rules ->> 7) IS NULL) OR (translate(btrim((rules ->> 0)), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'::text, 'abcdefghijklmnopqrstuvwxyz'::text) <> translate(btrim((rules ->> 7)), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'::text, 'abcdefghijklmnopqrstuvwxyz'::text))) AND (((rules ->> 0) IS NULL) OR ((rules ->> 8) IS NULL) OR (translate(btrim((rules ->> 0)), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'::text, 'abcdefghijklmnopqrstuvwxyz'::text) <> translate(btrim((rules ->> 8)), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'::text, 'abcdefghijklmnopqrstuvwxyz'::text))) AND (((rules ->> 0) IS NULL) OR ((rules ->> 9) IS NULL) OR (translate(btrim((rules ->> 0)), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'::text, 'abcdefghijklmnopqrstuvwxyz'::text) <> translate(btrim((rules ->> 9)), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'::text, 'abcdefghijklmnopqrstuvwxyz'::text))) AND (((rules ->> 1) IS NULL) OR ((rules ->> 2) IS NULL) OR (translate(btrim((rules ->> 1)), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'::text, 'abcdefghijklmnopqrstuvwxyz'::text) <> translate(btrim((rules ->> 2)), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'::text, 'abcdefghijklmnopqrstuvwxyz'::text))) AND (((rules ->> 1) IS NULL) OR ((rules ->> 3) IS NULL) OR (translate(btrim((rules ->> 1)), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'::text, 'abcdefghijklmnopqrstuvwxyz'::text) <> translate(btrim((rules ->> 3)), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'::text, 'abcdefghijklmnopqrstuvwxyz'::text))) AND (((rules ->> 1) IS NULL) OR ((rules ->> 4) IS NULL) OR (translate(btrim((rules ->> 1)), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'::text, 'abcdefghijklmnopqrstuvwxyz'::text) <> translate(btrim((rules ->> 4)), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'::text, 'abcdefghijklmnopqrstuvwxyz'::text))) AND (((rules ->> 1) IS NULL) OR ((rules ->> 5) IS NULL) OR (translate(btrim((rules ->> 1)), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'::text, 'abcdefghijklmnopqrstuvwxyz'::text) <> translate(btrim((rules ->> 5)), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'::text, 'abcdefghijklmnopqrstuvwxyz'::text))) AND (((rules ->> 1) IS NULL) OR ((rules ->> 6) IS NULL) OR (translate(btrim((rules ->> 1)), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'::text, 'abcdefghijklmnopqrstuvwxyz'::text) <> translate(btrim((rules ->> 6)), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'::text, 'abcdefghijklmnopqrstuvwxyz'::text))) AND (((rules ->> 1) IS NULL) OR ((rules ->> 7) IS NULL) OR (translate(btrim((rules ->> 1)), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'::text, 'abcdefghijklmnopqrstuvwxyz'::text) <> translate(btrim((rules ->> 7)), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'::text, 'abcdefghijklmnopqrstuvwxyz'::text))) AND (((rules ->> 1) IS NULL) OR ((rules ->> 8) IS NULL) OR (translate(btrim((rules ->> 1)), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'::text, 'abcdefghijklmnopqrstuvwxyz'::text) <> translate(btrim((rules ->> 8)), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'::text, 'abcdefghijklmnopqrstuvwxyz'::text))) AND (((rules ->> 1) IS NULL) OR ((rules ->> 9) IS NULL) OR (translate(btrim((rules ->> 1)), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'::text, 'abcdefghijklmnopqrstuvwxyz'::text) <> translate(btrim((rules ->> 9)), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'::text, 'abcdefghijklmnopqrstuvwxyz'::text))) AND (((rules ->> 2) IS NULL) OR ((rules ->> 3) IS NULL) OR (translate(btrim((rules ->> 2)), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'::text, 'abcdefghijklmnopqrstuvwxyz'::text) <> translate(btrim((rules ->> 3)), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'::text, 'abcdefghijklmnopqrstuvwxyz'::text))) AND (((rules ->> 2) IS NULL) OR ((rules ->> 4) IS NULL) OR (translate(btrim((rules ->> 2)), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'::text, 'abcdefghijklmnopqrstuvwxyz'::text) <> translate(btrim((rules ->> 4)), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'::text, 'abcdefghijklmnopqrstuvwxyz'::text))) AND (((rules ->> 2) IS NULL) OR ((rules ->> 5) IS NULL) OR (translate(btrim((rules ->> 2)), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'::text, 'abcdefghijklmnopqrstuvwxyz'::text) <> translate(btrim((rules ->> 5)), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'::text, 'abcdefghijklmnopqrstuvwxyz'::text))) AND (((rules ->> 2) IS NULL) OR ((rules ->> 6) IS NULL) OR (translate(btrim((rules ->> 2)), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'::text, 'abcdefghijklmnopqrstuvwxyz'::text) <> translate(btrim((rules ->> 6)), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'::text, 'abcdefghijklmnopqrstuvwxyz'::text))) AND (((rules ->> 2) IS NULL) OR ((rules ->> 7) IS NULL) OR (translate(btrim((rules ->> 2)), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'::text, 'abcdefghijklmnopqrstuvwxyz'::text) <> translate(btrim((rules ->> 7)), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'::text, 'abcdefghijklmnopqrstuvwxyz'::text))) AND (((rules ->> 2) IS NULL) OR ((rules ->> 8) IS NULL) OR (translate(btrim((rules ->> 2)), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'::text, 'abcdefghijklmnopqrstuvwxyz'::text) <> translate(btrim((rules ->> 8)), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'::text, 'abcdefghijklmnopqrstuvwxyz'::text))) AND (((rules ->> 2) IS NULL) OR ((rules ->> 9) IS NULL) OR (translate(btrim((rules ->> 2)), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'::text, 'abcdefghijklmnopqrstuvwxyz'::text) <> translate(btrim((rules ->> 9)), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'::text, 'abcdefghijklmnopqrstuvwxyz'::text))) AND (((rules ->> 3) IS NULL) OR ((rules ->> 4) IS NULL) OR (translate(btrim((rules ->> 3)), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'::text, 'abcdefghijklmnopqrstuvwxyz'::text) <> translate(btrim((rules ->> 4)), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'::text, 'abcdefghijklmnopqrstuvwxyz'::text))) AND (((rules ->> 3) IS NULL) OR ((rules ->> 5) IS NULL) OR (translate(btrim((rules ->> 3)), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'::text, 'abcdefghijklmnopqrstuvwxyz'::text) <> translate(btrim((rules ->> 5)), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'::text, 'abcdefghijklmnopqrstuvwxyz'::text))) AND (((rules ->> 3) IS NULL) OR ((rules ->> 6) IS NULL) OR (translate(btrim((rules ->> 3)), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'::text, 'abcdefghijklmnopqrstuvwxyz'::text) <> translate(btrim((rules ->> 6)), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'::text, 'abcdefghijklmnopqrstuvwxyz'::text))) AND (((rules ->> 3) IS NULL) OR ((rules ->> 7) IS NULL) OR (translate(btrim((rules ->> 3)), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'::text, 'abcdefghijklmnopqrstuvwxyz'::text) <> translate(btrim((rules ->> 7)), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'::text, 'abcdefghijklmnopqrstuvwxyz'::text))) AND (((rules ->> 3) IS NULL) OR ((rules ->> 8) IS NULL) OR (translate(btrim((rules ->> 3)), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'::text, 'abcdefghijklmnopqrstuvwxyz'::text) <> translate(btrim((rules ->> 8)), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'::text, 'abcdefghijklmnopqrstuvwxyz'::text))) AND (((rules ->> 3) IS NULL) OR ((rules ->> 9) IS NULL) OR (translate(btrim((rules ->> 3)), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'::text, 'abcdefghijklmnopqrstuvwxyz'::text) <> translate(btrim((rules ->> 9)), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'::text, 'abcdefghijklmnopqrstuvwxyz'::text))) AND (((rules ->> 4) IS NULL) OR ((rules ->> 5) IS NULL) OR (translate(btrim((rules ->> 4)), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'::text, 'abcdefghijklmnopqrstuvwxyz'::text) <> translate(btrim((rules ->> 5)), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'::text, 'abcdefghijklmnopqrstuvwxyz'::text))) AND (((rules ->> 4) IS NULL) OR ((rules ->> 6) IS NULL) OR (translate(btrim((rules ->> 4)), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'::text, 'abcdefghijklmnopqrstuvwxyz'::text) <> translate(btrim((rules ->> 6)), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'::text, 'abcdefghijklmnopqrstuvwxyz'::text))) AND (((rules ->> 4) IS NULL) OR ((rules ->> 7) IS NULL) OR (translate(btrim((rules ->> 4)), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'::text, 'abcdefghijklmnopqrstuvwxyz'::text) <> translate(btrim((rules ->> 7)), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'::text, 'abcdefghijklmnopqrstuvwxyz'::text))) AND (((rules ->> 4) IS NULL) OR ((rules ->> 8) IS NULL) OR (translate(btrim((rules ->> 4)), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'::text, 'abcdefghijklmnopqrstuvwxyz'::text) <> translate(btrim((rules ->> 8)), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'::text, 'abcdefghijklmnopqrstuvwxyz'::text))) AND (((rules ->> 4) IS NULL) OR ((rules ->> 9) IS NULL) OR (translate(btrim((rules ->> 4)), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'::text, 'abcdefghijklmnopqrstuvwxyz'::text) <> translate(btrim((rules ->> 9)), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'::text, 'abcdefghijklmnopqrstuvwxyz'::text))) AND (((rules ->> 5) IS NULL) OR ((rules ->> 6) IS NULL) OR (translate(btrim((rules ->> 5)), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'::text, 'abcdefghijklmnopqrstuvwxyz'::text) <> translate(btrim((rules ->> 6)), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'::text, 'abcdefghijklmnopqrstuvwxyz'::text))) AND (((rules ->> 5) IS NULL) OR ((rules ->> 7) IS NULL) OR (translate(btrim((rules ->> 5)), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'::text, 'abcdefghijklmnopqrstuvwxyz'::text) <> translate(btrim((rules ->> 7)), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'::text, 'abcdefghijklmnopqrstuvwxyz'::text))) AND (((rules ->> 5) IS NULL) OR ((rules ->> 8) IS NULL) OR (translate(btrim((rules ->> 5)), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'::text, 'abcdefghijklmnopqrstuvwxyz'::text) <> translate(btrim((rules ->> 8)), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'::text, 'abcdefghijklmnopqrstuvwxyz'::text))) AND (((rules ->> 5) IS NULL) OR ((rules ->> 9) IS NULL) OR (translate(btrim((rules ->> 5)), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'::text, 'abcdefghijklmnopqrstuvwxyz'::text) <> translate(btrim((rules ->> 9)), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'::text, 'abcdefghijklmnopqrstuvwxyz'::text))) AND (((rules ->> 6) IS NULL) OR ((rules ->> 7) IS NULL) OR (translate(btrim((rules ->> 6)), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'::text, 'abcdefghijklmnopqrstuvwxyz'::text) <> translate(btrim((rules ->> 7)), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'::text, 'abcdefghijklmnopqrstuvwxyz'::text))) AND (((rules ->> 6) IS NULL) OR ((rules ->> 8) IS NULL) OR (translate(btrim((rules ->> 6)), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'::text, 'abcdefghijklmnopqrstuvwxyz'::text) <> translate(btrim((rules ->> 8)), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'::text, 'abcdefghijklmnopqrstuvwxyz'::text))) AND (((rules ->> 6) IS NULL) OR ((rules ->> 9) IS NULL) OR (translate(btrim((rules ->> 6)), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'::text, 'abcdefghijklmnopqrstuvwxyz'::text) <> translate(btrim((rules ->> 9)), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'::text, 'abcdefghijklmnopqrstuvwxyz'::text))) AND (((rules ->> 7) IS NULL) OR ((rules ->> 8) IS NULL) OR (translate(btrim((rules ->> 7)), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'::text, 'abcdefghijklmnopqrstuvwxyz'::text) <> translate(btrim((rules ->> 8)), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'::text, 'abcdefghijklmnopqrstuvwxyz'::text))) AND (((rules ->> 7) IS NULL) OR ((rules ->> 9) IS NULL) OR (translate(btrim((rules ->> 7)), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'::text, 'abcdefghijklmnopqrstuvwxyz'::text) <> translate(btrim((rules ->> 9)), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'::text, 'abcdefghijklmnopqrstuvwxyz'::text))) AND (((rules ->> 8) IS NULL) OR ((rules ->> 9) IS NULL) OR (translate(btrim((rules ->> 8)), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'::text, 'abcdefghijklmnopqrstuvwxyz'::text) <> translate(btrim((rules ->> 9)), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'::text, 'abcdefghijklmnopqrstuvwxyz'::text))))
    ELSE false
END),
    CONSTRAINT circles_home_welcome_message_check CHECK ((char_length("welcomeMessage") <= 2000))
);

CREATE TABLE circles_app.streams (
    id integer NOT NULL,
    "hostId" integer NOT NULL,
    title character varying(160) NOT NULL,
    "circleId" integer,
    thumbnail character varying(2048) DEFAULT ''::character varying NOT NULL,
    status circles_app.stream_status DEFAULT 'live'::circles_app.stream_status NOT NULL,
    "readyAt" timestamp with time zone,
    "lastHeartbeatAt" timestamp with time zone DEFAULT now() NOT NULL,
    "hostGeneration" integer DEFAULT 1 NOT NULL,
    "createdAt" timestamp with time zone DEFAULT now() NOT NULL,
    "endedAt" timestamp with time zone
);

CREATE TABLE circles_app."activeHostLeases" (
    "hostId" integer NOT NULL,
    "streamId" integer,
    "lastHeartbeatAt" timestamp with time zone
);

CREATE TABLE circles_app."liveViewers" (
    "streamId" integer NOT NULL,
    "userId" integer NOT NULL,
    "joinedAt" timestamp with time zone DEFAULT now() NOT NULL,
    "lastSeenAt" timestamp with time zone DEFAULT now() NOT NULL,
    generation integer DEFAULT 1 NOT NULL,
    "leftAt" timestamp with time zone
);

CREATE TABLE circles_app."liveSignals" (
    id integer NOT NULL,
    "streamId" integer NOT NULL,
    "fromId" integer NOT NULL,
    "toId" integer,
    kind circles_app.live_signal_kind NOT NULL,
    "fromGeneration" integer DEFAULT 1 NOT NULL,
    "toGeneration" integer DEFAULT 1 NOT NULL,
    payload text NOT NULL,
    "createdAt" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE circles_app."liveChat" (
    id integer NOT NULL,
    "streamId" integer NOT NULL,
    "userId" integer NOT NULL,
    "userName" character varying(160) NOT NULL,
    avatar character varying(2048) DEFAULT ''::character varying NOT NULL,
    text character varying(500) NOT NULL,
    "createdAt" timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE circles_app.users ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME circles_app.users_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

ALTER TABLE circles_app.circles ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME circles_app.circles_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

ALTER TABLE circles_app.streams ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME circles_app.streams_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

ALTER TABLE circles_app."liveSignals" ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME circles_app."liveSignals_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

ALTER TABLE circles_app."liveChat" ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME circles_app."liveChat_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

ALTER TABLE ONLY circles_app.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);

ALTER TABLE ONLY circles_app.circles
    ADD CONSTRAINT circles_pkey PRIMARY KEY (id);

ALTER TABLE ONLY circles_app.streams
    ADD CONSTRAINT streams_pkey PRIMARY KEY (id);

ALTER TABLE ONLY circles_app."activeHostLeases"
    ADD CONSTRAINT "activeHostLeases_pkey" PRIMARY KEY ("hostId");

ALTER TABLE ONLY circles_app."liveViewers"
    ADD CONSTRAINT "liveViewers_pkey" PRIMARY KEY ("streamId", "userId");

ALTER TABLE ONLY circles_app."liveSignals"
    ADD CONSTRAINT "liveSignals_pkey" PRIMARY KEY (id);

ALTER TABLE ONLY circles_app."liveChat"
    ADD CONSTRAINT "liveChat_pkey" PRIMARY KEY (id);
