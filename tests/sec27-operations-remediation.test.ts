import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "..");
const read = (relativePath: string) =>
  readFileSync(resolve(root, relativePath), "utf8");

function sha256(relativePath: string) {
  return createHash("sha256").update(read(relativePath)).digest("hex");
}

describe("SEC27 operations remediation", () => {
  it("verifies the reviewed PGDG primary fingerprint before APT trusts the fetched key", () => {
    const workflow = read(".github/workflows/ci.yml");
    const expectedFingerprint = "B97B0AFCAA1A47F044F244A07FCC7D46ACCC4CF8";
    const fingerprintIndex = workflow.indexOf(expectedFingerprint);
    const sourceIndex = workflow.indexOf(
      "Signed-By: /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc",
    );
    const updateIndex = workflow.indexOf(
      "sudo apt-get update",
      fingerprintIndex,
    );

    expect(fingerprintIndex).toBeGreaterThan(-1);
    expect(workflow).toContain(
      'gpg --batch --homedir "$gnupg_home" --show-keys --with-colons',
    );
    expect(workflow).toContain(
      'test "$actual_pgdg_primary_fingerprint" = "$expected_pgdg_primary_fingerprint"',
    );
    expect(workflow).toContain(
      "curl --fail --silent --show-error --location --proto '=https' --tlsv1.2",
    );
    expect(workflow).toContain(
      'sudo install --mode=0644 "$key_file" /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc',
    );
    expect(workflow).not.toContain(
      "sudo curl --fail --silent --show-error --location",
    );
    expect(fingerprintIndex).toBeLessThan(sourceIndex);
    expect(fingerprintIndex).toBeLessThan(updateIndex);
  });

  it("excludes private recovery, key, certificate, fixture, and evidence classes from Docker context", () => {
    const dockerignore = read(".dockerignore");
    for (const pattern of [
      "operations/recovery/private/",
      "recovery/",
      "private/",
      "*.age",
      "*.agekey",
      "*.key",
      "*.pem",
      "*.p8",
      "*.p12",
      "*.jks",
      "*.crt",
      "tests/fixtures/",
      "fixtures/",
      "evidence/",
      "operations/evidence/",
    ]) {
      expect(dockerignore).toContain(pattern);
    }
    expect(dockerignore).toContain(
      "!server/certificates/supabase-root-2021.crt",
    );

    const containerWorkflow = read(
      ".github/workflows/container-validation.yml",
    );
    expect(containerWorkflow).toContain(
      "Assert private Docker build-context exclusions",
    );
    expect(containerWorkflow).toContain("operations/recovery/**");
    expect(containerWorkflow).toContain(
      "tests/sec27-operations-remediation.test.ts",
    );
  });

  it("locks the applied initial operations migration while making atomic checksum transport future-only", () => {
    const proposal = read(
      "operations/proposals/sec27-future-operations-migration-transport.md",
    );
    expect(
      sha256(
        "operations/migrations/0001_circles_ops_daily_migration_health.sql",
      ),
    ).toBe("0df6a1076b9adc01e180bb06fca3cb242711038e7b36e5bf36188819ea2ad888");
    expect(proposal).toContain("future-only transport contract");
    expect(proposal).toContain("strictly increasing ordinal");
    expect(proposal).toContain("SHA-256");
    expect(proposal).toContain("one transaction-capable migration transport");
    expect(proposal).toContain("synthetic rollback drill");
    expect(proposal).toContain(
      "must not be used to retry, replace, or edit an already applied migration",
    );
    expect(proposal).toContain("does not install a runner");
  });

  it("keeps complete encrypted-media recovery and health evidence prepared, privacy-bounded, and unactivated", () => {
    const recovery = read("operations/recovery/README.md");
    const evidence = JSON.parse(
      read("operations/recovery/sec27-health-evidence-template.json"),
    );

    expect(recovery).toContain("does not add a recovery identity");
    expect(recovery).toContain("global consumer/admin reader");
    expect(recovery).toContain("20 MiB media limit");
    expect(recovery).toContain("synthetic-only local restore rehearsal");
    expect(recovery).toContain("must not hand-roll AES/GCM");
    expect(recovery).toContain("not a managed-publication replacement");

    expect(evidence).toMatchObject({
      format: "circles-sec27-health-evidence-v1",
      template_only: true,
      contains_live_rows: false,
      contains_credentials: false,
      contains_external_alert_configuration: false,
      schedule_change: "none",
    });
    expect(evidence.existing_scheduler_boundary).toEqual({
      health_job: "preserve-existing-one-active-job",
      watchdog: "preserve-existing-private-watchdog",
      duplicate_cron_or_watchdog: false,
    });
    expect(evidence.synthetic_cases).toHaveLength(3);
    expect(
      evidence.synthetic_cases.every(
        (item: { uses_real_scheduler: boolean }) => !item.uses_real_scheduler,
      ),
    ).toBe(true);
  });
});
