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

Hosted relay, object-storage, and control-plane products are deliberately out
of scope for this repository and the current launch.

## Development

```sh
npm install
npm run dev
npm run build
```

## Brand source

`public/brand` is the canonical source for the shield artwork, design tokens,
and brand guidance. The console commits a generated copy for self-contained
deployments and verifies it with its brand synchronization script.

## Deployment

The site builds to static assets and is configured for Cloudflare Workers:

```sh
npm run deploy:dry-run
npm run deploy
```

Production deployment requires an authenticated Wrangler session or a scoped
`CLOUDFLARE_API_TOKEN`.

## Project identity

This is an independent project. It is not affiliated with Signal Messenger LLC
or the Signal Foundation and does not use their logos.
