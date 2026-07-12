# vendor/xlsx.mjs

SheetJS `xlsx` 0.20.3, ESM build, vendored locally. Deno 2.9's remote-import
allowlist excludes `cdn.sheetjs.com`, and the deploy pipeline must not depend
on an `--allow-import` flag, so this file is committed instead of imported
remotely.

Source: https://cdn.sheetjs.com/xlsx-0.20.3/package/xlsx.mjs

To update: re-download the same URL at a newer version (replace `0.20.3` in
the path) and re-run `deno check` on the two functions that import it.
