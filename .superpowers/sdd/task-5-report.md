# Task 5 Report: Filesystem watcher

## Result

- Added `internal/watcher` backed by `fsnotify`.
- `Start` recursively watches existing directories and newly created directory trees.
- Create/write/remove/rename events update the catalog through `ApplyFSChange` and forward non-empty event batches through the callback.
- Built-in ignored directories are not watched, and directory symlinks are not followed.
- `Close` safely stops the watcher and waits for its event loop.

## Tests

- Added coverage for root-level HTML creation.
- Added coverage for existing nested directories, newly created directories, file writes, and removals.
- `go test ./internal/watcher/ -v -count=10`: PASS.
- `go test ./...`: PASS.

## Commit

`e6734c4 feat: add filesystem watcher for catalog live updates`

## Important review fixes

- Added a red/green regression for moving a pre-populated directory into the watched root; discovered directory trees now ingest regular files and forward catalog events.
- Initial startup still registers directory watches without re-ingesting files already cataloged by `Scan`.
- Directory watch traversal now uses `Catalog.Ignored`, including custom patterns, and skips ignored subtrees.
- Added direct coverage proving `tmp/**` directories are absent from the underlying watch list.
- `PATH=/home/zhangyw/go1.24.4/bin:$PATH go test ./internal/watcher/ -v`: PASS.
- `PATH=/home/zhangyw/go1.24.4/bin:$PATH go test ./internal/catalog/ -v`: PASS.
