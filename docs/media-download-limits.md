# Media download limits

`GET /api/media/*` decrypts one authenticated AES-GCM frame. The current frame format cannot safely decrypt a byte range independently: the complete encrypted frame must be downloaded and authenticated before a valid plaintext range can be returned.

## Application limits

Before a storage URL is signed or fetched, each application process applies all of the following:

- **4** concurrent object downloads total;
- **2** concurrent object downloads per authenticated user or unauthenticated client IP;
- **40 MiB** of declared plaintext work per client in each **60-second** window; and
- at most **512** tracked client-budget entries, expiring after their window when inactive.

Every valid range request, including `Range: bytes=0-0`, is charged the complete declared plaintext size because it requires a whole-frame download and GCM authentication. Valid web/native MP4 ranges still receive normal `206` responses when admitted. A client that exceeds its budget receives `429` with `Retry-After` and must retry instead of causing unbounded decrypt work.

The storage response has a 15-second abort deadline. Its body is read into one pre-sized buffer and is rejected if it is truncated or exceeds the encrypted frame length, even when storage omits `Content-Length`.
There is no plaintext cache: each admitted request has at most a 20 MiB encrypted-frame buffer and a
20 MiB plaintext result before runtime/crypto transient copies. The four-download semaphore bounds
that application-owned working set; deployers must still size a worker with appropriate headroom.

## Deployment requirement and limitation

These counters are deliberately **in-memory and per process**. They bound one Node worker but do not coordinate replicas, survive restarts, or replace an edge policy. Production deployments must also enforce a request-rate and concurrent-request policy for `/api/media/*` at the CDN/WAF/load-balancer layer, using the real client address established by the trusted proxy. This repository does not configure that provider-specific edge policy.

The limits are a secure compatibility measure, not chunked-media streaming. Supporting low-cost frequent video ranges would require a future authenticated chunked encryption format and a coordinated migration; forwarding an arbitrary Range to the whole-frame ciphertext object would not be valid AES-GCM partial decryption.
