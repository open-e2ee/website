# Relay service catalog

`relay-service-catalog.json` is the exact artifact from Relay commit
`3d74de4ec7859e6d15c0c38ce4203e4e07d52b49` (pull request 234).
Its catalog version is `relay_managed_2026_10_18_v1`.
Its SHA256, including the final newline, is
`a5b4156e8bb9c15a1734e9647235820cbdd85c7878c5cae72bdde0e743b72da8`.

The website checks the digest before it parses the artifact.
The static build derives prices, capacities, Sandbox limits, and rational overage rates from this file.
It does not fetch a catalog from a service.

To update the catalog:

1. Check out the approved Relay revision.
2. Run `npm run catalog:export -- --output /tmp/relay-service-catalog.json` there with Node.js 26.
3. Copy its exact bytes here.
4. Update the revision, version, and digest in `../relay-service-catalog.mjs`.
5. Update the agreement as a new dated version.
6. Run the catalog, pricing, and legal tests after the website build.

The terms version `relay-2026-10-18` preserves Section 3.9 for existing projects.
OpenE2EE must send at least 30 days' notice to the project owner's Console email before changed prices or included quantities apply.
Publication alone does not start that period.
The coordinated release must verify each existing project's applicable catalog and notice record.
This website change sends no notices and changes no subscriptions or project policies.
