import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  DEFAULT_MANIFEST,
  PROJECT_ROOT,
  inspectRecoveryManifest,
  loadManifest,
  runCli,
  validateExternalEvidence,
  validateManifest,
  validatePreparedMediaLedgerCoverage,
} from "./check-database-recovery-manifest.mjs";

function completeEvidence(observedAt) {
  return {
    format: "circles-database-recovery-evidence-v1",
    manifest_version: 1,
    observed_at: observedAt,
    provenance: {
      method: "authorized_read_only_external_review",
      run_reference: "owner-review-20261027",
    },
    backup_assets: {
      current_successful_run_inspected: true,
      encrypted_asset_set_inspected: true,
      artifact_integrity_verified: true,
      retention_verified: true,
    },
    isolated_restore: {
      target_kind: "isolated_postgresql_17",
      production_target: false,
      network_isolated: true,
      durable_application_state_verified: true,
      durable_admin_state_verified: true,
      durable_publish_state_verified: true,
      operational_history_verified: true,
      oauth_recreated_empty: true,
      optional_identity_status: "not_enabled",
      optional_identity_mapping_verified: false,
    },
    media_and_keys: {
      media_reference_inventory_verified: true,
      media_bytes_continuity_verified: true,
      derivation_material_continuity_verified: true,
      no_material_embedded: true,
    },
    provider: {
      managed_auth_verified: true,
      storage_verified: true,
      platform_configuration_verified: true,
      custom_role_contract_verified: true,
    },
  };
}

test("DB-12 manifest is source-derived and intentionally pending without external evidence", () => {
  const manifest = loadManifest();
  const validation = validateManifest(manifest);
  assert.equal(validation.valid, true, validation.errors.join(","));
  assert.deepEqual(validation.counts, {
    durable_application_tables: 27,
    durable_admin_tables: 8,
    durable_publish_tables: 1,
    operational_history_tables: 1,
    recreate_empty_tables: 1,
    optional_identity_tables: 1,
    catalog_helper_functions: 23,
    catalog_policies: 129,
  });

  const report = inspectRecoveryManifest();
  assert.equal(report.source_status, "SOURCE_CONTRACT_PASS");
  assert.equal(report.external_evidence_status, "PENDING_EXTERNAL_EVIDENCE");
  assert.equal(report.status, "SOURCE_PASS_EXTERNAL_RECOVERY_UNVERIFIED");
});

