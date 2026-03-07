#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const providersPath = path.join(__dirname, "providers.json");
const errorCodesPath = path.join(__dirname, "error-codes.json");

function loadJSON(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf-8"));
}

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

function generateMigrationId() {
  return `mig-${crypto.randomBytes(6).toString("hex")}`;
}

function validateProvider(providerName, providersConfig) {
  const provider = providersConfig.providers[providerName];
  if (!provider) {
    return {
      valid: false,
      error: `Unknown provider: ${providerName}`,
      available: Object.keys(providersConfig.providers),
    };
  }
  return { valid: true, provider };
}

function selectTargetProvider(sourceProvider, providersConfig) {
  const priority = providersConfig.migrationPriority;
  const target = priority.find((p) => p !== sourceProvider);
  if (!target) {
    return { selected: false, error: "No alternative provider available" };
  }
  return {
    selected: true,
    provider: target,
    config: providersConfig.providers[target],
  };
}

function exportWorkload(sourceProvider, workloadName, migrationId) {
  console.log(`[EXPORT] Exporting workload "${workloadName}" from ${sourceProvider}...`);

  const exportData = {
    migrationId,
    source: sourceProvider,
    workload: workloadName,
    exportTimestamp: new Date().toISOString(),
    artifacts: {
      configuration: {
        type: "config",
        size: "2.4KB",
        checksum: crypto.createHash("sha256").update(`${workloadName}-config`).digest("hex").slice(0, 16),
      },
      state: {
        type: "state-snapshot",
        size: "15.8KB",
        checksum: crypto.createHash("sha256").update(`${workloadName}-state`).digest("hex").slice(0, 16),
      },
      environment: {
        type: "env-vars",
        size: "0.5KB",
        checksum: crypto.createHash("sha256").update(`${workloadName}-env`).digest("hex").slice(0, 16),
      },
    },
    status: "exported",
  };

  console.log(`[EXPORT] Successfully exported ${Object.keys(exportData.artifacts).length} artifacts`);
  return exportData;
}

function importWorkload(targetProvider, targetConfig, exportData, migrationId) {
  console.log(`[IMPORT] Importing workload "${exportData.workload}" to ${targetProvider}...`);
  console.log(`[IMPORT] Target free-tier: ${JSON.stringify(targetConfig.freeTier)}`);

  const importResult = {
    migrationId,
    target: targetProvider,
    workload: exportData.workload,
    importTimestamp: new Date().toISOString(),
    resourceMapping: {
      compute: targetConfig.freeTier.compute,
      storage: targetConfig.freeTier.storage,
      tier: targetConfig.freeTier.duration,
    },
    artifactsImported: Object.keys(exportData.artifacts).length,
    status: "imported",
  };

  console.log(`[IMPORT] Successfully imported to ${targetProvider} (${targetConfig.freeTier.compute})`);
  return importResult;
}

function createMigrationRecord(migrationId, source, target, workload, exportData, importResult) {
  return {
    migrationId,
    source,
    target,
    workload,
    startedAt: exportData.exportTimestamp,
    completedAt: importResult.importTimestamp,
    status: "completed",
    export: exportData,
    import: importResult,
    rollbackAvailable: true,
    rollbackData: {
      originalProvider: source,
      artifacts: exportData.artifacts,
    },
  };
}

function saveMigrationState(migrationRecord) {
  const stateDir = path.join(__dirname, "..", "assets", "migrations");
  if (!fs.existsSync(stateDir)) {
    fs.mkdirSync(stateDir, { recursive: true });
  }
  const statePath = path.join(stateDir, `${migrationRecord.migrationId}.json`);
  fs.writeFileSync(statePath, JSON.stringify(migrationRecord, null, 2));
  console.log(`[STATE] Migration state saved to ${statePath}`);
  return statePath;
}

function simulateMigration(source, target, workload) {
  const providersConfig = loadJSON(providersPath);

  const sourceValidation = validateProvider(source, providersConfig);
  if (!sourceValidation.valid) {
    return { success: false, error: sourceValidation.error };
  }

  let targetName = target;
  let targetConfig;

  if (target) {
    const targetValidation = validateProvider(target, providersConfig);
    if (!targetValidation.valid) {
      return { success: false, error: targetValidation.error };
    }
    targetConfig = targetValidation.provider;
  } else {
    const selection = selectTargetProvider(source, providersConfig);
    if (!selection.selected) {
      return { success: false, error: selection.error };
    }
    targetName = selection.provider;
    targetConfig = selection.config;
  }

  if (source === targetName) {
    return { success: false, error: "Source and target providers cannot be the same" };
  }

  const migrationId = generateMigrationId();
  const workloadName = workload || "default-workload";

  console.log(`\n[MIGRATION] Starting migration ${migrationId}`);
  console.log(`[MIGRATION] ${source} -> ${targetName} (workload: ${workloadName})\n`);

  // Step 1: Export
  const exportData = exportWorkload(source, workloadName, migrationId);

  // Step 2: Import
  const importResult = importWorkload(targetName, targetConfig, exportData, migrationId);

  // Step 3: Create record
  const record = createMigrationRecord(migrationId, source, targetName, workloadName, exportData, importResult);

  // Step 4: Save state
  const statePath = saveMigrationState(record);

  console.log(`\n[MIGRATION] Migration ${migrationId} completed successfully`);

  return {
    success: true,
    migrationId,
    source,
    target: targetName,
    workload: workloadName,
    statePath,
    record,
  };
}

async function main() {
  const args = parseArgs(process.argv);

  console.log("Cloud Migration Sentinel - Workload Migrator");
  console.log("=============================================\n");

  const source = args.source;
  const target = args.target;
  const workload = args.workload || "default-workload";

  if (!source) {
    console.error("Error: --source provider is required");
    console.error("Usage: node migrator.js --source <provider> [--target <provider>] [--workload <name>]");
    process.exit(1);
  }

  const result = simulateMigration(source, target, workload);

  if (!result.success) {
    console.error(`\n[ERROR] Migration failed: ${result.error}`);
    process.exit(1);
  }

  console.log("\n--- Migration Summary ---");
  console.log(JSON.stringify({
    migrationId: result.migrationId,
    source: result.source,
    target: result.target,
    workload: result.workload,
    status: "completed",
  }, null, 2));

  process.exit(0);
}

module.exports = {
  simulateMigration,
  validateProvider,
  selectTargetProvider,
  exportWorkload,
  importWorkload,
  generateMigrationId,
  createMigrationRecord,
};

if (require.main === module) {
  main().catch((err) => {
    console.error("Fatal error:", err.message);
    process.exit(1);
  });
}
