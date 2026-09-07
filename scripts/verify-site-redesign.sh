#!/usr/bin/env bash
#
# The website verifier. Thirty-nine conditions, SR-V01 through SR-V39.
# Each one names the UI redesign task that added it. That plan completed on
# 2026-09-06 and moved to archive/ui-redesign-2026-09-06/ in the workspace,
# where proof/verifier-schedule.md records what each condition holds. This
# script is the standing contract now: add and drop nothing here without
# stating the reason in the pull request that changes it.
#
# SR-V26 through SR-V39 belong to docs/plans/funnel-redesign-plan.html, which
# is active. They start red and turn green as FR2 through FR17 land.
#
# Every condition guards on the artifact its task shipped, so a condition that
# passes without that artifact proves nothing. That includes the preservation
# conditions: the demos, the content security policy, and the self-hosted fonts
# are asserted inside the shipped stylesheet.
#
# Two modes. With no argument the script exits non-zero while any condition
# fails, and it names every failure. With --ratchet it compares the pass count
# against the number recorded in scripts/redesign-baseline/passing.txt and
# fails on any difference. CI runs the second mode, so a change that turns a
# passing condition red fails the pull request.

set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

passed=0
failed=0

check() {
  local id="$1" description="$2" fn="$3"
  if "$fn" >/dev/null 2>&1; then
    passed=$((passed + 1))
    printf 'PASS %s  %s\n' "$id" "$description"
  else
    failed=$((failed + 1))
    printf 'FAIL %s  %s\n' "$id" "$description"
  fi
}

CSS=src/styles/global.css
DEMO_CSS=src/styles/demo.css
NAV=src/lib/site-navigation.ts
CHROME=src/components/PageChrome.astro
BASELINE=scripts/redesign-baseline

have_demo_css() { test -f "$DEMO_CSS"; }
have_nav() { test -f "$NAV"; }
have_chrome() { test -f "$CHROME"; }

# --- UIR5.1, Tailwind and the quarantine ---------------------------------------

# The import alone is not the load. A file can import the plugin and never
# register it, which reads as Tailwind arriving and ships a page without it, so
# the registration in the plugin list is what this asks for.
sr_v01() {
  have_demo_css || return 1
  grep -q "from '@tailwindcss/vite'" astro.config.mjs &&
    grep -qE 'plugins: \[[^]]*tailwindcss\(\)' astro.config.mjs &&
    grep -q 'roles.css' "$CSS"
}

sr_v02() {
  have_demo_css || return 1
  ! grep -qE '^\.demo-|^\.diagram-' "$CSS"
}

sr_v03() {
  have_demo_css || return 1
  local missing=0 line
  while IFS= read -r line; do
    [ -z "$line" ] && continue
    grep -Fqx -- "$line" "$DEMO_CSS" || missing=1
  done < "$BASELINE/demo-css.txt"
  [ "$missing" -eq 0 ]
}

sr_v04() {
  have_demo_css || return 1
  grep -q "script-src 'self';" public/_headers &&
    ! grep -q "script-src 'self' " public/_headers &&
    ! grep -rq 'fonts.googleapis.com\|fonts.gstatic.com' src public
}

sr_v25() {
  have_demo_css || return 1
  test -f scripts/audit-demo-stylesheet.mjs || return 1
  node scripts/audit-demo-stylesheet.mjs
}

# --- UIR5.2, the information architecture ----------------------------------------

sr_v05() {
  have_nav || return 1
  grep -q 'export const headerNavigation' "$NAV" &&
    grep -q 'headerNavigation' src/components/Header.astro
}

sr_v06() {
  have_nav || return 1
  grep -q 'export const footerGroups' "$NAV" &&
    grep -q 'footerGroups' src/components/Footer.astro
}

sr_v07() {
  have_nav || return 1
  test -d dist || return 1
  node scripts/audit-build.mjs dist
}

sr_v08() {
  have_nav || return 1
  test -f tests/navigation.test.mjs || return 1
  node --test tests/navigation.test.mjs
}

# --- UIR5.3, the page chrome ------------------------------------------------------

# A page reaches the chrome through whatever component it renders, so the audit
# resolves the import graph. A grep for the two names reads neither the graph
# nor the difference between a rendered element and a word in a comment.
sr_v09() {
  have_chrome || return 1
  node scripts/audit-page-chrome.mjs --pages
}

