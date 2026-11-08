# Relay service catalog

`signal-relay-service-catalog.json` is the exact artifact from Relay commit
`b6db5bb4d24f0bff4a0dcb13f91e4765b84f5a06`, the merge of pull request 273.
Its catalog version is `relay_managed_2026_11_01_v1`.
Its SHA256, including the final newline, is
`ddaf69635969ef8123c2361852572cfd63d334bda4361ef5108ab95ce081a967`.
The terms version `signal-relay-2026-11-08` publishes its Hobby plan and its current Free and Sandbox limits.

The website checks the digest before it parses the artifact.
The static build derives prices, capacities, Sandbox limits, and rational overage rates from this file.
A build date cannot qualify a catalog change.
It does not fetch a catalog from a service.

To update the catalog:

1. Check out the approved Relay revision.
2. Run `npm run catalog:export -- --output /tmp/signal-relay-service-catalog.json` there with Node.js 26.
3. Copy its exact bytes here.
4. Update the revision, version, and digest in `../signal-relay-service-catalog.mjs`.
5. Qualify the runtime catalog and update the agreement as a new dated version.
6. Run the catalog, pricing, and legal tests after the website build.

The terms version `relay-2026-10-18` applies the 2026-10-18 catalog immediately to every project.
The founder approved this change because there are no paying customers.
This catalog has no grandfathered allowances or notice waiting period.
For future price or allowance changes, Section 3.9 retains the 30-day notice rule.
The six older dated agreements and all existing acceptance records stay unchanged.
This website change sends no notices and changes no subscriptions or project policies.
