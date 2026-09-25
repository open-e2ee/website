# OpenE2EE website

Public marketing site and engineering journal for the independent Signal
Protocol JavaScript SDK.

## Applications

- `open-e2ee.dev` — the canonical static Astro site and blog.
- `docs.open-e2ee.dev` — public Fumadocs routes deployed from the private
  `open-e2ee/console` repository.
- `console.open-e2ee.dev` — authenticated licensing and billing console.

`www.open-e2ee.dev`, `signal-protocol.dev`, `signalprotocol.dev`,
`open-e2ee.com`, and `opene2ee.dev` (including their `www` forms) are legacy
or defensive aliases that permanently redirect to `https://open-e2ee.dev`.
`docs.signal-protocol.dev` and `console.signal-protocol.dev` redirect to the
matching `docs.open-e2ee.dev` and `console.open-e2ee.dev` hosts.

The website presents the OpenE2EE Signal Protocol Relay as a separate delivery
product built for the SDK.
Relay runtime, object storage, commercial authority, and operator state stay in
their owning private repositories and services; this repository owns only the
public product, pricing, comparison, and funnel pages.

## Development

```sh
npm install
npm run dev
npm run build
bash scripts/verify-site-redesign.sh
```

`scripts/verify-site-redesign.sh` holds the twenty-five conditions of the UI
redesign website contract. With no argument it reports each condition and exits
non-zero while any one fails.

CI runs it with `--ratchet` on every pull request. That mode compares the
pass count against `scripts/redesign-baseline/passing.txt` and fails on any
difference, so an open condition does not block unrelated work. A change
that turns a condition green records the new count in the same commit.

## Brand source

`public/brand` is the canonical source for the shield artwork, design tokens,
and brand guidance. The console commits a generated copy for self-contained
deployments and verifies it with its brand synchronization script.

## Deployment

The site builds to static assets and deploys to Cloudflare Workers in three
lanes:

| Lane | Trigger | Host | Workflow |
|---|---|---|---|
| Preview | Each pull request | A `workers.dev` preview URL | `preview.yml` |
| Staging | Each push to `main`, after the build and tests pass | `staging.open-e2ee.dev` | `deploy-staging.yml` |
| Production | A published GitHub release whose tag commit is on `main` | `open-e2ee.dev` | `deploy.yml` |

A push to `main` never deploys production. The staging workflow deploys only
the current `main` tip, so a rerun of an older run cannot move staging back.

To deploy production, publish a release at the `main` tip:

```sh
gh release create vYYYY.MM.DD --repo open-e2ee/website --target main --generate-notes
```

A tag is a calendar version, `vYYYY.MM.DD`. A second release on the same day
adds a suffix: `vYYYY.MM.DD-2`, then `vYYYY.MM.DD-3`. The production workflow
refuses any other tag, and it refuses a tag whose commit is not on `main`. To
deploy an existing tag again, run the Deploy workflow by hand and give it the
tag.

`scripts/check-deploy-workflows.mjs` holds these triggers and guards, and
`npm test` runs it.

To check the production and staging configs without a deploy:

```sh
npm run deploy:dry-run
npx wrangler deploy --config wrangler.website.stage.jsonc --env="" --dry-run
```

A deploy from a workstation requires an authenticated Wrangler session or a
scoped `CLOUDFLARE_API_TOKEN`.

## Project identity

This is an independent project. It is not affiliated with Signal Messenger LLC
or Signal Technology Foundation and does not use their logos.