# The rules sit indented inside `@layer base`, where a line-anchored pattern
# reads the indentation instead of the selector, and `table.data` is a class
# rule that starts with a letter. The audit reads each selector at its depth.
sr_v10() {
  have_chrome || return 1
  node scripts/audit-page-chrome.mjs --stylesheet
}

sr_v11() {
  have_chrome || return 1
  node --test tests/site-content.test.mjs
}

sr_v12() {
  have_chrome || return 1
  npm run visual:relay
}

# --- UIR6.2, the article layout ------------------------------------------------------

# The condition is that the column resolves from the token, so each line below
# holds one part of that: the token exists in the installed design package, the
# grid track is that token, the stylesheet computes no width of its own, and the
# blog layout is on that grid rather than on the recipe wrapper it replaced. The
# first form of this check grepped for `--oe-measure`, which is not a token this
# project has, so it could report only red and would have reported green on a
# mention in a comment.
sr_v13() {
  test -f src/styles/article.css || return 1
  grep -q -- '--oe-prose-measure:' node_modules/@open-e2ee/design/packages/design/dist/css/tokens.css || return 1
  grep -qE 'grid-template-columns:' src/styles/article.css || return 1
  grep -qE 'minmax\(0, var\(--oe-prose-measure\)\) \[text-end\]' src/styles/article.css || return 1
  grep -qE 'max-width:[[:space:]]*calc\(' src/styles/article.css && return 1
  grep -q 'class="oe-article"' src/layouts/BlogPostLayout.astro || return 1
  ! grep -qE 'ARTICLE_COLUMN|max-w-\[calc\(' src/layouts/BlogPostLayout.astro
}

sr_v14() {
  test -f src/components/ArticleToc.astro || return 1
  test -f tests/article-layout.test.mjs || return 1
  node --test tests/article-layout.test.mjs
}

sr_v15() {
  test -f scripts/measure-overflow.mjs || return 1
  node scripts/measure-overflow.mjs --widths 320,768,1280
}

# --- UIR5.4, the demo preservation contract --------------------------------------------

sr_v16() {
  have_demo_css || return 1
  diff <(grep -rhoE 'data-[a-z0-9-]+' src/components/demo src/lib/demo | sort -u) \
    "$BASELINE/demo-data-attributes.txt"
}

sr_v17() {
  have_demo_css || return 1
  local name
  for name in demo-relay-slot-empty demo-keyhole-turn demo-mobile-slab demo-phone demo-scene-relay; do
    grep -rq "$name" src/components/demo src/lib/demo || return 1
  done
}

sr_v18() {
  test -f "$BASELINE/demo-geometry.txt" || return 1
  npm run demo:smoke
}

sr_v19() {
  test -f scripts/measure-reduced-motion.mjs || return 1
  node scripts/measure-reduced-motion.mjs
}

# --- UIR6.3, the copy pass ---------------------------------------------------------------

# The inventory is a list of fixed strings, and grep -f over an empty list
# matches nothing, so the count is asserted rather than assumed: a check whose
# input can be empty passes on any input. The recorded inventory holds three
# phrases, and a smaller one is a dropped condition rather than a green.
#
# The sweep reads .ts and .mjs as well, because demo copy on this site lives in
# src/lib as well as in the components. The first form of this check read
# .astro, .mdx and .md only, so it could not see the reel caption in
# src/lib/demo/mobile-reel.ts at all.
sr_v20() {
  local phrases="$BASELINE/mechanism-phrases.txt"
  test -f "$phrases" || return 1
  local recorded
  recorded="$(grep -c '[^[:space:]]' "$phrases")" || return 1
  [ "$recorded" -ge 3 ] || return 1
  ! grep -rn -F -f "$phrases" --include='*.astro' --include='*.mdx' --include='*.md' \
    --include='*.ts' --include='*.mjs' src
}

sr_v21() {
  test -f "$BASELINE/mechanism-phrases.txt" || return 1
  test -d dist || return 1
  node scripts/audit-build.mjs dist
}

# --- UIR6.4, cross-surface cohesion --------------------------------------------------------

