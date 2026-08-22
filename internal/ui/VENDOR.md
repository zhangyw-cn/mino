# Markdown viewer vendors

Downloaded on: 2026-08-22

All commands are run from `internal/ui/md/vendor/` (see `internal/ui/VENDOR.md` for versions). Checksums are SHA-256 of the files as committed (KaTeX CSS is after the font-URL rewrite; woff/ttf fallbacks removed).

Pinned versions match the markdown-preview plan. `highlight.min.js` is taken from `@highlightjs/cdn-assets@11.11.1` (same highlight.js 11.11.1 browser build) because `https://cdn.jsdelivr.net/npm/highlight.js@11.11.1/highlight.min.js` returns 404.

## marked@15.0.12

```bash
curl -L -o marked.min.js "https://cdn.jsdelivr.net/npm/marked@15.0.12/marked.min.js"
```

sha256: `3e7e7d7feb3e5d58cb6c804f68ab5c24cc7e5eb6270fd6e5cbb9124739217d0c`

## DOMPurify@3.2.6

```bash
curl -L -o purify.min.js "https://cdn.jsdelivr.net/npm/dompurify@3.2.6/dist/purify.min.js"
```

sha256: `89e1fa7647cb495370d3a997ace4387f5d15d9f4c5af12352c53daa400956287`

## highlight.js@11.11.1

```bash
curl -L -o highlight.min.js "https://cdn.jsdelivr.net/npm/@highlightjs/cdn-assets@11.11.1/highlight.min.js"
curl -L -o highlight.min.css "https://cdn.jsdelivr.net/npm/@highlightjs/cdn-assets@11.11.1/styles/github-dark.min.css"
```

sha256 `highlight.min.js`: `c4a399dd6f488bc97a3546e3476747b3e714c99c57b9473154c6fb8d259b9381`

sha256 `highlight.min.css`: `9f208d022102b1d0c7aebfecd8e42ca7997d5de636649d2b31ea63093d809019`

## mermaid@11.6.0

```bash
curl -L -o mermaid.min.js "https://cdn.jsdelivr.net/npm/mermaid@11.6.0/dist/mermaid.min.js"
```

sha256: `3a93016a73dc82ba890d919f9bbb176f3da9d98341650c0b517f2595cc68fef8`

## KaTeX@0.16.22

```bash
curl -L -o katex.min.js "https://cdn.jsdelivr.net/npm/katex@0.16.22/dist/katex.min.js"
curl -L -o katex.min.css "https://cdn.jsdelivr.net/npm/katex@0.16.22/dist/katex.min.css"
```

sha256 `katex.min.js`: `e8d885505949f3a5f4abdd5dd0d53696bd1371ad26ffbf4f310dcd77c8cdae89`

sha256 `katex.min.css` (after rewrite): `51f56e6166cf1a47515a582b93664d9555d7b725e342a16fe447a113478d23cd`

### KaTeX fonts

Copy woff2 from `katex/dist/fonts` into `vendor/fonts/`. Only woff2 is vendored; modern browsers pick that format first.

```bash
mkdir -p fonts
for f in \
  KaTeX_AMS-Regular.woff2 \
  KaTeX_Caligraphic-Bold.woff2 \
  KaTeX_Caligraphic-Regular.woff2 \
  KaTeX_Fraktur-Bold.woff2 \
  KaTeX_Fraktur-Regular.woff2 \
  KaTeX_Main-Bold.woff2 \
  KaTeX_Main-BoldItalic.woff2 \
  KaTeX_Main-Italic.woff2 \
  KaTeX_Main-Regular.woff2 \
  KaTeX_Math-BoldItalic.woff2 \
  KaTeX_Math-Italic.woff2 \
  KaTeX_SansSerif-Bold.woff2 \
  KaTeX_SansSerif-Italic.woff2 \
  KaTeX_SansSerif-Regular.woff2 \
  KaTeX_Script-Regular.woff2 \
  KaTeX_Size1-Regular.woff2 \
  KaTeX_Size2-Regular.woff2 \
  KaTeX_Size3-Regular.woff2 \
  KaTeX_Size4-Regular.woff2 \
  KaTeX_Typewriter-Regular.woff2
do
  curl -L -o "fonts/${f}" "https://cdn.jsdelivr.net/npm/katex@0.16.22/dist/fonts/${f}"
done
```

