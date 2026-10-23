# Relay service catalog

`relay-service-catalog.json` is the exact artifact from Relay pull request 273 at commit
`4c2ba9ffb0c4d6e1f4397bd8e7cbedafae614a67`.
Its catalog version is `relay_managed_2026_11_01_v1`.
Its SHA256, including the final newline, is
`13dd29d0558e7ac64980f256034a0c8e9127465ee39814b0aeed317eee853e4a`.

`relay-service-catalog-2026-10-18.json` is the exact artifact from Relay pull request 234 at commit
`3d74de4ec7859e6d15c0c38ce4203e4e07d52b49`.
Its catalog version is `relay_managed_2026_10_18_v1`.
Its SHA256, including the final newline, is
`a5b4156e8bb9c15a1734e9647235820cbdd85c7878c5cae72bdde0e743b72da8`.
Relay enforces its Free and Sandbox limits until 2026-11-01T00:00:00Z.
The website reads only those limits from it.
Remove it after a production build at or after that instant.

The website checks each digest before it parses that artifact.
The static build derives prices, capacities, Sandbox limits, and rational overage rates from these files.
It uses the limits in effect at the build instant.
It does not fetch a catalog from a service.

To update the catalog:

1. Check out the approved Relay revision.
2. Run `npm run catalog:export -- --output /tmp/relay-service-catalog.json` there with Node.js 26.
3. Copy its exact bytes here.
4. Update the revision, version, and digest in `../relay-service-catalog.mjs`.
5. Update the agreement as a new dated version.
6. Run the catalog, pricing, and legal tests after the website build.

The terms version `relay-2026-10-18` applies the 2026-10-18 catalog immediately to every project.
The founder approved this change because there are no paying customers.
This catalog has no grandfathered allowances or notice waiting period.
For future price or allowance changes, Section 3.9 retains the 30-day notice rule.
The six older dated agreements and all existing acceptance records stay unchanged.
This website change sends no notices and changes no subscriptions or project policies.