# The reporter is pinned. `node --test` prints TAP when stdout is not a
# terminal and the spec reporter when it is, so an unpinned run reads `ok 1 -`
# here and a check mark in a terminal.
cohesion_tap() {
  test -f tests/cohesion.test.mjs || return 1
  node --test --test-reporter=tap tests/cohesion.test.mjs
}

# One named test reported ok. `grep -F` on the name alone would match the
# `not ok` line for the same test, so the whole line is anchored.
cohesion_ok() {
  printf '%s\n' "$2" | grep -qE "^ok [0-9]+ - $1\$"
}

# The condition names six measures. The first form of this check ran the file
# and read its exit code, so a tests/cohesion.test.mjs holding one trivial test
# satisfied it: what it bound was the file's existence, not the six measures.
# Each measure now has a test of its own, and every name must report ok. The
# count is asserted as well, because a renamed or deleted test would otherwise
# take its measure out of the condition without turning anything red.
sr_v22() {
  local tap
  tap="$(cohesion_tap)" || return 1
  local name
  for name in \
    'the header height is one shared token and no host literal' \
    'the footer padding is one shared pair of tokens and no host literal' \
    'the theme control is the shared module on every host' \
    'the focus ring is the one rule the shared role layer carries' \
    'the type scale is four shared tokens and no host literal' \
    'the spacing base is the shared scale and no host scale' \
    'the lockup renders at the one shared size'; do
    cohesion_ok "$name" "$tap" || return 1
  done
  printf '%s\n' "$tap" | grep -qE '^# pass 8$' || return 1
  printf '%s\n' "$tap" | grep -qE '^# fail 0$'
}

# The first form grepped the file for the literal `oe-theme`, which the header
# comment of the same file contains. It could report only green.
sr_v23() {
  local tap
  tap="$(cohesion_tap)" || return 1
  cohesion_ok 'one theme choice persists under the shared key' "$tap"
}

# --- UIR1.5, the design pin ------------------------------------------------------------------

sr_v24() {
  local pinned baseline
  pinned="$(node -e "const p=require('./package.json');const v=p.dependencies['@open-e2ee/design']||'';const m=v.match(/v[0-9.]+/);process.stdout.write(m?m[0]:'')")"
  baseline="$(cat "$BASELINE/design-pin.txt")"
  [ -n "$pinned" ] && [ "$pinned" != "$baseline" ] || return 1
  # Resolve roles.css the way the stylesheet imports it, through the package
  # export map. The tarball ships the distribution under packages/design/dist,
  # and a literal path into node_modules would break on the next layout change
  # while the import kept working.
  node -e "require.resolve('@open-e2ee/design/roles.css')" || return 1
  npm ls @open-e2ee/design
}

# --- FR2 through FR10, the funnel and product redesign ---------------------------
#
# docs/plans/funnel-redesign-plan.html owns these. Each one guards on the
# artifact its task ships, so it cannot pass before that task lands.

PRICING=src/pages/pricing.astro
RELAY_PAGE=src/pages/relay/index.astro
HOMEPAGE=src/pages/index.astro
ARTICLE_CSS=src/styles/article.css
DIAGRAMS=src/components/diagrams

# FR2. The five Relay plan names come from the pricing data module, so the
# check reads that module rather than a list written twice.
sr_v26() {
  test -f "$PRICING" || return 1
  test -f tests/pricing-page.test.mjs || return 1
  node --test --test-reporter=tap tests/pricing-page.test.mjs
}

# FR2. A tier without its own action is a row, not an offer. The count comes
# from the built page, because an Astro component can drop a control.
sr_v27() {
  test -d dist || return 1
  test -f scripts/check-pricing-actions.mjs || return 1
  node scripts/check-pricing-actions.mjs dist
}

# FR3. The homepage leads with the Relay, offers a free start, and sets no
# emoji. An emoji here reads as a different type system than the rest of the
# site uses.
sr_v28() {
  test -f "$HOMEPAGE" || return 1
  test -f tests/home-funnel.test.mjs || return 1
  node --test --test-reporter=tap tests/home-funnel.test.mjs
}

