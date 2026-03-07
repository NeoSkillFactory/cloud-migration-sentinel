#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const https = require("https");
const { URL } = require("url");

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

function resolveErrorAction(statusCode, errorCodes) {
  const codeStr = String(statusCode);
  const httpError = errorCodes.httpErrors[codeStr];
  if (httpError) {
    return {
      code: httpError.code,
      message: httpError.message,
      action: httpError.action,
      retryable: httpError.retryable,
    };
  }
  return {
    code: "UnknownError",
    message: `Unexpected HTTP status code: ${statusCode}`,
    action: "investigate",
    retryable: false,
  };
}

function checkProviderStatus(providerName, providerConfig, credentials) {
  return new Promise((resolve) => {
    const result = {
      provider: providerName,
      displayName: providerConfig.name,
      timestamp: new Date().toISOString(),
      status: "unknown",
      details: {},
    };

    // Simulate status check based on credentials and provider config
    // In production, this would make actual API calls
    if (!credentials || credentials === "none") {
      result.status = "no_credentials";
      result.details = {
        message: "No credentials provided for this provider",
        action: "provide_credentials",
      };
      resolve(result);
      return;
    }

    // Attempt to probe the provider API
    try {
      const apiUrl = new URL(providerConfig.api);
      const options = {
        hostname: apiUrl.hostname,
        port: 443,
        path: providerConfig.statusEndpoint,
        method: "GET",
        timeout: 5000,
        headers: {
          "User-Agent": "cloud-migration-sentinel/1.0",
          Authorization: `Bearer ${credentials}`,
        },
      };

      const req = https.request(options, (res) => {
        let body = "";
        res.on("data", (chunk) => (body += chunk));
        res.on("end", () => {
          const statusCode = res.statusCode;
          const suspensionCodes = providerConfig.suspensionIndicators.httpCodes;

          if (statusCode >= 200 && statusCode < 300) {
            result.status = "active";
            result.details = {
              httpStatus: statusCode,
              message: "Account is active and accessible",
              freeTier: providerConfig.freeTier,
            };
          } else if (suspensionCodes.includes(statusCode)) {
            result.status = "suspended";
            const errorInfo = resolveErrorAction(statusCode, loadJSON(errorCodesPath));
            result.details = {
              httpStatus: statusCode,
              message: errorInfo.message,
              action: errorInfo.action,
              retryable: errorInfo.retryable,
              suspensionIndicators: providerConfig.suspensionIndicators.errorMessages,
            };
          } else {
            result.status = "degraded";
            result.details = {
              httpStatus: statusCode,
              message: `Unexpected response: ${statusCode}`,
              body: body.slice(0, 200),
            };
          }
          resolve(result);
        });
      });

      req.on("error", (err) => {
        result.status = "unreachable";
        result.details = {
          message: `Cannot reach provider API: ${err.message}`,
          action: "check_network",
        };
        resolve(result);
      });

      req.on("timeout", () => {
        req.destroy();
        result.status = "timeout";
        result.details = {
          message: "Provider API request timed out",
          action: "retry_later",
        };
        resolve(result);
      });

      req.end();
    } catch (err) {
      result.status = "error";
      result.details = {
        message: `Configuration error: ${err.message}`,
        action: "verify_configuration",
      };
      resolve(result);
    }
  });
}

async function detectAll(providersConfig, credentials) {
  const results = [];
  const providerNames = Object.keys(providersConfig.providers);

  for (const name of providerNames) {
    const cred = credentials[name] || "none";
    const result = await checkProviderStatus(name, providersConfig.providers[name], cred);
    results.push(result);
  }

  return {
    scanTimestamp: new Date().toISOString(),
    totalProviders: providerNames.length,
    results,
    summary: {
      active: results.filter((r) => r.status === "active").map((r) => r.provider),
      suspended: results.filter((r) => r.status === "suspended").map((r) => r.provider),
      unreachable: results.filter((r) => ["unreachable", "timeout", "error"].includes(r.status)).map((r) => r.provider),
      noCredentials: results.filter((r) => r.status === "no_credentials").map((r) => r.provider),
    },
  };
}

function simulateDetection(providerName, simulatedStatus) {
  const providersConfig = loadJSON(providersPath);
  const errorCodes = loadJSON(errorCodesPath);
  const provider = providersConfig.providers[providerName];

  if (!provider) {
    return {
      error: `Unknown provider: ${providerName}`,
      availableProviders: Object.keys(providersConfig.providers),
    };
  }

  const result = {
    provider: providerName,
    displayName: provider.name,
    timestamp: new Date().toISOString(),
    status: simulatedStatus || "active",
    details: {},
  };

  switch (simulatedStatus) {
    case "suspended":
      result.details = {
        httpStatus: 403,
        message: resolveErrorAction(403, errorCodes).message,
        action: "trigger_migration",
        suspensionIndicators: provider.suspensionIndicators.errorMessages,
        recommendedTarget: providersConfig.migrationPriority.find((p) => p !== providerName),
      };
      break;
    case "rate_limited":
      result.details = {
        httpStatus: 429,
        message: resolveErrorAction(429, errorCodes).message,
        action: "exponential_backoff",
        retryable: true,
      };
      break;
    case "active":
    default:
      result.status = "active";
      result.details = {
        httpStatus: 200,
        message: "Account is active and accessible",
        freeTier: provider.freeTier,
      };
      break;
  }

  return result;
}

async function main() {
  const args = parseArgs(process.argv);
  const command = args.provider ? "single" : "all";
  const simulate = args.simulate || false;

  console.log("Cloud Migration Sentinel - Account Status Detector");
  console.log("===================================================\n");

  if (simulate) {
    const providerName = args.provider || "aws";
    const status = args.status || "suspended";
    console.log(`[SIMULATE] Detecting status for provider: ${providerName} (simulated: ${status})\n`);
    const result = simulateDetection(providerName, status);
    console.log(JSON.stringify(result, null, 2));

    if (result.status === "suspended") {
      console.log(`\n[ALERT] Provider "${providerName}" is suspended!`);
      console.log(`[ACTION] Recommended: migrate to ${result.details.recommendedTarget}`);
      process.exit(1);
    }
    process.exit(0);
  }

  if (command === "single") {
    const providersConfig = loadJSON(providersPath);
    const provider = providersConfig.providers[args.provider];
    if (!provider) {
      console.error(`Error: Unknown provider "${args.provider}"`);
      console.error(`Available: ${Object.keys(providersConfig.providers).join(", ")}`);
      process.exit(1);
    }
    const credentials = args.credentials || "none";
    console.log(`Checking status for provider: ${args.provider}\n`);
    const result = await checkProviderStatus(args.provider, provider, credentials);
    console.log(JSON.stringify(result, null, 2));

    if (result.status === "suspended") {
      process.exit(1);
    }
  } else {
    const providersConfig = loadJSON(providersPath);
    const credentials = {};
    Object.keys(providersConfig.providers).forEach((p) => {
      credentials[p] = args[`${p}-credentials`] || "none";
    });
    console.log("Scanning all configured providers...\n");
    const report = await detectAll(providersConfig, credentials);
    console.log(JSON.stringify(report, null, 2));

    if (report.summary.suspended.length > 0) {
      console.log(`\n[ALERT] Suspended providers: ${report.summary.suspended.join(", ")}`);
      process.exit(1);
    }
  }

  process.exit(0);
}

// Export for testing
module.exports = { simulateDetection, resolveErrorAction, parseArgs, checkProviderStatus, detectAll };

if (require.main === module) {
  main().catch((err) => {
    console.error("Fatal error:", err.message);
    process.exit(1);
  });
}
