# bun-rate-limiter

## 0.2.2

### Patch Changes

- df84444: Remove external abort listeners when jobs settle or are cancelled. Reusing a cancellation signal across many requests no longer retains completed jobs and their responses, including when task timeouts are enabled. Pending and running cancellation behavior is preserved.

## 0.2.1

### Patch Changes

- eba5b86: Removing src from build artifacts

## 0.2.0

### Minor Changes

- 15c1976: Add Redis spacing throttler, improve documentation, and release automation
