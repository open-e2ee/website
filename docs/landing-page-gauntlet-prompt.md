# OpenE2EE landing page gauntlet prompt

You are the lead agent for a bounded Gauntlet Loop on the OpenE2EE landing
page. Work in `/Users/jack/src/github.com/open-e2ee/website`.

## Objective

Improve the landing page so a first-time TypeScript developer can answer these
questions after a 10-second screenshot test:

1. What is the product?
2. Who is it for?
3. What valuable result does it provide?
4. Why should the developer consider it instead of the alternatives?
5. What should the developer do next?

After 30 seconds, the developer must also understand the supported runtimes,
the application-owned storage and relay model, the alpha status, and the main
security boundary.

Optimize for qualified starts of the existing ten-minute quickstart. Keep one
clear primary call to action above the fold. Preserve the install-copy and
GitHub paths as supporting actions.

## Authority and source order

Read the repository instructions and these files before you change the page:

- `/Users/jack/src/github.com/open-e2ee/AGENTS.md`
- `/Users/jack/src/github.com/open-e2ee/docs/identity.md`
- `/Users/jack/src/github.com/open-e2ee/docs/positioning.md`
- `/Users/jack/src/github.com/open-e2ee/docs/messaging.md`
- `/Users/jack/src/github.com/open-e2ee/design/DESIGN.md`
- `/Users/jack/src/github.com/open-e2ee/website/DESIGN.md`
- `/Users/jack/src/github.com/open-e2ee/website/src/pages/index.astro`
- `/Users/jack/src/github.com/open-e2ee/website/src/styles/global.css`
- `/Users/jack/src/github.com/open-e2ee/website/tests/`

The code is the source of truth for technical claims. Verify public SDK claims
against `/Users/jack/src/github.com/open-e2ee/signal-protocol-js`. Do not invent
an API, customer, metric, audit, endorsement, or security guarantee.

Keep the organization and product distinct. OpenE2EE is the organization and
product family. The OpenE2EE Signal Protocol SDK is the first product.

## Messaging bar

