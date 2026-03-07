# Cloud Provider API Reference

## Authentication Flows

### AWS (Amazon Web Services)
- **Auth Method**: IAM credentials (Access Key ID + Secret Access Key)
- **Token Endpoint**: `https://sts.amazonaws.com/?Action=GetCallerIdentity`
- **Account Status**: Check via STS GetCallerIdentity - 403 indicates suspension
- **Migration APIs**:
  - Export: `POST /workloads/export` - Exports workload configuration and state
  - Import: `POST /workloads/import` - Imports workload artifacts
- **Headers**: `Authorization: AWS4-HMAC-SHA256 ...`

### Google Cloud Platform
- **Auth Method**: Service Account JSON key or OAuth2
- **Token Endpoint**: `https://oauth2.googleapis.com/token`
- **Account Status**: `GET https://cloudresourcemanager.googleapis.com/v1/projects/{projectId}`
  - `lifecycleState: ACTIVE` = operational
  - `lifecycleState: DELETE_REQUESTED` = pending deletion
  - 403 with `BILLING_DISABLED` = suspended
- **Migration APIs**:
  - Export: `POST /transfer/export` - Package workload for transfer
  - Import: `POST /transfer/import` - Receive and deploy workload
- **Headers**: `Authorization: Bearer <access_token>`

### Microsoft Azure
- **Auth Method**: Service Principal with Client ID + Secret
- **Token Endpoint**: `https://login.microsoftonline.com/{tenantId}/oauth2/v2.0/token`
- **Account Status**: `GET https://management.azure.com/subscriptions/{subscriptionId}?api-version=2020-01-01`
  - `state: Enabled` = operational
  - `state: Disabled` = suspended
  - `state: Warned` = approaching limits
- **Migration APIs**:
  - Export: `POST /resources/export` - Export ARM template and state
  - Import: `POST /resources/import` - Deploy from ARM template
- **Headers**: `Authorization: Bearer <access_token>`

### Oracle Cloud
- **Auth Method**: API Key (RSA key pair)
- **Token Endpoint**: N/A (signature-based auth)
- **Account Status**: `GET https://identity.{region}.oraclecloud.com/20160918/tenancies/{tenancyId}`
  - 200 = operational
  - 401/403 = suspended or restricted
- **Migration APIs**:
  - Export: `POST /instances/export` - Export instance configuration
  - Import: `POST /instances/import` - Create instance from export
- **Headers**: `Authorization: Signature ...`

## Common Response Codes

| Code | Meaning | Action |
|------|---------|--------|
| 200 | Success | Account active |
| 401 | Unauthorized | Refresh credentials |
| 403 | Forbidden | Likely suspended - trigger migration |
| 429 | Rate Limited | Exponential backoff |
| 500 | Server Error | Retry with backoff |
| 503 | Unavailable | Retry later |
