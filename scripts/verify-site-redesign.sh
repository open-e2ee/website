#!/usr/bin/env bash
#
# The website verifier for the UI redesign plan.
# Twenty-five conditions, SR-V01 through SR-V25. Each one names its owning task.
# The schedule is docs/plans/proof/ui-redesign/verifier-schedule.md in the
# workspace. This script is the executable copy: add and drop nothing here
# without changing the schedule in the same pull request.
#
# Every condition guards on the artifact its owning task produces, so the whole
# set is red until that task lands. A condition that could pass before its task
# ran would prove nothing. That includes the preservation conditions: the demos,
# the content security policy, and the self-hosted fonts are asserted inside the
# rewritten stylesheet, not inside the one this plan replaces.
#
# Two modes. With no argument the script exits non-zero while any condition
# fails, which is what a task uses to capture its fail-before evidence and to
# prove its own conditions green. With --ratchet it compares the pass count
# against the number recorded in scripts/redesign-baseline/passing.txt and
# fails on any difference. CI runs the second mode, so a red condition set does
# not block unrelated work, and a task that turns conditions green must record
# the new count in the same commit. The count only ever rises.

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

sr_v20() {
  test -f "$BASELINE/mechanism-phrases.txt" || return 1
  ! grep -rn -F -f "$BASELINE/mechanism-phrases.txt" --include='*.astro' --include='*.mdx' --include='*.md' src
}

sr_v21() {
  test -f "$BASELINE/mechanism-phrases.txt" || return 1
  test -d dist || return 1
  node scripts/audit-build.mjs dist
}

# --- UIR6.4, cross-surface cohesion --------------------------------------------------------

sr_v22() {
  test -f tests/cohesion.test.mjs || return 1
  node --test tests/cohesion.test.mjs
}

sr_v23() {
  test -f tests/cohesion.test.mjs || return 1
  grep -q "oe-theme" tests/cohesion.test.mjs && node --test tests/cohesion.test.mjs
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

# --- self-assertions -------------------------------------------------------------------------

self_ci() { grep -q 'verify-site-redesign.sh' .github/workflows/ci.yml; }
self_readme() { grep -q 'verify-site-redesign.sh' README.md; }

if ! self_ci; then
  echo 'FAIL self  .github/workflows/ci.yml does not run this script' >&2
  exit 2
fi
if ! self_readme; then
  echo 'FAIL self  README.md does not name this script' >&2
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