Use [Y Combinator's Practical Design: Messaging](https://www.ycombinator.com/blog/practical-design-messaging/)
as the messaging test. Separate customer value from the technology that
delivers it. Make the page answer these four YC questions in this order:

1. What is the value proposition?
2. How does the product deliver that value?
3. How does it work?
4. What can the developer do now?

Apply this framework to information hierarchy. Do not copy Y Combinator's
visual style.

## Visual and developer-experience bar

At the start of the run, capture current desktop and mobile screenshots of
these pages:

- [Resend](https://resend.com/) for headline clarity, action hierarchy, and
  readable code presentation.
- [Supabase](https://supabase.com/) for developer-product scanning, product
  proof, and code-led onboarding.
- [Liveblocks](https://liveblocks.io/) for explaining technical infrastructure
  through a visual that supports the product claim.

Use the references as a craft and clarity bar. Do not copy their branding,
layouts, illustrations, copy, or assets. The OpenE2EE design contract remains
authoritative.

## Required product decisions

Choose the final headline, support copy, page order, and visual hierarchy from
evidence. Keep the smallest page that completes the objective.

Show the real install command:

```sh
npm install @open-e2ee/signal-protocol-sdk
```

Show a short, real TypeScript example with useful syntax colors in light and
dark mode. Preserve the recorded-snippet contract in
`src/lib/hero-snippet.mjs`. Use Astro's existing Shiki capability before you
consider another dependency. Keep the copy control and its measurement hook.

Treat the current signature diagram as a hypothesis. Test these choices:

1. Improve and keep it.
2. Replace it with a simpler OpenE2EE-native architecture visual.
3. Remove it from the landing page.

Keep a visual only if fresh critics understand the central product boundary
faster with it. If you keep a visual, it must remain legible at 390 CSS pixels
without pinch zoom. Do not remove the recorded carrier proof unless the local
contract and tests change with a better proof of the same factual claim.

The page has no customer proof. Use inspectable product proof instead. Do not
make the absence of customers look like social proof.

## Loop

Run `npm install`, then run `npm run dev`. Capture the current page before you
edit it at these viewports:

- 1440 by 900
- 1280 by 800
- 390 by 844

Capture light and dark mode. Record the baseline in
`/Users/jack/src/github.com/open-e2ee/website/.gauntlet-workbench.md`. Include
the current score, largest gap, attempted change, evidence, and next action.

Break the work into the smallest parts that a critic can judge independently. Use
builders only for independent work. Keep one coherent owner for the page
composition and global CSS.

Use fresh-context critics that do not receive the builder's explanations:

1. A comprehension critic sees only the screenshots for 10 seconds. It answers
   the five objective questions.
2. A conversion critic checks the offer, objections, action hierarchy, and
   friction to the quickstart.
3. A developer-credibility critic checks the install command, TypeScript code,
   technical claims, alpha limit, license, and relay boundary.
4. A visual-design critic compares real screenshots with the three reference
   sites and the OpenE2EE design contract.
5. An accessibility critic checks both themes, keyboard use, focus, contrast,
   reduced motion, zoom, responsive layout, and horizontal overflow.

Each critic must inspect the rendered page or the actual code and test output.
Do not let a critic grade a summary. Ask each critic for the largest material
gap, the evidence for it, and one bounded correction target.

Fix the largest gap. Render the complete page again. Run a new critic with
fresh context. Repeat while the correction has a meaningful effect on the
objective.

After each major wave, use one fresh integration critic. This critic must check
that the page reads as one system and that a local improvement did not damage
another section.

## Hard acceptance gates

The result passes only when all these conditions are true:

- Three fresh comprehension critics correctly answer all five objective
  questions from the first viewport screenshot.
- The headline names the product category or concrete outcome. The support
  copy states the developer value without relying on protocol jargon.
- One primary action is visually dominant above the fold at desktop and mobile
  sizes. It opens the existing ten-minute quickstart.
- The install command is correct, copyable, visible without a search, and still
  sends the existing `install_copy` event.
- The TypeScript sample comes from the recorded quickstart and uses accessible
  syntax colors in light and dark mode.
- The page states the supported runtimes and the application-owned adapters.
  It also states the fixed relay formula and alpha limit without a banned claim.
- The visual decision has a written comparison. A kept visual improves
  comprehension and remains readable on mobile. A removed visual leaves no
  unexplained claim or broken proof path.
- No viewport has horizontal page overflow. Text remains readable at 200%
  zoom. Controls have visible focus and accessible names.
- The page adds no third-party tracker, remote font, decorative stock image,
  fabricated testimonial, or unverified number.
- Existing cookieless measurement for `quickstart_open`, `install_copy`, and
  `github_open` still works. Do not expand measurement without updating its
  collector, tests, and privacy contract.
- `npm test` and `npm run build` pass.
- The final critic scores six categories from 0 through 10.
- The categories cover message clarity, action clarity, developer credibility,
  responsive craft, accessibility, and brand fit.
- The total reaches at least 54 out of 60. Every category reaches at least 8.

## Boundaries and stop conditions

Change files only in `website/`. Preserve unrelated worktree changes. Use the
existing stack and design tokens. Check existing dependency capabilities before
you add a package.

Do not deploy, publish, commit, push, change billing, use credentials, spend
money, or contact people. Do not change a founder-gated decision.

Stop and report if one of these conditions occurs:

- All acceptance gates pass.
- Eight complete visual rounds finish.
- Two consecutive rounds improve the final score by fewer than two points.
- The same blocker recurs three times without a new strategy.
- A required decision needs founder approval, new credentials, or wider scope.

When a boundary stops the loop, keep the best verified version. Do not keep a
later version that regressed a passed gate.

## Final evidence

Run the full tests and one fresh final review. Capture final light and dark
screenshots at all three viewports. Compare the final screenshots with the
baseline and the reference screenshots.

Report:

1. The changed conversion path.
2. The headline and primary call to action.
3. The diagram decision and its comprehension evidence.
4. The final critic scores.
5. The commands and results for all checks.
6. The changed files.
7. Any remaining uncertainty.

Do not claim that the redesign increased conversion without production data.
Call the tested result a stronger conversion hypothesis until measured behavior
supports the claim.
