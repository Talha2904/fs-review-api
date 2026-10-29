# Web engine reference (frozen)

A copy of the web app's analysis engine as it ran in the browser before Phase 6 (react-app `src/lib` and
`src/data`, 28 October 2026). It is the reference for `npm run parity:analysis`, which runs the same
documents through this engine and through the api and reports any difference. Do not edit it: it records
what the browser produced. `--write` records its results as `test/fixtures/analysis/golden/*.json`.

To compare against a different revision of the web app, pass its folder: `npm run parity:analysis -- --web <path>`.
