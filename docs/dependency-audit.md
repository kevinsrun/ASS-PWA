# Dependency audit — 2026-09-19

`npm audit --omit=dev` and the full `npm audit` both report zero vulnerabilities after patch-level transitive updates. No direct dependency, framework major version, or runtime API changed.

The remediated development/build packages were `baseline-browser-mapping`, `brace-expansion`, `browserslist`, and `js-yaml`, together with their browser-data helpers. The change is isolated to `package-lock.json`; production dependencies were already clean.

`unrs-resolver@1.12.2` declares a postinstall script and npm reports it as not covered by an `allowScripts` policy. This is an install-policy notice, not an audit vulnerability. Do not approve new install scripts automatically; review package provenance and the script before changing policy.