Rewrite relative font URLs so they resolve under the Mino origin:

```bash
python3 -c 'from pathlib import Path; p=Path("katex.min.css"); p.write_text(p.read_text().replace("url(fonts/", "url(/md/vendor/fonts/"))'
```

| File | sha256 |
|------|--------|
| fonts/KaTeX_AMS-Regular.woff2 | `0cdd387c9590a1a9f9794560022dbb59654a7d86f187aa0c81495ad42d3a7308` |
| fonts/KaTeX_Caligraphic-Bold.woff2 | `de7701e42cf1f4cf0b766c03fb27977207eee2f4fd5d76fa82188406da43ea4c` |
| fonts/KaTeX_Caligraphic-Regular.woff2 | `5d53e70ad607c2352162dec9e0923fb54ecdafaccbf604cd8dcf7d00facb989b` |
| fonts/KaTeX_Fraktur-Bold.woff2 | `74444efd593c005e3f4573b44524704c0af0a937fe911cca9e94068d0d140d3f` |
| fonts/KaTeX_Fraktur-Regular.woff2 | `51814d270d06ff0255dba0799994fa4d8c84d11f09951d47595f4abb1f3602dc` |
| fonts/KaTeX_Main-Bold.woff2 | `0f60d1b897938ec918c8ce073092411baf9438f6739465693ff18b0f9d20b021` |
| fonts/KaTeX_Main-BoldItalic.woff2 | `99cd42a3c072d918f2f44984a807cf7aa16e13545fd0875fc07c6c65f99e715b` |
| fonts/KaTeX_Main-Italic.woff2 | `97479ca6cce906abc961ecac96faa5f9ca2e61b8e7670d475826bcdee9a7c267` |
| fonts/KaTeX_Main-Regular.woff2 | `c2342cd8b869e01752a9321dc17213fc40d4d04c79688c1d43f2cf316abd7866` |
| fonts/KaTeX_Math-BoldItalic.woff2 | `dc47344dbb6cb5b655c8460d561f4df5f501b90c804ad3c6cec65fe322351ab1` |
| fonts/KaTeX_Math-Italic.woff2 | `7af58c5ec8f132a2ddde9027c6d7814decce4d3b822a11192a42a20e2e973264` |
| fonts/KaTeX_SansSerif-Bold.woff2 | `e99ae51144bf1232efcc1bfe5add36262c6866b0faab24fa75740e1b98577a62` |
| fonts/KaTeX_SansSerif-Italic.woff2 | `00b26ac825e2095056396e0553b8ac26d3f8ad158c3826e28b4c45b385c4714a` |
| fonts/KaTeX_SansSerif-Regular.woff2 | `68e8c73ef42afd3ccec58bf0fba302cce448938e7fc020a5e31f8a952eee1342` |
| fonts/KaTeX_Script-Regular.woff2 | `036d4e95149b69ff9bcc0cd55771efeb25ffa3947293e69acd78d5ac328c684b` |
| fonts/KaTeX_Size1-Regular.woff2 | `6b47c40166b6dbe21a5dfca7718413f2147fd2399be1ba605d8ad39cedf25dfe` |
| fonts/KaTeX_Size2-Regular.woff2 | `d04c54219f9eaec6d4d4fd42dfb28785975a4794d6b2fc71e566b9cd6db842dd` |
| fonts/KaTeX_Size3-Regular.woff2 | `73d591271b1604960cb10bb90fee021670af7297017e0e98480b332d11f51995` |
| fonts/KaTeX_Size4-Regular.woff2 | `a4af7d414440a1c1790825cfb700cf9cf43b0f2c4b04f0ebc523011ad9853ec0` |
| fonts/KaTeX_Typewriter-Regular.woff2 | `71d517d67827787cfabdf186914cc3358eda539e37931941f2b2fd4a21f68c0b` |
