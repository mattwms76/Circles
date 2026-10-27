import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  DEFAULT_MANIFEST,
  inspectRecoveryManifest,
  loadManifest,
  runCli,
  validateExternalEvidence,
  validateManifest,
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
  const validation = validateExternalEvidence(completeEvidence("2026-10-27T11:30:00.000Z"), { now });
  assert.equal(validation.valid, true, validation.errors.join(","));

  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "circles-db12-evidence-"));
  try {
    const evidencePath = path.join(directory, "redacted-attestation.json");
    fs.writeFileSync(evidencePath, JSON.stringify(completeEvidence("2026-10-27T11:30:00.000Z")), { mode: 0o600 });
    const report = inspectRecoveryManifest({ evidencePath, now });
    assert.equal(report.status, "SOURCE_PASS_WITH_REDACTED_EXTERNAL_ATTESTATION");
    assert.equal(report.external_evidence_status, "ATTESTATION_COMPLETE_NOT_INDEPENDENTLY_VERIFIED");
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("stale, incomplete, or secret-shaped evidence fails closed", () => {
  const now = new Date("2026-10-27T12:00:00.000Z");
  assert.equal(
    validateExternalEvidence(completeEvidence("2026-10-24T12:00:00.000Z"), { now }).valid,
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
  assert.equal(JSON.parse(output[0]).external_evidence_status, "PENDING_EXTERNAL_EVIDENCE");
  assert.equal(DEFAULT_MANIFEST.endsWith("operations/recovery/database-recovery-manifest.json"), true);
});
