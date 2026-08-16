# Third-party notices

## Octicons

`src/components/Icon.astro` renders six path definitions copied unmodified from
Octicons 19.32.0 (`primer/octicons`), published by GitHub Inc. under the MIT
license: `github`, `sun`, `moon`, `desktop`, `copy`, and `check`. The paths come
from `@open-e2ee/design/icons`, which carries the same notice; this site inlines
them into its own pages, so it redistributes them too and states it here rather
than pointing at a dependency. License text: `third-party/Octicons-MIT.txt`.
Naming a license without shipping it does not satisfy it.

`src/components/DeckIcon.astro` renders six more from the same release, copied
unmodified from its 24-pixel masters: `devices`, `broadcast`, `server`, `search`,
`law`, and `lock`. These are held in this repository rather than in
`@open-e2ee/design/icons`, so the copy here is the only one and the same license
text covers it. Its seventh name, `battery`, is not an Octicon: it is drawn in
this repository and the Battery section below covers it.

`src/components/BoxMark.astro` renders one more, `package`, from the same
release and the same 24-pixel masters, at the end of the landing page's "What
ships in the box" heading. It is a separate component because it is a mark on a
heading rather than a label in a column, and the same license text covers it.

The GitHub mark is copied rather than redrawn on purpose. It is a trademark,
and an approximation of someone else's trademark is worse than no mark at all.
Using it to link to our own repository is nominative use; it is not a claim of
endorsement by GitHub.

## Typefaces

Public Sans, Newsreader, and JetBrains Mono are self-hosted through
`@open-e2ee/design`, which carries their SIL Open Font License 1.1 texts in
`brand/third-party/`. This site adds no font of its own and makes no
third-party font request at runtime.

## Marks

The OpenE2EE mark and lockup come from `@open-e2ee/design` and are reserved
rather than open-sourced. See `LICENSE-BRAND.md` in that repository.

### Platform marks

`src/lib/platform-marks.mjs` inlines five vendor marks — Expo, React, Node.js,
Convex, and Cloudflare — extracted once from simple-icons 16.28.0, whose icon
files are CC0-1.0. The package was installed with `--no-save` and is not a
dependency; the paths live in this repository so the page ships with no remote
asset. The `browser` and `s3` marks are drawn here and belong to this project.

CC0 waives copyright in the drawings and says nothing about the trademarks. The
five are shown to state where the SDK runs and what it connects to, which is
nominative use: monochrome in this site's own muted colour rather than in brand
colour, at uniform size, under a "Works with" heading, with no vendor named as a
partner or endorser.

### Battery

`src/components/BatteryGlyph.astro` is drawn in this repository and belongs to
this project. It is listed here because it sits between two marks that are not
ours and would otherwise be assumed to come from the same icon set: it replaced
the 🔋 emoji beside "Batteries included", and nobody holds a mark for a figure
of speech about defaults. Two components draw it — `BatteryMark.astro` in the
landing page's lead, and `DeckIcon.astro` under the name `battery`, in a column
that is otherwise Octicons.

### TypeScript

`src/components/TypeScriptMark.astro` inlines the primary TypeScript logo, copied
unmodified from `ts-logo-128.svg` in the design asset pack published at
<https://www.typescriptlang.org/branding/> — a #3178c6 tile with the letterform
in white. TypeScript is a trademark of Microsoft Corporation. The mark names the
language the SDK is written in, beside a sentence that says so in words;
Microsoft is named nowhere as a partner or an endorser, and the mark is not a
link.

That page carries usage guidelines rather than a licence, and this use meets
them. Its Please Don't list rules out using the logo for one's own product,
modifying the shape of the logo, integrating it into one's own logo, and naming a
product so as to imply TypeScript's endorsement. The artwork here is byte-for-byte
the official file's `rect` and `path`, in the official colours; it is not this
project's logo, is not part of it, and no name on this site implies endorsement.

It did not previously meet them. The earlier version drew simple-icons'
`typescript` path, which is a faithful copy of the single-colour *alternative*
logo — the one with the letters cut out — and filled it with the primary blue.
The letters were therefore holes showing the page behind them, which passed on
the light canvas and produced two near-black letters on the dark one. That page
says of the primary mark that the "TS" in it is white and not transparent by
default. `tests/site-content.test.mjs` now fails the build if the letterform
path, its white fill, or the tile's #3178c6 is missing or altered.

### OSI keyhole

`src/components/OsiMark.astro` renders the Open Source Initiative keyhole in the
landing page's lead. Unlike the marks above, this one is used under a published
trademark licence rather than as nominative use, and the licence has conditions:
<https://opensource.org/logo-usage-guidelines>. Written permission is not
required for a business website that promotes OSI-approved licences, does not
disparage OSI, does not imply sponsorship or endorsement, carries the ® and an
attribution statement, and follows the logo guidelines. The SDK is
AGPL-3.0-or-later, which is OSI-approved; the attribution statement is in the
site footer on every page; the mark is drawn in the OSI palette and is
hyperlinked to opensource.org as the guidelines require.

The artwork is not the simple-icons path. That path is a faithful copy of OSI's
black-and-white file, which is the outline form of the mark — a ring whose wall
is 0.8 units on a 24 viewBox, and 0.65px at the size this site draws it. OSI's
standard and greyscale logos are solid, so the path here is the solid mark,
taken from the `#shape` element of the public-domain SVG of the full logo on
Wikimedia Commons and cropped to a tight viewBox. The logotype is not
displayed, and in OSI's own artwork the ® attaches to the logotype rather than
to the keyhole; the acknowledgement rides on the attribution statement instead.

The OSI logo trademark is the trademark of Open Source Initiative. This site is
not affiliated with or endorsed by the Open Source Initiative.

`tests/site-content.test.mjs` fails the build if the mark appears without the
link, the accessible name, the attribution statement, the licence it is
permitted on, or its palette colours. The conditions are the reason the mark,
its link, and its colours live in one component instead of three places.
