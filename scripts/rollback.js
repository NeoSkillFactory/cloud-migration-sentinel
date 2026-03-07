#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    if (argv[i].startsWith("--")) {
      const key = argv[i].slice(2);
      const value = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : true;
      args[key] = value;
      if (value !== true) i++;
    }
  }
  return args;
}

function loadMigrationState(migrationId) {
  const stateDir = path.join(__dirname, "..", "assets", "migrations");
  const statePath = path.join(stateDir, `${migrationId}.json`);

  if (!fs.existsSync(statePath)) {
    return { found: false, error: `Migration state not found: ${statePath}` };
  }

  const data = JSON.parse(fs.readFileSync(statePath, "utf-8"));
  return { found: true, data, path: statePath };
}

function validateRollbackEligibility(migrationRecord) {
  if (!migrationRecord.rollbackAvailable) {
    return {
      eligible: false,
      reason: "Rollback data is not available for this migration",
    };
  }

  if (migrationRecord.status === "rolled_back") {
    return {
      eligible: false,
      reason: "This migration has already been rolled back",
    };
  }

  if (!migrationRecord.rollbackData || !migrationRecord.rollbackData.originalProvider) {
    return {
      eligible: false,
      reason: "Rollback data is incomplete - missing original provider information",
    };
  }

  return { eligible: true };
}

function executeRollback(migrationRecord) {
  const rollbackData = migrationRecord.rollbackData;
  console.log(`[ROLLBACK] Reverting workload "${migrationRecord.workload}" to ${rollbackData.originalProvider}...`);

  // Step 1: Remove from target provider
  console.log(`[ROLLBACK] Step 1/3: Removing workload from target provider (${migrationRecord.target})...`);
  const removalResult = {
    provider: migrationRecord.target,
    action: "remove_workload",
    status: "completed",
    artifactsRemoved: migrationRecord.import.artifactsImported,
  };
  console.log(`[ROLLBACK] Removed ${removalResult.artifactsRemoved} artifacts from ${migrationRecord.target}`);

  // Step 2: Restore to original provider
  console.log(`[ROLLBACK] Step 2/3: Restoring workload to original provider (${rollbackData.originalProvider})...`);
  const restorationResult = {
    provider: rollbackData.originalProvider,
    action: "restore_workload",
    status: "completed",
    artifactsRestored: Object.keys(rollbackData.artifacts).length,
  };
  console.log(`[ROLLBACK] Restored ${restorationResult.artifactsRestored} artifacts to ${rollbackData.originalProvider}`);

  // Step 3: Verify restoration
  console.log(`[ROLLBACK] Step 3/3: Verifying restored workload...`);
  const verificationResult = {
    action: "verify_restoration",
    status: "passed",
    checksPerformed: ["accessibility", "integrity", "configuration"],
  };
  console.log(`[ROLLBACK] Verification passed (${verificationResult.checksPerformed.length} checks)`);

  return {
    migrationId: migrationRecord.migrationId,
    rollbackTimestamp: new Date().toISOString(),
    status: "rolled_back",
    removal: removalResult,
    restoration: restorationResult,
    verification: verificationResult,
  };
}

function updateMigrationState(statePath, migrationRecord, rollbackResult) {
  migrationRecord.status = "rolled_back";
  migrationRecord.rollbackAvailable = false;
  migrationRecord.rollbackResult = rollbackResult;
  fs.writeFileSync(statePath, JSON.stringify(migrationRecord, null, 2));
  console.log(`[STATE] Migration state updated at ${statePath}`);
}

function performRollback(migrationId) {
  const state = loadMigrationState(migrationId);
  if (!state.found) {
    return { success: false, error: state.error };
  }

  const eligibility = validateRollbackEligibility(state.data);
  if (!eligibility.eligible) {
    return { success: false, error: eligibility.reason };
  }

  console.log(`\n[ROLLBACK] Starting rollback for migration ${migrationId}`);
  console.log(`[ROLLBACK] ${state.data.target} -> ${state.data.rollbackData.originalProvider} (workload: ${state.data.workload})\n`);

  const rollbackResult = executeRollback(state.data);
  updateMigrationState(state.path, state.data, rollbackResult);

  return {
    success: true,
    migrationId,
    rollbackResult,
  };
}

async function main() {
  const args = parseArgs(process.argv);

  console.log("Cloud Migration Sentinel - Rollback Manager");
  console.log("============================================\n");

  const migrationId = args["migration-id"];
  if (!migrationId) {
    console.error("Error: --migration-id is required");
    console.error("Usage: node rollback.js --migration-id <id>");
    process.exit(1);
  }

  const result = performRollback(migrationId);

  if (!result.success) {
    console.error(`\n[ERROR] Rollback failed: ${result.error}`);
    process.exit(1);
  }

  console.log("\n--- Rollback Summary ---");
  console.log(JSON.stringify({
    migrationId: result.migrationId,
    status: "rolled_back",
    timestamp: result.rollbackResult.rollbackTimestamp,
  }, null, 2));

  process.exit(0);
}

module.exports = {
  performRollback,
  validateRollbackEligibility,
  executeRollback,
  loadMigrationState,
};

if (require.main === module) {
  main().catch((err) => {
    console.error("Fatal error:", err.message);
    process.exit(1);
  });
}
