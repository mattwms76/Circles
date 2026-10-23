# Moderator Report Workspace isolated HTTP E2E

This is an **API-layer HTTP integration/E2E suite**, not a rendered-native, OAuth-provider, device, or production-database test. It exercises a real loopback Express/tRPC adapter, production `moderation` and `social` routers, real report/deletion/resolution services, Drizzle, PostgreSQL 17, and `RuntimeRolePool` (`SET ROLE circles_app_runtime`) against a newly created local database.

## Run

```bash
pnpm test:e2e:moderation
# equivalent explicit runner form
/usr/bin/python3 scripts/run-circle-home-e2e.py --suite moderation
```

The runner requires the same Linux dependencies as Circle Home/Activity E2E:

- `/usr/lib/postgresql/17/bin/{initdb,pg_ctl}`
- `/usr/bin/python3` with `psycopg`
- Node `22.23.4`, version-checked before startup
- checked-in project dependencies including Vitest

Moderation mode requires **both** `0012_circles_moderation.sql` and `0013_circles_ops_moderation_health.sql`, and the preceding Activity schema/health pair. It refuses an incomplete pair. Circle Home and Activity likewise receive the moderation migrations only when the complete pair is present, never an orphan feature or health definition.

Before `0012`, the runner inserts only synthetic legacy, circle-scoped report rows. The actual migration must aggregate them into cases; the suite does not replace legacy mapping with post-migration fixture data.

## Safety contract

- The child environment is an explicit allowlist. It does **not** read, accept, or forward arbitrary DSNs, `DATABASE_URL`, `SUPABASE_DATABASE_URL`, passwords, provider secrets, or signing credentials.
- PostgreSQL and the temporary tRPC server bind only to `127.0.0.1` on dynamic ports; fixture PostgreSQL rejects `3000` and `8081`.
- Each invocation owns a random database name and marker token. Before runtime-role construction, the test verifies database identity, marker, loopback port, and PostgreSQL 17.
- HTTP/database operations are bounded. Test teardown closes the listener and both pools; the runner stops its owned cluster in `finally`, attempts its own immediate-stop fallback, and fails rather than claiming cleanup if stopping/removal fails.
- The sole mock is `server/db`'s connection facade. It returns a real local Drizzle database backed by `RuntimeRolePool`; no router, service, transaction, SQL query, or response is mocked.
- `x-circle-home-e2e-user` is accepted only by the in-test loopback context and selects predeclared synthetic users. It does not modify shipped authentication, OAuth, cookies, bearer validation, session rows, or native code.

## Covered behavior

The sequential suite covers:

1. eligible pre-0012 legacy report mapping and anonymous aggregate reasons/counts;
2. omission of reporter fields from queue/detail/history responses and moderation tables;
3. guest/member/pending/foreign-circle denial and stale `viewerScope` conflict;
4. real `social.report` retry aggregation without duplicate reporter contribution;
5. open/resolved filters and newest-first keyset pagination;
6. current post target versus safe unavailable target after deletion;
7. self-review denial, current role revocation, Keep/Remove finality, exact desired retries, and opposing concurrent resolutions;
8. retained minimal Keep/Remove history after target FK clearing and later reports that cannot reopen a final case; and
9. exact 27-table private/RLS/runtime/API-role/health checks.

## Evidence boundary

A passing run proves local HTTP serialization, router validation, report/deletion/resolution transaction behavior, PostgreSQL migration compatibility, runtime-role use, synthetic durable state, and cleanup. It does **not** prove production rows, real OAuth/session authentication, browser UI, iOS/Android assistive technology, signed builds, provider-object erasure, or app publication.
