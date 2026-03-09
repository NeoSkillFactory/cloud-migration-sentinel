# cloud-migration-sentinel

![Audit](https://img.shields.io/badge/audit%3A%20PASS-brightgreen) ![License](https://img.shields.io/badge/license-MIT-blue) ![OpenClaw](https://img.shields.io/badge/OpenClaw-skill-orange)

> Automatically detects and migrates OpenClaw workloads from suspended cloud accounts to alternative free-tier providers to prevent downtime.

## Features

- **Detection**: Auto-detect account status via API checks (403/429 responses, suspension flags)
- **Provider Discovery**: Find free-tier alternatives from providers.json registry
- **Migration Workflow**: Sequential process of detect -> migrate -> validate
- **Rollback**: Rollback script triggered by monitor.js on validation failure

## Usage

```bash
cloud-migration-sentinel [command]
```

Available commands:
- `detect` - Check cloud account status across configured providers
- `migrate` - Execute workload migration to alternative provider
- `rollback` - Revert a failed migration to previous state

## Configuration

- Configurable via `assets/config-template.yaml`
- Provider-specific settings in `scripts/providers.json`
- Error code mappings in `scripts/error-codes.json`

## Examples

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

## GitHub

Source code: [github.com/NeoSkillFactory/cloud-migration-sentinel](https://github.com/NeoSkillFactory/cloud-migration-sentinel)

**Price suggestion:** $79 USD

## License

MIT © NeoSkillFactory
