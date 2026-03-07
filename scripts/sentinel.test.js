#!/usr/bin/env node
"use strict";

const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const { simulateDetection, resolveErrorAction, parseArgs } = require("./detector");
const { simulateMigration, validateProvider, selectTargetProvider, exportWorkload, generateMigrationId, createMigrationRecord } = require("./migrator");
const { performHealthCheck, calculateDuration, loadMigrationState, listMigrations } = require("./monitor");
const { validateRollbackEligibility, performRollback } = require("./rollback");

const migrationsDir = path.join(__dirname, "..", "assets", "migrations");

// Clean up test migration files after tests
function cleanupTestMigrations() {
  if (fs.existsSync(migrationsDir)) {
    const files = fs.readdirSync(migrationsDir);
    files.forEach((f) => {
      if (f.startsWith("mig-")) {
        fs.unlinkSync(path.join(migrationsDir, f));
      }
    });
  }
}

// =====================
// Detector Tests
// =====================

describe("Detector", () => {
  describe("simulateDetection", () => {
    it("should detect active status", () => {
      const result = simulateDetection("aws", "active");
      assert.equal(result.status, "active");
      assert.equal(result.provider, "aws");
      assert.equal(result.displayName, "Amazon Web Services");
      assert.equal(result.details.httpStatus, 200);
      assert.ok(result.details.freeTier);
    });

    it("should detect suspended status", () => {
      const result = simulateDetection("aws", "suspended");
      assert.equal(result.status, "suspended");
      assert.equal(result.details.httpStatus, 403);
      assert.equal(result.details.action, "trigger_migration");
      assert.ok(result.details.recommendedTarget);
      assert.notEqual(result.details.recommendedTarget, "aws");
    });

    it("should detect rate_limited status", () => {
      const result = simulateDetection("gcloud", "rate_limited");
      assert.equal(result.status, "rate_limited");
      assert.equal(result.details.httpStatus, 429);
      assert.equal(result.details.retryable, true);
    });

    it("should return error for unknown provider", () => {
      const result = simulateDetection("unknown_provider", "active");
      assert.ok(result.error);
      assert.ok(result.availableProviders.includes("aws"));
    });

    it("should work for all configured providers", () => {
      const providers = ["aws", "gcloud", "azure", "oracle"];
      providers.forEach((p) => {
        const result = simulateDetection(p, "active");
        assert.equal(result.status, "active");
        assert.equal(result.provider, p);
      });
    });
  });

  describe("resolveErrorAction", () => {
    const errorCodes = JSON.parse(fs.readFileSync(path.join(__dirname, "error-codes.json"), "utf-8"));

    it("should resolve 403 to ProviderAccessDenied", () => {
      const result = resolveErrorAction(403, errorCodes);
      assert.equal(result.code, "ProviderAccessDenied");
      assert.equal(result.retryable, false);
    });

    it("should resolve 429 to RateLimitExceeded", () => {
      const result = resolveErrorAction(429, errorCodes);
      assert.equal(result.code, "RateLimitExceeded");
      assert.equal(result.retryable, true);
    });

    it("should handle unknown status codes", () => {
      const result = resolveErrorAction(999, errorCodes);
      assert.equal(result.code, "UnknownError");
      assert.equal(result.retryable, false);
    });
  });

  describe("parseArgs", () => {
    it("should parse key-value args", () => {
      const result = parseArgs(["node", "script", "--provider", "aws", "--status", "active"]);
      assert.equal(result.provider, "aws");
      assert.equal(result.status, "active");
    });

    it("should parse boolean flags", () => {
      const result = parseArgs(["node", "script", "--simulate", "--provider", "aws"]);
      assert.equal(result.simulate, true);
      assert.equal(result.provider, "aws");
    });
  });
});

// =====================
// Migrator Tests
// =====================

