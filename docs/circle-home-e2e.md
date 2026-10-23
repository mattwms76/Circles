# Circle Home isolated HTTP E2E

This is an **API-layer integration/E2E suite**, not a native-device or OAuth-provider E2E test. It exercises a real localhost tRPC HTTP adapter, the production `circleHome` router, the real social-service queries, Drizzle, PostgreSQL 17, and the `RuntimeRolePool` (`SET ROLE circles_app_runtime`) against a fresh disposable database.

## Run

```bash
pnpm test:e2e:circle-home
```

Run on Linux (or a suitable Linux development environment) as a non-root user with the checked-in locked dependencies and these tools:

- `/usr/lib/postgresql/17/bin/{initdb,pg_ctl}`
- `/usr/bin/python3` with `psycopg`
- Node `22.23.4`, discovered from the invoking npm/pnpm process or current PATH and version-checked before startup.
- The existing locked project Vitest installation; no Sandbox-specific Node/pnpm cache path is required. Install dependencies with the declared pnpm version and frozen lock first.

It applies the private PostgreSQL baseline and Circle Home feature migrations to a new temporary PG17 cluster, inserts only synthetic users/circles/memberships/posts, runs `e2e/circle-home.e2e.ts` with `e2e/circle-home.e2e.config.ts`, then stops PostgreSQL and removes the temporary directory in `finally`.

## Safety contract

- The Python runner constructs a new child environment from an allowlist. It **does not read, forward, or accept** `DATABASE_URL`, `SUPABASE_DATABASE_URL`, or any arbitrary test DSN.
- PostgreSQL and the temporary tRPC HTTP server both bind to `127.0.0.1` on dynamically selected ports; the runner rejects ports `3000` and `8081` for PostgreSQL, and the test rejects those ports for HTTP.
- Each run generates a new database name and random ownership marker. The test verifies that marker, database identity, server port and PG17 version using a read-only guard before constructing the runtime connection. Supplying a localhost port alone cannot authorize destructive fixture tests against another local database.
- The test has bounded HTTP requests and local database timeouts. It closes the HTTP server, admin pool, and runtime-role pool; the runner additionally stops PostgreSQL on every failure path.
- A stop/removal failure makes the runner fail rather than emit a successful cleanup claim. If PostgreSQL cannot be stopped even with its own immediate-stop fallback, the private synthetic directory is retained instead of deleting a live data directory.
- The sole `vi.mock` is `server/db`'s `getDb` connection facade. It returns a real local Drizzle database backed by `RuntimeRolePool`; **no router, service, or query result is mocked**.

## Authentication boundary

The fixture test context accepts the `x-circle-home-e2e-user` header only on its in-test loopback server and maps it to a predeclared synthetic fixture account. This is intentionally limited to test HTTP context creation; it does not modify or expose any production route, cookie, bearer token, OAuth flow, or native client behavior. The synthetic session header is therefore **not evidence of OAuth/session/native-device E2E coverage**. Real `applicationSessions` are not consulted by this layer because the fixture injects the already-authenticated `ctx.user` at that documented test boundary.

## Covered behavior

The suite checks default homes; guest/public and approved/private visibility; manager authority; scope conflicts; owner retry normalization; moderator edits; denials for non-managers and anonymous callers; scoped missing/foreign pin errors; pin replacement/clear retries independent of text; delete-driven FK clearing; Unicode/rule bounds; and a parent-lock serialized membership-removal denial.

## Verified delivery — 23 October 2026

The hardened suite passed all 8 real HTTP/PostgreSQL17 cases locally and removed its temporary fixture. The complete local regression pass reported 389 unit tests across 76 files, including the CI/safety wrappers; the Python runner guard suite separately reported 4 cases. TypeScript, zero-warning lint, database-audit tests, environment checks, API build and workflow lint also passed.

The source-equivalent canonical commit `56c9a4f` and separate GitHub commit `1db3571` were saved with normal history. Exact-source CI run `39973753404` succeeded, including explicit PostgreSQL17 provisioning, the same isolated E2E command and iOS/Android/Web JavaScript exports. Container run `39973753400` succeeded. These results do not claim real OAuth/session verification, rendered native UI, device permissions, a signed native release or app publication. Existing API and Metro listeners remained unchanged and ready.
