# signal-protocol.dev

Public marketing site and engineering journal for the independent Signal
Protocol JavaScript SDK.

## Applications

- `signal-protocol.dev` — this static Astro site and blog.
- `docs.signal-protocol.dev` — public Fumadocs routes deployed from the private
  `signal-protocol/console` repository.
- `console.signal-protocol.dev` — authenticated licensing and billing console.

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