describe("Migrator", () => {
  before(() => {
    cleanupTestMigrations();
  });

  after(() => {
    cleanupTestMigrations();
  });

  describe("validateProvider", () => {
    const providersConfig = JSON.parse(fs.readFileSync(path.join(__dirname, "providers.json"), "utf-8"));

    it("should validate known provider", () => {
      const result = validateProvider("aws", providersConfig);
      assert.equal(result.valid, true);
      assert.ok(result.provider);
    });

    it("should reject unknown provider", () => {
      const result = validateProvider("nonexistent", providersConfig);
      assert.equal(result.valid, false);
      assert.ok(result.error);
    });
  });

  describe("selectTargetProvider", () => {
    const providersConfig = JSON.parse(fs.readFileSync(path.join(__dirname, "providers.json"), "utf-8"));

    it("should select alternative provider", () => {
      const result = selectTargetProvider("aws", providersConfig);
      assert.equal(result.selected, true);
      assert.notEqual(result.provider, "aws");
    });

    it("should select gcloud as first priority for non-gcloud sources", () => {
      const result = selectTargetProvider("aws", providersConfig);
      assert.equal(result.provider, "gcloud");
    });

    it("should select oracle when source is gcloud", () => {
      const result = selectTargetProvider("gcloud", providersConfig);
      assert.equal(result.provider, "oracle");
    });
  });

  describe("generateMigrationId", () => {
    it("should generate unique IDs", () => {
      const id1 = generateMigrationId();
      const id2 = generateMigrationId();
      assert.notEqual(id1, id2);
      assert.ok(id1.startsWith("mig-"));
    });
  });

  describe("exportWorkload", () => {
    it("should export workload artifacts", () => {
      const result = exportWorkload("aws", "test-workload", "test-id");
      assert.equal(result.source, "aws");
      assert.equal(result.workload, "test-workload");
      assert.equal(result.status, "exported");
      assert.ok(result.artifacts.configuration);
      assert.ok(result.artifacts.state);
      assert.ok(result.artifacts.environment);
    });
  });

  describe("simulateMigration", () => {
    it("should complete a full migration", () => {
      const result = simulateMigration("aws", "gcloud", "test-agent");
      assert.equal(result.success, true);
      assert.equal(result.source, "aws");
      assert.equal(result.target, "gcloud");
      assert.ok(result.migrationId);
      assert.ok(result.statePath);
    });

    it("should auto-select target when not specified", () => {
      const result = simulateMigration("aws", null, "test-agent");
      assert.equal(result.success, true);
      assert.equal(result.target, "gcloud");
    });

    it("should fail when source equals target", () => {
      const result = simulateMigration("aws", "aws", "test-agent");
      assert.equal(result.success, false);
      assert.ok(result.error.includes("same"));
    });

    it("should fail for unknown source provider", () => {
      const result = simulateMigration("nonexistent", "aws", "test-agent");
      assert.equal(result.success, false);
    });
  });
});

// =====================
// Monitor Tests
// =====================

describe("Monitor", () => {
  let testMigrationId;

  before(() => {
    cleanupTestMigrations();
    const result = simulateMigration("aws", "gcloud", "monitor-test");
    testMigrationId = result.migrationId;
  });

  after(() => {
    cleanupTestMigrations();
  });

  describe("loadMigrationState", () => {
    it("should load existing migration state", () => {
      const state = loadMigrationState(testMigrationId);
      assert.equal(state.found, true);
      assert.equal(state.data.migrationId, testMigrationId);
    });

    it("should return not found for missing migration", () => {
      const state = loadMigrationState("nonexistent-id");
      assert.equal(state.found, false);
      assert.ok(state.error);
    });
  });

  describe("listMigrations", () => {
    it("should list all migrations", () => {
      const result = listMigrations();
      assert.ok(result.migrations.length > 0);
      assert.ok(result.migrations.some((m) => m.migrationId === testMigrationId));
    });
  });

  describe("performHealthCheck", () => {
    it("should return healthy status for valid migration", () => {
      const state = loadMigrationState(testMigrationId);
      const result = performHealthCheck(state.data);
      assert.equal(result.overallStatus, "healthy");
      assert.equal(result.checks.length, 5);
      assert.ok(result.checks.every((c) => c.status === "passed"));
    });
  });

  describe("calculateDuration", () => {
    it("should format milliseconds", () => {
      const now = new Date();
      const later = new Date(now.getTime() + 500);
      assert.equal(calculateDuration(now.toISOString(), later.toISOString()), "500ms");
    });

    it("should format seconds", () => {
      const now = new Date();
      const later = new Date(now.getTime() + 5000);
      assert.equal(calculateDuration(now.toISOString(), later.toISOString()), "5.0s");
    });

    it("should format minutes", () => {
      const now = new Date();
      const later = new Date(now.getTime() + 120000);
      assert.equal(calculateDuration(now.toISOString(), later.toISOString()), "2.0m");
    });
  });
});

// =====================
// Rollback Tests
// =====================

describe("Rollback", () => {
  let testMigrationId;

  before(() => {
    cleanupTestMigrations();
    const result = simulateMigration("aws", "azure", "rollback-test");
    testMigrationId = result.migrationId;
  });

  after(() => {
    cleanupTestMigrations();
  });

  describe("validateRollbackEligibility", () => {
    it("should approve eligible migration for rollback", () => {
      const state = loadMigrationState(testMigrationId);
      const result = validateRollbackEligibility(state.data);
      assert.equal(result.eligible, true);
    });

    it("should reject already rolled back migration", () => {
      const result = validateRollbackEligibility({ status: "rolled_back", rollbackAvailable: true, rollbackData: { originalProvider: "aws" } });
      assert.equal(result.eligible, false);
    });

    it("should reject when rollback not available", () => {
      const result = validateRollbackEligibility({ rollbackAvailable: false });
      assert.equal(result.eligible, false);
    });
  });

  describe("performRollback", () => {
    it("should successfully rollback a migration", () => {
      const result = performRollback(testMigrationId);
      assert.equal(result.success, true);
      assert.ok(result.rollbackResult);
      assert.equal(result.rollbackResult.status, "rolled_back");
    });

    it("should fail to rollback same migration twice", () => {
      const result = performRollback(testMigrationId);
      assert.equal(result.success, false);
      assert.ok(result.error);
    });

    it("should fail for nonexistent migration", () => {
      const result = performRollback("nonexistent");
      assert.equal(result.success, false);
    });
  });
});
