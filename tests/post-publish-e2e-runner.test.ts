import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const runner = readFileSync(
  new URL("../scripts/run-circle-home-e2e.py", import.meta.url),
  "utf8",
);
const config = readFileSync(
  new URL("../e2e/post-publish-idempotency.e2e.config.ts", import.meta.url),
  "utf8",
);

describe("isolated post publication HTTP E2E runner", () => {
  it("keeps the suite outside unit discovery with a fixed hardened runner mode", () => {
    expect(config).toContain(
      'include: ["e2e/post-publish-idempotency.e2e.ts"]',
    );
    expect(runner).toContain('"post-publish-idempotency"');
    expect(runner).toContain("e2e/post-publish-idempotency.e2e.config.ts");
    expect(runner).toContain("0014_circles_email_identity.sql");
    expect(runner).toContain("0015_circles_publish_post_receipts.sql");
    expect(runner).toContain("CIRCLE_HOME_E2E_TOKEN");
    expect(runner).not.toContain("DATABASE_URL");
    expect(runner).not.toContain("SUPABASE_DATABASE_URL");
  });
});
