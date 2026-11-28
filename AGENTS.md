# OpenE2EE website

This repository is the Astro marketing site and the engineering journal. The
OpenE2EE workspace instructions also apply here.

## Checks

Development needs Node 26 or later. Run these commands before you open a
pull request:

```bash
npm run check
npm test
npm run build
```

Pull requests target `main`, and CI runs on each pull request.

## Delivery

- Each push to `main` deploys `stage.open-e2ee.dev` after the build and the
  tests pass.
- A published GitHub release deploys `open-e2ee.dev`. The tag commit must be
  on `main`. `README.md` gives the release command.
