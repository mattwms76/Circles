# Private OAuth helper audit

`pnpm audit:oauth` audits only the deployed `circles_auth.oauth_pending_states` helper. It is separate from `pnpm audit:database` for the 22-table `circles_app` baseline and does not alter the existing daily health job 7, private operational watchdog or encrypted backup schedule.

Run from an authorized protected shell with the existing PostgreSQL configuration injected; never place a database URL on the command line. Both outputs must be distinct new files in an owner-only directory outside the actual Git root:

```bash
umask 077
mkdir -p /private/circles-audit
chmod 700 /private/circles-audit
pnpm audit:oauth \
  --json-output /private/circles-audit/oauth-audit.json \
  --markdown-output /private/circles-audit/oauth-audit.md
```

The audit uses catalog metadata in a read-only transaction and separate fixed-role `SELECT 1 ... LIMIT 1` probes. It exports no OAuth values, row counts, fingerprints, bearer/configuration values or raw driver diagnostics. It checks forced RLS, the exact runtime-only policy, non-elevated runtime role, exact privileges (SELECT/INSERT/DELETE only), every non-owner ACL grantee, validated constraints, ready/valid indexes and effective global-plus-schema default ACLs. Full reviewed PostgreSQL17 structural definitions are matched; keyword substrings are not accepted. Symlink/subdirectory output bypasses are refused, and reports are written exclusively with mode 0600.

The corrected live read-only audit passed on 23 October 2026. The initial draft had structural-normalization and default-ACL false positives; those were fixed in tooling, not by broadening production grants. Independently reviewed structural/ACL/output-path weaknesses now have regressions.

FAIL, UNKNOWN or unavailable metadata is fail-closed. Compare failures against the reviewed migration before deciding whether the checker or database configuration needs repair; this tool performs no automatic repair. Catalog/probe evidence does not establish every Data API/gateway exposure path and is not per-user/per-circle authorization proof. The policy remains a backend-only gate behind application authorization.
