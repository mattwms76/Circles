# Activity Inbox isolated HTTP E2E

This is an **API-layer HTTP integration/E2E suite**, not a native-device, rendered-UI, OAuth-provider, or production-database test. It exercises a real loopback Express/tRPC adapter, the production `activity` and `social` routers, real Activity/Social services and transactions, Drizzle, PostgreSQL 17, and `RuntimeRolePool` (`SET ROLE circles_app_runtime`) against a newly created local database.

## Run

```bash
pnpm test:e2e:activity
# equivalent explicit runner form
/usr/bin/python3 scripts/run-circle-home-e2e.py --suite activity
```

The runner requires Linux tooling already used by the Circle Home suite:

- `/usr/lib/postgresql/17/bin/{initdb,pg_ctl}`
- `/usr/bin/python3` with `psycopg`
- Node `22.23.4`, version-checked before startup
- checked-in project dependencies, including Vitest

It applies the fixed baseline/Circle Home migrations plus both reviewed Activity migrations (`0010_circles_activity_inbox.sql` and `0011_circles_ops_activity_health.sql`). Activity mode refuses to start unless **both** additions exist. It then seeds only synthetic accounts, circles, memberships, and posts. Activity mode alone adds user 6 as a current member of fixture circles 11 and 12; this supplies real current-membership access for circle-scoped post targets while leaving the default Circle Home fixture—and its established eight cases—unchanged.

## Safety contract

- The runner's child environment is an allowlist. It does **not** accept, read, or forward arbitrary DSNs, `DATABASE_URL`, `SUPABASE_DATABASE_URL`, passwords, or signing credentials.
- PostgreSQL and the temporary tRPC test server bind to `127.0.0.1` on dynamic ports; fixed production/mobile ports `3000` and `8081` are rejected.
- The test accepts only a runner-created random database name, random guard token, matching loopback port, and PostgreSQL 17 before constructing the runtime-role connection. A supplied localhost port alone is insufficient.
- Activity mode selects only `e2e/activity.e2e.config.ts`; default runner mode remains `circle-home` and selects only `e2e/circle-home.e2e.config.ts`.
- All HTTP/database operations have finite timeouts. The HTTP listener, runtime-role pool, and admin pool close in test teardown; the runner stops the owned cluster in `finally`, retries an owned immediate stop if required, and never reports success after unsuccessful stop/removal.
- The only mock is `server/db`'s connection facade. It returns the real local Drizzle database backed by `RuntimeRolePool`. **No router, service, transaction, SQL query, or result is mocked.**

## Fixture identity/authentication seam

The in-test loopback server maps the `x-circle-home-e2e-user` request header only to six predeclared synthetic fixture users. This is a deliberate fixture-auth context seam; no shipped route, production HTTP server, OAuth token issuance, cookies, bearer validation, application-session row, or native code is changed. Consequently, the suite does **not** verify real OAuth/session authentication, rendered UI, iOS/Android behavior, signed builds, or production data access.

## Covered Activity behavior

The sequential suite currently contains **12 real HTTP/PostgreSQL cases**:

1. empty inbox/default preferences and unread watermark;
2. real `social.comment` source action persists metadata-only recipient activity with no body DTO/column;
3. recipient isolation, anonymous denial, and stale `viewerScope` conflict without inbox-state mutation;
4. self-event suppression and duplicate event-helper invocation for one real comment source;
5. global category desired state for future events and partial-patch preservation;
6. per-circle mute for future comments and pending-requester mute before approval;
7. real `social.approveMember` source event and fresh authorized circle resolution;
8. newest-first keyset pagination with a source event inserted between pages and no duplicates;
9. idempotent individual read plus watermark-bounded mark-all preserving a newer arrival;
10. serialized preference/event race with either valid serial result and no duplicate source item;
11. generic unavailable metadata/`null` target after post deletion, membership revocation, or circle deletion;
12. exact 25-table catalog count plus Activity RLS/runtime grants/API-role denial and the local operations health function.

Activity records are always generated through real authorized Social source actions. The duplicate-emitter check invokes the real transaction helper twice for the same already-created comment source; it intentionally does **not** send duplicate comment requests because comments are not idempotent.

## Evidence boundary

A successful run proves local HTTP serialization, router validation, real service queries/locks/transactions, PostgreSQL migration compatibility, runtime-role use, durable synthetic state, and cleanup behavior. It does not prove production rows, provider-managed OAuth, native rendering/device APIs, push/email delivery, or any release/publication outcome.
