# Final fix: `/api/raw` Cache-Control

## Status

DONE

## Change

Successful Markdown `/api/raw/` responses now send `Cache-Control: no-store` so SSE iframe reloads do not reuse a cached source body. `viewer.js` also fetches with `{ cache: "no-store" }`. Sample wording no longer mentions "Task 4".

`TestMarkdownAppsAndRaw` asserts the header on `GET /api/raw/notes/readme.md`. `TestViewerPipelineMarkers` asserts the fetch option is present.

## Tests

RED: `Cache-Control "", want no-store`

GREEN (after header + fetch option):

```
export GOMODCACHE=/home/zhangyw/go/pkg/mod GOPROXY=https://proxy.golang.org,direct
go test ./internal/server -run 'TestMarkdownAppsAndRaw|TestViewerPipelineMarkers' -count=1
ok  	mino/internal/server
go test ./... -count=1
ok (all packages)
```

## Concerns

- Header is only set on successful Markdown raw reads, not 404s. That is enough for the stale-preview case.
- Browser HTTP cache is the target; this does not change SSE itself.
