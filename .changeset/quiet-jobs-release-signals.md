---
"bun-rate-limiter": patch
---

Remove external abort listeners when jobs settle or are cancelled. Reusing a cancellation signal across many requests no longer retains completed jobs and their responses, including when task timeouts are enabled. Pending and running cancellation behavior is preserved.
