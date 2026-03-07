# API Rate Limits and Quotas

## Provider-Specific Rate Limits

### AWS
| API | Sustained Rate | Burst | Reset Period |
|-----|---------------|-------|-------------|
| STS GetCallerIdentity | 20 req/s | 40 req/s | 1 second |
| EC2 DescribeInstances | 100 req/s | 200 req/s | 1 second |
| S3 GET/HEAD | 5,500 req/s | 5,500 req/s | per prefix |
| S3 PUT/POST | 3,500 req/s | 3,500 req/s | per prefix |

### Google Cloud
| API | Sustained Rate | Burst | Reset Period |
|-----|---------------|-------|-------------|
| Resource Manager | 5 req/s | 10 req/s | 100 seconds |
| Compute Engine | 20 req/s | 40 req/s | 100 seconds |
| Cloud Storage | 1,000 req/s | 5,000 req/s | per bucket |

### Azure
| API | Sustained Rate | Burst | Reset Period |
|-----|---------------|-------|-------------|
| ARM API | 12,000 req/h | 200 req/5min | 1 hour |
| Subscription read | 15,000 req/h | 500 req/5min | 1 hour |
| Storage operations | 20,000 req/s | 20,000 req/s | per account |

### Oracle Cloud
| API | Sustained Rate | Burst | Reset Period |
|-----|---------------|-------|-------------|
| Identity API | 10 req/s | 20 req/s | 1 second |
| Compute API | 20 req/s | 40 req/s | 1 second |
| Object Storage | 1,000 req/s | 2,000 req/s | per bucket |

## Exponential Backoff Strategy

When receiving 429 (Rate Limited) responses:

1. **Initial delay**: 1 second
2. **Multiplier**: 2x per retry
3. **Max retries**: 5
4. **Max delay**: 32 seconds
5. **Jitter**: Add random 0-1000ms to each delay

```
Retry 1: 1s + jitter
Retry 2: 2s + jitter
Retry 3: 4s + jitter
Retry 4: 8s + jitter
Retry 5: 16s + jitter
```

## Rate Limit Headers

Monitor these headers in API responses:

- `X-RateLimit-Remaining` - Requests remaining in window
- `X-RateLimit-Reset` - Unix timestamp when window resets
- `Retry-After` - Seconds to wait before retrying (on 429)
- `X-RateLimit-Limit` - Total requests allowed in window
