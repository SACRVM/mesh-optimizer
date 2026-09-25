# mesh-optimizer

Mesh cleanup and simplification as an app built on
[SACRVM APPKIT](https://github.com/SACRVM/sacrvm-appkit). It started as the
Mesh Prep Tool of DREAM TOOLS and was taken out as an app of its own; the
3D-game-specific parts stayed behind (the "TO WORLD" hand-off). The former
"In-Game View" lives on as the generic **Single-sided view** (backface
culling shows wrongly wound faces as holes).

## The shape

**One repo, one app** — `app.json`, `app.js`, `app.css`, `index.html`,
vendored `kit/` — plus one extra file:

- `app.js` — the custom element (classic script): markup from kit
  components only, open / save through `context.files`, drop target,
  visibility, lifecycle.
- `engine.js` — the tool itself, an ES module that `app.js` imports on
  mount: half-edge mesh, adaptive QEM + meshoptimizer simplification, loose
  parts, repair, face/edge/vertex editing, the Three.js viewport.
  `start(root, { isVisible, saveFile })` → `{ app, openFile, dispose }`.

Rules that keep it working on a desktop page:

- **Every DOM lookup is scoped to the app element** (`$id()` = `ROOT.querySelector`).
  Never `document.getElementById` — another app on the same page may use the
  same ids. Scene-graph rows carry an `mo-` id prefix for the same reason.
- **No importmap.** A host page has none, so Three.js and meshoptimizer are
  imported by full jsDelivr URL. Three addons MUST use the `/+esm` form
  (`…/examples/jsm/<path>.js/+esm`): jsDelivr rewrites their bare `'three'`
  import to `/npm/three@0.170.0/+esm`, which is the same module as the main
  import — one Three instance. Mixing in a plain `three.module.js` URL gives
  two instances and breaks `instanceof`.
- **Engine ↔ app hooks.** `start(root, host)` takes `isVisible`, `saveFile`,
  `notify(message, kind)` (→ `sac.toast`; every user-relevant result goes
  through it, the console is for debugging only), `busy(label)` (resolves once
  the overlay has painted, returns `done()`) and `setDirty(bool)` (every
  `pushState()` marks dirty, a load clears it, app.js clears it after a save).
  The engine's keys are data (`keyBindings()`); app.js registers them with
  `sac.hotkeys` while the app is on screen — never a raw `keydown` listener.
- **`sac-stepper` has a fixed 3-character value field**, so it is used only
  for short integers (rotation 0–345° in 15° steps, the parts threshold up to
  999). Decimals (position, scale) stay plain number inputs.
- **Keys and rendering only while on screen** (`IS_VISIBLE()`, fed by an
  IntersectionObserver): the render loop idles and the keydown handler returns
  while the view is hidden.
- **Kit events:** `sac:change` / `sac:input` with `e.detail.value`; the scene
  graph speaks `sac:select`, `sac:expand`, `sac:visibility`, `sac:recolor`,
  `sac:delete`.
- **No build step, ever. The kit is vendored** (autark): `kit/` is the
  release ZIP's copy, verbatim, never edited here. Tokens only — no raw colours.

## UI conventions

Shared by the four apps that came out of DREAM TOOLS (vectorizer,
background-remover, mesh-optimizer, svg-to-3d) — keep them identical.

1. **Toolbar order:** Open (`btn`, icon `folder`, not primary) · main export
   (`btn primary`, icon `download`, label = format, pinned with
   `data-overflow="never"` — the ribbon's overflow folds buttons but never a
   `sac-menu`, so an unpinned primary would vanish first on a phone) · further
   formats in one `sac-menu` "More ▾" · Copy where it applies
   (`nav-icon-btn`) · app-specific icon buttons · Credits (`copyright`) · Help
   (`info`).
2. **Exports always ask** (Save as…) — no silent overwrite through a kept
   handle. Ctrl+S on an empty app does nothing.
3. **Credits via `sac.about`** from the manifest — the `notices` in `app.json`
   are what users see, keep them complete.
4. **Empty state = `sac-drop-zone`** in `.app-drop`, styled by the shared
   `.app-drop` CSS block (identical in all four `app.css`: ink and glass on
   `--lift`, because the viewport is black in both themes; clears the label
   row and the HUD). Its click / Enter go through `context.files.open`, not
   the device picker.
5. **Settings are remembered:** controls with `data-keep="key"` are saved to
   `context.fs` ("settings") and replayed on mount through their kit event.
   Per-document values (e.g. a threshold fitted to one image) are not kept.
6. **Ctrl+O / Ctrl+S** (open / main export) through `sac.hotkeys`, registered
   only while the app is on screen.
7. **No prose on the UI.** Panels, windows and the empty state carry controls,
   short labels and data readouts only — every explanation goes into the Help
   window.

8. **View reset:** every app with a zoomable / orbitable view has a
   `nav-icon-btn` with icon `fit` in its app-specific icon group.
9. **Unsaved work is guarded** where the user edits something (not for pure
   parameter apps): `context.setDirty` on the first edit, cleared after a
   successful save; replacing a dirty document asks `sac.dialog.confirm`
   ("Discard unsaved changes?"). Never the native `confirm()`.
10. **Keyboard through `sac.hotkeys` only** — no raw keydown listeners for
    shortcuts; apps with more than Open/Save get a `keyboard` button and the
    `?` key opening a `sac-shortcut-sheet`. Hold-keys (Space to pan) stay
    manual until the kit supports them.
11. **Feedback is visible:** results and warnings go to `sac.toast`, work that
    blocks for more than a moment shows a busy overlay — never console only.
12. **Kit controls with their limits:** `sac-stepper` only for short integers
    (its value field is 3ch wide); decimals stay kit-styled number inputs.
    Slider readouts carry a unit or named steps, never a bare technical number.
13. **Theme toggle** (`sac-theme-toggle` in the nav's `context` slot) only
    standalone — removed when `context.host` is set.
14. **Settings migrations** go through the snippet's `_migrateSettings(saved)`
    hook (sync, returns the migrated object) — the `_restoreSettings` snippet
    stays byte-identical in all four apps.

**Language:** chat in German, code/docs/commits in English.

## Develop, test, publish

Shared by the four apps that came out of DREAM TOOLS — keep identical.

- **Dev loop:** `npx serve . -l 3343` (Firepit command "Serve"), F5. `serve.json`
  disables caching.
- **Test both runtimes — they fail differently.** Standalone (`index.html`,
  vendored kit) AND installed on https://desktop.sacrvm.dev/ (the host's kit
  is live there; the app is injected into the host page). Recipe and a
  template script: global knowledge doc "Headless-testing SACRVM appkit apps"
  (`firepit_knowledge_search`). Stub `context.files.save/open` in tests —
  real pickers hang headless.
- **Always check:** dark + light theme + a 390px phone viewport (look at the
  screenshots), console clean, settings survive a reload, every export
  arrives, Ctrl+O / Ctrl+S.
- **Publish:** bump `version` in `app.json` (semver: fix = patch, feature =
  minor), commit, push to `main`. GitHub Pages serves `main` / root; wait
  until `https://sacrvm.github.io/<repo>/app.json` shows the new version,
  then re-test installed on the desktop. The repo carries the topic
  `sacrvm-app` → listed in the desktop's App Store. Desktops store the
  address, not a copy: every push is live for every installation.
- **Kit upgrade:** delete `kit/`, unzip the new release's `kit/` verbatim
  (`gh release download vX.Y.Z -R SACRVM/sacrvm-appkit`), check
  `CONSUMING.md` / `MIGRATION.md` for breakers, test both runtimes, commit
  "Vendor SACRVM APPKIT X.Y.Z". Never edit `kit/`.
- **Siblings:** vectorizer, background-remover, mesh-optimizer, svg-to-3d
  share the UI conventions and the `_restoreSettings` / `_about` /
  `_wireDropZone` / `_registerFileKeys` snippet byte-for-byte. A change to
  either belongs in all four — say so in the commit.

## Open items

Kit 2.12.0 is vendored. View settings (folded by default), Loose parts and
Repair are collapsible `sac-section`s; their folded state is kept in
`context.fs` ("sections", via `data-fold`), outside the shared settings
snippet.

Ready now (the desktop host runs 2.12.0 too), but shared across the four
DREAM-TOOLS-born apps — change them in all four at once:
- `sac-menu` folding in the toolbar overflow → then the
  `data-overflow="never"` pin on the OBJ button can go.
- `.on-viewport` on `sac-drop-zone` → then the six token overrides in the
  shared `.app-drop` block can go (in all four apps at once).

Waiting on the appkit:
- `sac-stepper` width for decimals → then positions and scale become
  steppers too.

Known / owner decisions open:
- **Accent colour:** still the kit default blue (no own identity). Owner
  undecided whether apps should follow the desktop colour by default.
- Standalone on a phone the theme toggle pushes the brand to "MESH OPTIMI…"
  (hosted it is hidden).
- Face / edge / vertex / part editing is mouse-only (hidden on touch).

## Firepit inbox

At the start of a session, read any pending messages in `.firepit/inbox/*.md` — cross-project notes Firepit routes here. Act on each, then mark it done with the `firepit_inbox_complete` MCP tool, passing the message's filename as the `id`.

## Firepit knowledge

Before researching something that may already be known, query the knowledge base with the `firepit_knowledge_search` MCP tool (scope `both` covers this project plus the global base). Save durable findings with `firepit_knowledge_add` — written in English, per the indexing convention. The created markdown files live under `.firepit/knowledge/` and are committed like any other file.

## Firepit pinned knowledge

@.firepit/knowledge-pinned.md

The import above auto-loads the knowledge docs marked `pin: true` in their frontmatter — always-on rules that apply every session without a search. Firepit regenerates the file from the pinned docs; don't edit it directly. Pin/unpin via the pinned flag on `firepit_knowledge_add` / `firepit_knowledge_update`, and keep the pinned set small — everything else stays reachable through `firepit_knowledge_search`.

## Firepit artifacts

When you produce a file the user will want to open — a report, screenshot, diagram, generated image, log excerpt, build output, or an executable you built for them to run — pin it with the `firepit_artifact_add` MCP tool so it appears in the project's paperclip pane. Do this as you produce it, not at the end of the session; a path buried in scrollback is a path the user has to hunt for. Pinning only links the file — it stays where it is, and `firepit_artifact_remove` never deletes it. Check `firepit_artifact_list` first so you update an existing entry instead of piling up near-duplicates, and unpin what has gone stale.

## Firepit conventions

<!-- claude-firepit-fragments -->

@../.firepit/projects/claude.md
@../.firepit/projects/claude-github-public.md

The two imports above are shared files in the Firepit central repo — edit them there and every project follows. They carry policy; the tools themselves are described by Firepit's MCP server at the handshake, so nothing is duplicated between the two.
