---
name: cloud-migration-sentinel
description: Automatically detects and migrates OpenClaw workloads from suspended cloud accounts to alternative free-tier providers to prevent downtime.
---

# cloud-migration-sentinel

## 1. One-Sentence Description
Automatically detects and migrates OpenClaw workloads from suspended cloud accounts to alternative free-tier providers to prevent downtime.

## 2. Core Capabilities
- **Detection**: Auto-detect account status via API checks (403/429 responses, suspension flags)
- **Provider Discovery**: Find free-tier alternatives from providers.json registry
- **Migration Workflow**: Sequential process of detect -> migrate -> validate
- **Rollback**: Rollback script triggered by monitor.js on validation failure

## 3. Usage

```bash
cloud-migration-sentinel [command]
```

Available commands:
- `detect` - Check cloud account status across configured providers
- `migrate` - Execute workload migration to alternative provider
- `rollback` - Revert a failed migration to previous state

### Examples

```bash
# Detect account suspension
node scripts/detector.js --provider aws --credentials ~/.aws/credentials

# Migrate workloads to alternative provider
node scripts/migrator.js --source aws --target gcloud --workload my-agent

# Monitor migration progress
node scripts/monitor.js --migration-id abc123

# Rollback failed migration
node scripts/rollback.js --migration-id abc123
```

## 4. Configuration
- Configurable via `assets/config-template.yaml`
- Provider-specific settings in `scripts/providers.json`
- Error code mappings in `scripts/error-codes.json`

## 5. Trigger Scenarios
- "My cloud account got suspended, help migrate my OpenClaw workloads"
- "Automatically switch to alternative providers when cloud APIs return 403/429 errors"
- "Find and configure backup cloud providers for my OpenClaw agents"
- "Migrate all suspended workloads to available free-tier alternatives"