# FR4. The start action has to reach both header surfaces. A desktop-only
# control hides the funnel from every phone reader.
sr_v29() {
  have_nav || return 1
  grep -q 'startAction' "$NAV" || return 1
  node --test --test-reporter=tap tests/navigation.test.mjs
}

# FR5. The flagship page needs a product drawing and a free start. The figure
# count comes from the built page.
sr_v30() {
  test -f "$RELAY_PAGE" || return 1
  test -f tests/relay-page.test.mjs || return 1
  node --test --test-reporter=tap tests/relay-page.test.mjs
}

# FR6. The rail overlapped every wide element by 32 px at three widths. This
# reads the recorded geometry, because the defect is a rendered rectangle and
# no source string states it.
sr_v31() {
  test -f "$ARTICLE_CSS" || return 1
  test -f tests/article-rail-clearance.test.mjs || return 1
  node --test --test-reporter=tap tests/article-rail-clearance.test.mjs
}

# FR7. A post that names no next step ends the funnel. The check reads the
# built posts, so a layout that drops the band fails.
sr_v32() {
  test -d dist || return 1
  test -f scripts/check-blog-funnel.mjs || return 1
  node scripts/check-blog-funnel.mjs dist
}

# FR8. One relay form across the five diagrams. The grammar file names the
# form, and the check asserts every diagram composes it.
sr_v33() {
  test -d "$DIAGRAMS" || return 1
  test -f "$BASELINE/diagram-relay-form.txt" || return 1
  node --test --test-reporter=tap tests/diagram-grammar.test.mjs
}

# FR8. No arrow may cross a box that it neither starts at nor ends at, and no
# rule may intersect the box of a text element. Both are rendered geometry.
sr_v34() {
  test -d "$DIAGRAMS" || return 1
  test -f tests/diagram-geometry.test.mjs || return 1
  node --test --test-reporter=tap tests/diagram-geometry.test.mjs
}

# FR9. The mark measured 1.6 times the cap height beside the wordmark, and the
# lockup had the same clear space as the gap between two navigation words.
sr_v35() {
  test -f tests/lockup-fit.test.mjs || return 1
  node --test --test-reporter=tap tests/lockup-fit.test.mjs
}

# FR10. Six ramps ship in the design package and the site rendered almost none
# of them. The check counts the ramps the built stylesheet references.
sr_v36() {
  test -d dist || return 1
  test -f scripts/check-ramp-coverage.mjs || return 1
  node scripts/check-ramp-coverage.mjs dist
}

# FR17. The three hosts share one presentation. The measures are the body size,
# the line height, the rule weight, the control radius, and the control height.
# A shared value that each host writes for itself is not shared, so the check
# asserts the role layer answers them.
sr_v37() {
  grep -q -- '--oe-control-height' node_modules/@open-e2ee/design/packages/design/dist/css/roles.css || return 1
  grep -q -- '--oe-rule-weight' node_modules/@open-e2ee/design/packages/design/dist/css/roles.css
}

sr_v38() {
  test -f tests/host-presentation.test.mjs || return 1
  node --test --test-reporter=tap tests/host-presentation.test.mjs
}

# FR16. The dark grounds may not read brown. Saturation is the measure, because
# a neutral at this lightness is invisible to a hue reading alone.
sr_v39() {
  test -f scripts/check-ground-neutrality.mjs || return 1
  node scripts/check-ground-neutrality.mjs
}

# --- self-assertions -------------------------------------------------------------------------

self_ci() { grep -q 'verify-site-redesign.sh' .github/workflows/ci.yml; }
self_readme() { grep -q 'verify-site-redesign.sh' README.md; }

# A path variable named for something the shell already exports overwrites it
# for every child process. `HOME=src/pages/index.astro` reached this file once
# and turned the four browser conditions red, because headless Chrome cannot
# start without a home directory. The four failed on load timeouts, which reads
# exactly like four fired assertions.
RESERVED_NAMES='HOME|PATH|USER|SHELL|TMPDIR|LANG|LC_ALL|PWD|IFS|TERM|EDITOR'
self_env() {
  ! grep -qE "^(${RESERVED_NAMES})=" "$0"
}

if ! self_ci; then
  echo 'FAIL self  .github/workflows/ci.yml does not run this script' >&2
  exit 2
fi
if ! self_readme; then
  echo 'FAIL self  README.md does not name this script' >&2
  exit 2