test("fresh redacted owner attestation is shape-checked but never treated as independent proof", () => {
  const now = new Date("2026-10-27T12:00:00.000Z");
  const validation = validateExternalEvidence(
    completeEvidence("2026-10-27T11:30:00.000Z"),
    { now },
  );
  assert.equal(validation.valid, true, validation.errors.join(","));

  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "circles-db12-evidence-"),
  );
  try {
    const evidencePath = path.join(directory, "redacted-attestation.json");
    fs.writeFileSync(
      evidencePath,
      JSON.stringify(completeEvidence("2026-10-27T11:30:00.000Z")),
      { mode: 0o600 },
    );
    const report = inspectRecoveryManifest({ evidencePath, now });
    assert.equal(
      report.status,
      "SOURCE_PASS_WITH_REDACTED_EXTERNAL_ATTESTATION",
    );
    assert.equal(
      report.external_evidence_status,
      "ATTESTATION_COMPLETE_NOT_INDEPENDENTLY_VERIFIED",
    );
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("stale, incomplete, or secret-shaped evidence fails closed", () => {
  const now = new Date("2026-10-27T12:00:00.000Z");
  assert.equal(
    validateExternalEvidence(completeEvidence("2026-10-24T12:00:00.000Z"), {
      now,
    }).valid,
    false,
  );
  const incomplete = completeEvidence("2026-10-27T11:30:00.000Z");
  incomplete.media_and_keys.media_bytes_continuity_verified = false;
  assert.equal(validateExternalEvidence(incomplete, { now }).valid, false);
  const unredacted = completeEvidence("2026-10-27T11:30:00.000Z");
  unredacted.provenance.token = "not-permitted";
  assert.equal(validateExternalEvidence(unredacted, { now }).valid, false);
});

test("CLI only requires external evidence when explicitly requested", () => {
  const output = [];
  assert.equal(runCli([], { output: (value) => output.push(value) }), 0);
  assert.equal(runCli(["--require-evidence"], { output: () => {} }), 1);
  assert.equal(
    JSON.parse(output[0]).external_evidence_status,
    "PENDING_EXTERNAL_EVIDENCE",
  );
  assert.equal(
    DEFAULT_MANIFEST.endsWith(
      "operations/recovery/database-recovery-manifest.json",
    ),
    true,
  );
});

test("CBA-06 prepared ledger scope is separate, closed and not installed backup evidence", () => {
  const manifest = loadManifest();
  assert.equal(validatePreparedMediaLedgerCoverage(manifest).valid, true);
  for (const mutate of [
    (group) => {
      group.schema = "circles_app";
    },
    (group) => {
      group.state = "installed";
    },
    (group) => {
      group.tables.push({
        name: "foreignLedger",
        source: "drizzle/media-upload-budget-schema.ts",
      });
    },
    (group) => {
      group.tables[0].source = "drizzle/schema.ts";
    },
    (group) => {
      group.live_backup_activation = "verified";
    },
  ]) {
    const altered = structuredClone(manifest);
    mutate(altered.coverage.prepared_private_media_ledger);
    assert.equal(validatePreparedMediaLedgerCoverage(altered).valid, false);
    assert.equal(validateManifest(altered).valid, false);
  }
});

test("CBA-06 recovery scope rejects changed SQL, unsafe restore and premature archive attestations", () => {
  const manifest = loadManifest();
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "circles-cba06-recovery-"),
  );
  const relativePaths = [
    "drizzle/media-upload-budget-schema.ts",
    "operations/migrations/0023_circles_ops_policy_health.sql",
    "operations/migrations/0024_circles_live_chat_bounds.sql",
    "operations/migrations/0025_circles_media_upload_budget.sql",
    "operations/migrations/cba06-ordered-rollout-manifest.json",
    "operations/recovery/cba06-private-media-ledger-backup-scope.json",
  ];
  const restoreSources = () => {
    for (const relative of relativePaths) {
      const target = path.join(directory, relative);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.copyFileSync(path.join(PROJECT_ROOT, relative), target);
    }
  };
  const scopePath = path.join(
    directory,
    "operations/recovery/cba06-private-media-ledger-backup-scope.json",
  );
  try {
    restoreSources();
    assert.equal(
      validatePreparedMediaLedgerCoverage(manifest, { sourceRoot: directory })
        .valid,
      true,
    );
    fs.appendFileSync(
      path.join(
        directory,
        "operations/migrations/0025_circles_media_upload_budget.sql",
      ),
      "\n-- unreviewed changed SQL\n",
    );
    assert.deepEqual(
      validatePreparedMediaLedgerCoverage(manifest, { sourceRoot: directory })
        .errors,
      ["prepared_media_ledger_rollout_invalid"],
    );
    for (const mutate of [
      (scope) => {
        scope.isolated_restore.production_target = true;
      },
      (scope) => {
        scope.activation.candidate_migration_applied = true;
      },
      (scope) => {
        scope.evidence_limits.backup_run_verified = true;
      },
      (scope) => {
        scope.encrypted_backup_scope.archive_classification =
          "public_plaintext";
      },
      (scope) => {
        scope.ledger.api_roles_denied.pop();
      },
      (scope) => {
        scope.encrypted_backup_scope.forbidden_outputs.pop();
      },
    ]) {
      restoreSources();
      const scope = JSON.parse(fs.readFileSync(scopePath, "utf8"));
      mutate(scope);
      fs.writeFileSync(scopePath, JSON.stringify(scope));
      assert.deepEqual(
        validatePreparedMediaLedgerCoverage(manifest, { sourceRoot: directory })
          .errors,
        ["prepared_media_ledger_backup_scope_invalid"],
      );
    }
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
