# Task 6 Report: Embedded browser UI

## Status

Implemented the embedded filesystem browser UI under `internal/ui/` and replaced the server's stub index.

## Changes

- Added embedded HTML, CSS, and JavaScript assets through `internal/ui.FS`.
- Added expandable directory browsing, debounced search, iframe previews, metadata display, watch fallback messaging, and SSE-driven refresh behavior.
- Served `/`, `/app.js`, and `/style.css` from the embedded filesystem while preserving all API and app routes.
- Added `TestUIIndexServed` to verify that the embedded index contains the iframe and application script.
- Removed the obsolete hard-coded `internal/server/ui.go` stub.

## Verification

```text
PATH=/home/zhangyw/go1.24.4/bin:$PATH go test ./internal/server/ ./internal/ui/...
ok  	mino/internal/server
?   	mino/internal/ui	[no test files]
```

IDE diagnostics reported no lint errors in the changed files.

## Commit

`feat: embed filesystem browser UI with live preview`

## Concerns

No known blockers. Browser interactions are implemented in dependency-free JavaScript; the requested Go integration test covers asset embedding, while live browser behavior remains best validated with a manual smoke test.

## Review fixes

- **Path encoding**: `previewURL` now encodes each path segment with `encodeURIComponent` (joined by `/`) so `#` and `?` in filenames work in `/apps/` URLs.
- **Stale search race**: tree/search listing fetches share an `AbortController` and monotonic request id; stale responses are ignored, and clearing the search box aborts in-flight search before reloading the tree.

### Verification

```text
PATH=/home/zhangyw/go1.24.4/bin:$PATH go test ./internal/server/ -v
ok  	mino/internal/server
```

### Commit

`fix: encode app paths per segment and cancel stale listing fetches`

## Important review fix

- **Debounce-window stale renders**: on every search `input`/`keyup`, `invalidateListingRequest()` aborts any in-flight listing fetch and bumps the request id before the 150ms debounce; responses that complete during that window are ignored.

### Verification

```text
PATH=/home/zhangyw/go1.24.4/bin:$PATH go test ./internal/server/ -v
ok  	mino/internal/server
```

### Commit

`fix: invalidate listing fetches on search input before debounce`