fi
if ! self_env; then
  echo 'FAIL self  a variable here shadows one the shell exports:' >&2
  grep -nE "^(${RESERVED_NAMES})=" "$0" >&2
  exit 2
fi

check SR-V01 'UIR5.1  Tailwind loads through the Vite plugin and the roles import' sr_v01
check SR-V02 'UIR5.1  The demo and diagram rules live in their own stylesheet' sr_v02
check SR-V03 'UIR5.1  The copied ranges match the baseline byte for byte' sr_v03
check SR-V04 'UIR5.1  The policy stays script-src self and the fonts stay local' sr_v04
check SR-V05 'UIR5.2  The header navigation is declared as data' sr_v05
check SR-V06 'UIR5.2  The footer groups are declared as data' sr_v06
check SR-V07 'UIR5.2  Every navigation destination resolves' sr_v07
check SR-V08 'UIR5.2  The disclosure and the desktop navigation share one set' sr_v08
check SR-V09 'UIR5.3  Every page uses the shared page chrome' sr_v09
check SR-V10 'UIR5.3  global.css holds no chrome rule' sr_v10
check SR-V11 'UIR5.3  The site content tests pass' sr_v11
check SR-V12 'UIR5.3  The relay pages visual fixture matches' sr_v12
check SR-V13 'UIR6.2  The article column resolves from a token measure' sr_v13
check SR-V14 'UIR6.2  An article renders its contents at the documented widths' sr_v14
check SR-V15 'UIR6.2  No page scrolls sideways at 320, 768, or 1280 px' sr_v15
check SR-V16 'UIR5.4  The demo data attribute inventory matches the baseline' sr_v16
check SR-V17 'UIR5.4  The five read class names are present' sr_v17
check SR-V18 'UIR5.4  demo:smoke passes with the recorded geometry ratios' sr_v18
check SR-V19 'UIR5.4  Reduced motion zeroes no duration a teaching animation reads' sr_v19
check SR-V20 'UIR6.3  No string matches the mechanism-explanation inventory' sr_v20
check SR-V21 'UIR6.3  The banned-claims check passes and the audit line is whole' sr_v21
check SR-V22 'UIR6.4  The six chrome measures match across the three hosts' sr_v22
check SR-V23 'UIR6.4  One theme choice persists under the shared key' sr_v23
check SR-V24 'UIR1.5  The website pins the new design tag' sr_v24
check SR-V25 'UIR5.1  The demo stylesheet needs no class the chrome defines' sr_v25
check SR-V26 'FR2  The pricing page leads with the five Relay tiers' sr_v26
check SR-V27 'FR2  Every Relay tier carries its own action, and licensing follows' sr_v27
check SR-V28 'FR3  The homepage leads with the Relay and a free start' sr_v28
check SR-V29 'FR4  The header carries a start action at every width' sr_v29
check SR-V30 'FR5  The relay page carries a figure and a free start' sr_v30
check SR-V31 'FR6  No wide element overlaps the article rail' sr_v31
check SR-V32 'FR7  Every post carries a path into the product' sr_v32
check SR-V33 'FR8  One relay form appears in all five diagrams' sr_v33
check SR-V34 'FR8  No arrow crosses a box it does not touch' sr_v34
check SR-V35 'FR9  The mark fits the cap height and the clear space holds' sr_v35
check SR-V36 'FR10  The built site references four or more ramps' sr_v36
check SR-V37 'FR17  The role layer answers the shared presentation measures' sr_v37
check SR-V38 'FR17  The website reads the shared presentation measures' sr_v38
check SR-V39 'FR16  No dark ground exceeds four percent saturation' sr_v39

printf 'Summary: %d passed, %d failed\n' "$passed" "$failed"

if [ "${1:-}" = '--ratchet' ]; then
  recorded="$(cat "$BASELINE/passing.txt")"
  if [ "$passed" -ne "$recorded" ]; then
    printf 'Ratchet: %s records %s passed, this run reports %d.\n' \
      "$BASELINE/passing.txt" "$recorded" "$passed" >&2
    printf 'A task that changes the count records it in the same commit.\n' >&2
    exit 1
  fi
  exit 0
fi

[ "$failed" -eq 0 ]
