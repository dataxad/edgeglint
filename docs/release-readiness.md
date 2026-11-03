# Release and package readiness

Status: **preparation only**. No release tag or registry package is published by this document.

## Recommended distribution

1. **GitHub Release:** an immutable tag on the reviewed public commit, release notes, tested distribution archive and SHA-256 checksums.
2. **Public npm package:** a minimal Worker integration package with explicit exports and prebuilt tracker/version modules, so consumers do not need the development checkout to import it.
3. **GitHub Packages:** optional, not the default onboarding path. GitHub's npm registry requires authentication to install public packages too. Do not add it solely to fill the repository's Packages panel.

Sources checked 2026-11-02: [GitHub npm registry](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-npm-registry), [npm package manifest](https://docs.npmjs.com/cli/v11/configuring-npm/package-json/).

## Decisions required before publication

- Choose the software license. Current README and AGENTS.md explicitly reserve all rights. Do not infer MIT from public source or copy another project's license.
- Confirm the registry identity and available package name. `edgeglint` is the current local manifest name, not proof that the npm name is available or owned. A scope is an alternative only after its owner is confirmed.
- Select the first release version after reviewing the untagged 0.2.0 pilot history. Do not overwrite or retarget a published tag.
- Choose release assets and clearly state supported/untested installation paths. A README deploy button is not a fresh-account installation receipt.

## Package gap found in the current source

The manifest has no explicit `exports`, package-content allowlist or package build hook. The build creates `src/tracker.built.js` and `src/version.js`, which are ignored in Git. Runtime imports require these generated modules. Publishing the source tree as-is can therefore produce an incomplete distribution.

Keep generated modules out of Git, but include the tested generated modules in the distribution. Use an explicit allowlist so test fixtures, capture scripts, credentials and development notes cannot enter the package. Do not publish a package that runs a Cloudflare deployment as an install side effect.

## Acceptance checklist

- [ ] License approved; LICENSE, README and manifest agree.
- [ ] Registry identity/name verified without printing or committing credentials.
- [ ] Explicit public import contract for the Worker handler and supported adapters.
- [ ] Build from a clean pinned checkout; record version and exact public source commit.
- [ ] `npm test` and `npm run size` pass.
- [ ] `npm pack --dry-run --json` lists only intended distribution files, including both generated runtime modules.
- [ ] Install the resulting tarball in a clean consumer directory and import each advertised entry point without the producer's node_modules or source tree.
- [ ] Exercise the collector/adapters with positive and negative controls; verify the declared supported Worker installation. Record Pages/other binding limitations rather than advertising universal support.
- [ ] Inspect archive contents for secrets, private repository URLs, internal planning and customer data.
- [ ] Independently review the exact head; merge to dev first, then mirror the reviewed tree to public and verify equality.
- [ ] Tag only the verified public commit; publish release notes and checksummed assets.
- [ ] Publish the approved npm package with narrowly scoped credentials or a separately approved trusted-publishing setup. Do not create new credentials implicitly.
- [ ] Install the public version as a new consumer; verify release/package links and update README status only after publication succeeds.

## Draft release notes outline

**edgeglint 0.2.0 pilot — version subject to confirmation**

First-party aggregate web analytics on Cloudflare Workers and Analytics Engine. The pilot includes pageviews and referral sources, scroll-depth buckets, bounded element-click measurements, JavaScript error classes, outbound/download counts and average LCP/CLS. The dashboard reads Analytics Engine through the SQL binding.

No measurement cookies or visitor identifiers. Host/path allowlists, opt-out/privacy-signal checks and country-code exclusions remain enabled. This is not a compliance, consent-exemption, complete-coverage or production-compatibility guarantee.

Known limits: no unique visitors, user histories, replay or heatmaps; regional exclusions; sampled Analytics Engine data and average-only vitals; installation requires the documented Cloudflare bindings and runtime configuration. Link to the exact tag's data-flow and installation documents.

Attach the final test receipt, source commit, archive inventory and checksums when available. Do not publish this outline as a completed release.
