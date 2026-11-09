/**
 * SACRVM APPKIT — sac.apps: the app runtime.
 * Registry of app manifests, floating-window lifecycle, ?app= deep links and
 * the mount(context) capability handshake. Supersedes the old sac.launcher
 * lib (whose API survives below as a thin delegating alias).
 *
 * An app = ONE custom element in ONE classic script. The script guards its
 * definition (`if (!customElements.get(TAG)) customElements.define(...)`) and
 * registers no other tags — that is what makes an app portable to any page.
 *
 * Manifest:
 *
 *   sac.apps.register({
 *       id:          "color-bucket",          // unique; ?app= deep links + persistence key
 *       name:        "Color Bucket",          // display name
 *       icon:        "palette",               // sac-icon name
 *       description: "Mix and manage colors", // tile subline (optional)
 *       version:     "1.0.0",                 // optional — shown in About + on install
 *       notices:     [{ title, text }],       // optional — third-party credits, licence
 *                                             // and trademark text; sac.about renders
 *                                             // each as a titled section (+ name/icon/version)
 *       tile:        "wide",                  // optional tile footprint in the launcher
 *                                             // grid: "medium" (default, omit-able) |
 *                                             // "wide" (2 columns) | "large" (2 columns
 *                                             // × 2 rows) | "small" (icon only, four
 *                                             // fill one medium cell); unknown values
 *                                             // fall back to medium silently
 *       tiles: [                              // optional — MULTIPLE launcher tiles for
 *           { id: "today",                    // one app (complex apps deploy several
 *             name: "Today",                  // entry points into a desktop). When set,
 *             icon: "clock",                  // these REPLACE the app's default tile.
 *             description: "…",               // Each entry may override name/icon/
 *             route: "today",                 // description/tile/accent and adds:
 *             accent: "#e59500" },            //   route  — views: opens "#/<id>/<route>"
 *           …                                 //   params — windows: handed to open()
 *       ],                                    //   accent — colors the tile AND the app
 *                                             //            opened through it (its --accent
 *                                             //            seed — the Windows-Phone move:
 *                                             //            tile color = app highlight)
 *       kind:        "window",                // "window" | "view" | "page"
 *       // kind:"window" and kind:"view":
 *       tag:         "app-color-bucket",      // the app's custom element
 *       src:         "apps/color-bucket.js",  // classic script, injected on first open
 *       accent:      "#10b981",               // optional — set as --accent on the app
 *       // kind:"window" only:
 *       width:       "520px", height: "640px",// sac-window size (defaults 500px/600px)
 *       controls:    "close",                 // optional — sac-window controls subset ("min max close")
 *       resizable:   false,                   // optional — false sets no-resize on the window
 *       // kind:"page" only:
 *       href:        "orb-lab/",              // tile becomes a normal link
 *       // capabilities — optional, the app's ASK (a host's confirm dialog
 *       // lists them; what is actually handed over is the host's grant):
 *       permissions: { files: true, identity: true }, // beyond the always-on fs
 *       connect:     ["https://api.example.com"],     // https origins it talks to
 *       opens:       ["image/png", "image/*", ".png"], // what it can open — see opening()
 *       isolated:    true,                    // optional — the app asks to be
 *                                             // sandboxed; can only RAISE isolation
 *   });
 *   sac.apps.init();   // binds [data-app] tiles + ?app= deep links
 *
 * The three kinds — where an app runs:
 *
 *   "window"  floats above the shell in a <sac-window>. Small tools, things
 *             you want beside your work.
 *   "view"    takes over the shell's stage: ONE hub, everything else an app.
 *             Addressed by hash — "#/<id>", with the app's own sub-route
 *             after it ("#/styleguide/components"), so back/forward and
 *             bookmarks work. The element is created once and kept (hidden)
 *             when you switch away, so state survives; mount() runs once.
 *             A view is a COMPLETE app: it draws its own chrome — nav,
 *             toolbar, rail — in its own markup. The host injects context
 *             into it (context.host: jump-home, the suite's navigation,
 *             the host's toolbar controls — all rendered by the app's own
 *             nav), never the other way around.
 *   "page"    its own document. Only for apps that must also stand alone.
 *
 * Shell contract for views (see kit/templates/shell.html):
 *
 *   sac.apps.init({ viewHost: "#app-stage", home: "#app-home",
 *                   host: { name: "MY DESKTOP", icon: "cube", href: "#/" } });
 *
 *   viewHost — element the view elements are appended to (default "#app-root",
 *              the kit's SPA convention)
 *   home     — element shown while no view is active, i.e. at "#/" (optional)
 *   host     — what this host injects into every view's own chrome; apps
 *              receive it as context.host and assign it to their own nav
 *              (nav.host = context.host). Shape: { name, icon, href,
 *              nav: [{label, href, icon?}],  → the suite's cross-app
 *              navigation, shown as a host group in the app's burger panel
 *              toolbar: [{icon, label?, title?, href?|onClick?}] } → host
 *              controls at the right end of the app's ribbon (a signed-in
 *              user, a suite-wide action). Optional — without it apps show
 *              no host presence.
 *
 * API:
 *   register(manifest, opts?)  upsert by id (re-register replaces; first
 *                        registration fixes the list order). Emits
 *                        "sac:apps-changed" on document.
 *                        opts { isolated, grant } — the HOST's decision, never
 *                        the manifest's (see "Isolation and grants" below).
 *                        Omitted on a re-register, the previous choice stays.
 *   list()               → array of manifest copies, registration order
 *   get(id)              → manifest copy or null
 *   open(id, params?, opts?) → Promise<HTMLElement> resolving to the app
 *                        element.
 *                        params: URLSearchParams | object | string, handed to
 *                        the app via context.params.
 *                        opts { route, accent }: what a launcher tile carries —
 *                        route opens a view at "#/<id>/<route>", accent seeds
 *                        the app's --accent (tile color = app highlight).
 *                        opts.files: [FileRef] — "Open with": the app starts
 *                        with these files (context.launch.files), or, already
 *                        mounted, hears them via context.onLaunch. FileRefs of
 *                        the host's files provider; only with a files grant
 *                        (else the app gets none). An isolated app gets them
 *                        like picked files: opaque handle ids.
 *                        kind:"page" navigates
 *                        (params appended) and the promise never resolves.
 *                        kind:"window" injects src once (keyed by src), awaits
 *                        customElements.whenDefined(tag) and shows the app in
 *                        a centered, slightly cascaded <sac-window> that stays
 *                        in the DOM and is re-open()ed on later calls.
 *                        Rejects on script load failure (console.error +
 *                        sac.toast if available — an error toast with a
 *                        "Try again" action that repeats this open; not
 *                        for an "integrity" failure, which retrying cannot
 *                        fix).
 *                        kind:"view" does the same injection, then puts the
 *                        element on the shell's stage and sets the hash to
 *                        "#/<id>" — the address IS the open call, so a link
 *                        works as well as a click.
 *   close(id)            window: closes it (element + window stay in the DOM).
 *                        view: leaves the stage, back to the home section. The
 *                        address goes back to "#/" only while it still names
 *                        the view; once it has moved on, it is left alone.
 *   remove(id)           unregister; if the app was created, calls its
 *                        unmount() (when present) and drops window or view.
 *                        Emits "sac:apps-changed".
 *   isOpen(id)           → boolean (window open, or view currently on stage)
 *   isDirty(id)          → boolean — the app said it holds unsaved work
 *                        (context.setDirty). Ask before remove()ing it.
 *   active()             → id of the view on stage, or null
 *   init(options?)       binds click on [data-app="<id>"] tiles (delegated,
 *                        so tiles rendered later work too), handles the
 *                        ?app=<id> deep link, then cleans the URL via
 *                        replaceState, and — when any view app is registered —
 *                        routes the hash. Legacy compatibility: [data-overlay]
 *                        and ?tool= are honored the same way.
 *                        options.tiles: false — no [data-app] click delegation
 *                        (a shell that uses the attribute itself, or opens
 *                        apps only from code). A hash that names no view (a
 *                        sac.router page beside the views) parks the view on
 *                        stage; it stays mounted for its next open. Recipe for
 *                        views beside sac.router: the style guide, Helpers →
 *                        sac.apps.
 *   inspect(url)         → Promise<manifest> — reads app.json, runs nothing.
 *                        Adds src, origin, manifestUrl and entryIntegrity
 *                        ("sha256-…" of the entry's bytes, or null when the
 *                        entry could not be read or crypto.subtle is missing —
 *                        an insecure context). Rejects a malformed capability
 *                        field (connect not an https origin, …); unknown keys
 *                        pass through untouched.
 *   add(input, opts?)    → Promise<manifest> — inspect (a URL) + register.
 *                        opts { isolated, grant, integrity }. The returned
 *                        manifest carries the pin as `integrity`: keep it with
 *                        the install record and hand it back on the next boot.
 *   policy(id)           → { isolated, granted } — what the host decided, or null
 *   frameOf(id)          → the <iframe> of an isolated app once created, or null
 *   opening(file)        → manifest copies whose `opens` matches a file — a
 *                        FileRef, a File, or { name, type }. An entry matches
 *                        by exact MIME, "type/*", or ".ext" (case-insensitive)
 *                        — so every host lists the same "Open with" choices.
 *
 * Isolation and grants (the host's decision — a manifest cannot make itself
 * trusted; its own `isolated: true` can only raise isolation):
 *   isolated = opts.isolated === true || manifest.isolated === true
 *   An isolated view or window runs in <iframe sandbox="allow-scripts
 *   allow-forms allow-popups allow-downloads"> — never allow-same-origin —
 *   and reaches the host only through the bridge (kit/js/lib/app-bridge.js,
 *   loaded on demand; the frame runs kit/js/lib/app-guest.js). The app gets
 *   the same context shape; context.isolated says true.
 *   grant { files, identity, connect, api } — what the host hands over.
 *     files: true (the page's sac.files) | false | { provider } — a files
 *     provider for THIS app only ({ kind, open, save }, the remote provider
 *     pattern in files.js), or a factory (manifest) → provider | null run
 *     once at register/add, e.g. to root it at the app's own folder:
 *       grant: { files: { provider: (m) => sac.files.virtual({
 *           store, root: `Apps/${m.id}`, readonly: true }) } }
 *     context.files then talks to that provider alone (same-realm and
 *     isolated alike; handles stay host-side for an isolated app), and
 *     context.granted.files says "scoped". A malformed value grants nothing.
 *     One shape on purpose — no separate filesFor(appId) hook: the grant is
 *     already where a host decides per app, it is sticky with the rest of
 *     the policy, and the factory covers "the id is only known after
 *     inspect()". Needs kit/js/lib/files.js loaded, like `true`.
 *     identity: true (the host's profile as is) | "pseudonymous" | false.
 *     "pseudonymous" hands { id, name, avatar } where id is derived per
 *     (user, app) — SHA-256 over sac.apps.identitySalt + the user's id + the
 *     app's id — so the app cannot recover the real id and two apps cannot
 *     correlate one person; nothing else of the profile crosses. Works for
 *     same-realm apps too. Needs crypto.subtle (a secure context); without
 *     it the pseudonymous identity stays null. Defaults:
 *     isolated      { fs: true, files: false, identity: false, connect: [] }
 *                   (files: "scoped" with a provider grant)
 *     not isolated  everything the page loaded (as before); connect = the
 *                   manifest's ask — same-realm code shares the page's fetch,
 *                   so connect is advisory there, enforced only in the frame
 *                   (its CSP connect-src).
 *     api: the host's OWN capabilities, per app — { name: { method: fn } }:
 *       grant: { api: {
 *           db:      { query: (spec) => …, insert: (table, values) => … },
 *           members: { list: () => … },
 *       } }
 *     The app calls context.db.query(…) — same-realm and isolated alike
 *     (through the bridge). Every method returns a promise; arguments and
 *     results must be structured-cloneable for an isolated app. A thrown
 *     error reaches the app as a rejected promise with { code, message }:
 *     the host's own err.code when it is a short lowercase word
 *     ("forbidden", "not-found"), else "internal". Names must be plain
 *     identifiers that are not context fields already (fs, files, theme,
 *     …); anything else is skipped with a warning. context.granted.api
 *     lists the names handed over.
 *   context.granted reflects the result; an ungranted capability is null.
 *   Theme and language belong to the host: inside an isolated app a user's
 *   click on a <sac-theme-toggle> / <sac-lang-toggle> switches the HOST (as
 *   the same toggle does same-realm) and the frame follows — never the
 *   frame alone. The app's own sac.commands appear in the host's palette.
 *   sac.apps.identitySalt — the host's secret for pseudonymous ids. Default:
 *                   generated once and kept in localStorage
 *                   ("sac.apps.identity-salt"); set it (e.g. per account,
 *                   from the server) to keep ids stable across devices.
 *   sac.apps.frameUrl  — a host that serves its own harness document: a URL
 *                   string, or (manifest, granted) → URL. Unset, the kit
 *                   builds a srcdoc harness with a CSP from the grant.
 *   sac.apps.kitUrl    — the kit folder the frame loads ("…/kit/"); default
 *                   derived from this script's own URL.
 *   sac.apps.limits    — { timeout: 30000, maxBytes: 64 MiB, rate: 200 } for
 *                   the bridge: call timeout, the ceiling for one payload (a
 *                   Blob's size, or a structured-clone estimate of a value),
 *                   calls per second per frame ("rate-limited" beyond).
 *
 * Pinned installs: a manifest with `integrity` loads its entry with
 * <script integrity crossorigin="anonymous"> (same-realm and in the frame),
 * so the browser refuses changed bytes. add() pins automatically for an
 * isolated install (from entryIntegrity); a same-realm host opts in with
 * add(m, { integrity: true }) or a hash string, and add(m, { integrity:
 * false }) drops a pin. A failed load rejects with a typed error — err.code
 * "integrity" (the entry is reachable but its bytes changed) or "network"
 * (unreachable). Told apart by re-fetching the entry and hashing it after the
 * script tag fails. No integrity = today's behavior, unpinned.
 *
 * mount(context) lifecycle:
 *   The host calls el.mount(context) IF the method exists — exactly once per
 *   element lifetime (re-opening an existing window, or returning to a view,
 *   does NOT re-mount). Windows mount right after the element is appended;
 *   views mount when they first appear on the stage, never while hidden, so
 *   an app that measures (sizing a canvas, scrolling to its route) has a real
 *   box to measure.
 *   el.unmount() (if present) is called only by sac.apps.remove(). Apps that
 *   define neither still work — the contract is opt-in.
 *   A mount() that throws (in-realm, or reported by an isolated app's
 *   frame) never leaves an empty window or view: the window / view shows
 *   an .empty-state — "“Name” couldn't start." with a Close button — in
 *   the app's place (an in-realm element is swapped out, an isolated
 *   frame hidden behind it). Close discards that instance, so the next
 *   open() creates and mounts a fresh element. sac:app-error (kind
 *   "mount") still fires, and open() still resolves.
 *
 *   context = {
 *       appId: "color-bucket",
 *       manifest: {…},             // the app's own manifest, copied (name/icon/
 *                                  // description/version/notices) — pass it straight
 *                                  // to sac.about.open() for the standard About
 *       params: URLSearchParams,   // deep-link params snapshot at open (empty if none)
 *       route: "components",       // views only: the sub-route after the app id
 *                                  // in "#/<id>/<route>" ("" when there is none)
 *       onRoute(cb),               // views only: cb(route) whenever the sub-route
 *                                  // changes from outside — a rail link, the back
 *                                  // button, a pasted URL. Returns an unsubscribe.
 *       host: {                    // views only, null standalone: what the HOST
 *           name, icon, href,      // injects into the app's own chrome. PLAIN
 *           nav:     [{label, href, icon?}],       // DATA, never DOM nodes —
 *           toolbar: [{icon, label?, title?,       // the app's OWN <sac-nav>
 *                      href? | onClick?}],         // renders every bit of it
 *       },                         // (nav.host = context.host): ⌂ jump, suite
 *                                  // nav in the burger, controls in the ribbon.
 *                                  // A host may re-declare (init({host}) again):
 *                                  // this object is mutated in place and a
 *                                  // sac:host-changed event repaints the nav —
 *                                  // no app cooperation, assign it once.
 *       deepLink: {
 *           set(x)                 // window: writes ?app=<id>&<x entries> via
 *                                  // history.replaceState; set(null) cleans the
 *                                  // URL back to the bare path (hash preserved).
 *                                  // view: set("components") writes the sub-route
 *                                  // "#/<id>/components", set(null) "#/<id>" —
 *                                  // replaceState, so a view swap stays one history
 *                                  // entry
 *       },
 *       theme: {
 *           get(),                 // "dark" | "light" | "auto" (the flag, not the resolution)
 *           set(mode),             // same values; routes through <sac-theme-toggle>
 *                                  // when present, so the toggle stays in sync
 *           onChange(cb),          // cb(resolved) with "dark"|"light" on every
 *                                  // EFFECTIVE change (incl. OS flips in auto);
 *                                  // returns an unsubscribe function
 *       },
 *       fs: {                      // storage scoped to this app (kit/js/lib/fs.js),
 *           read(path, fallback),  // null when the host loaded no fs lib —
 *           write(path, value),    // apps check before reaching for it
 *           remove(path), list(prefix), clear(), usage(), watch(cb),
 *       },
 *       identity: {                // who is at this desktop (kit/js/lib/identity.js),
 *           get(),                 // null when the host granted none. READ-ONLY:
 *           onChange(cb),          // the profile belongs to the host, not to an app
 *       },
 *       files: {                   // the USER's files (kit/js/lib/files.js) —
 *           open(opts),            // Open… / Save as… wherever the host keeps
 *           save(data, opts),      // them (device by default, the desktop's
 *           kind,                  // space when it installed one, or a
 *           readonly,              // provider granted to this app alone —
 *       },                         // readonly: save() rejects "denied").
 *                                  // Null when the host loaded no files lib
 *       lang: {                    // the page's language (globals.js) —
 *           get(),                 // "en", "de", … READ-ONLY: the host owns
 *           onChange(cb),          // the switch, like the theme; re-render
 *       },                         // your strings (sac.t) in the callback
 *       setDirty(flag),            // true = unsaved work: leaving the page asks
 *                                  // first, sac.apps.isDirty(id) tells a host,
 *                                  // document gets sac:dirty { id, dirty }.
 *                                  // Closing a window loses nothing (it stays
 *                                  // in the DOM) and so never asks.
 *       close(),                   // sac.apps.close(<own id>) — a window closes,
 *                                  // a view goes home
 *       launch: { files },         // "Open with": the FileRefs it was opened
 *                                  // with (open(id, params, { files })) — read
 *                                  // f.file, save back with files.save(blob,
 *                                  // { handle: f.handle }). [] without a grant
 *       onLaunch(cb),              // cb({ files }) when opened again with files
 *                                  // while mounted. Returns an unsubscribe
 *       <name>: { <method>(…) },   // a host capability (grant.api) — async
 *       granted: {                 // what the host actually handed over —
 *           fs, files, identity,   // booleans (identity may also be
 *                                  // "pseudonymous", files "scoped" — a
 *                                  // provider of its own); check before reaching for a
 *           connect: [origins],    // capability instead of guessing why it
 *           api: [names],          // is null; api = the host capabilities
 *       },
 *       isolated: false,           // true inside a sandboxed frame
 *   }
 *
 * Events:
 *   sac:apps-changed (on document, bubbles) — detail { id, type }. The registry
 *   types are "register" and "remove" (what registry-driven UI like
 *   <sac-launcher> refreshes on). The stage also emits "view" (id = the app now
 *   on stage) and "home" (id = null, back at "#/"), so a host can track which
 *   view is showing.
 *   sac:app-error (on document, bubbles) — an app could not load, or broke
 *   after it loaded. detail { appId, kind, message, code?, source?, line?,
 *   column?, stack? }; kind is "load" (its script or frame did not start, or
 *   it changed since it was installed — code "integrity"; the kit also toasts
 *   it), "mount" / "unmount" (the call threw — any app; a mount failure
 *   also shows in the app's window or view, see mount()), or "error" /
 *   "rejection" (an uncaught exception / unhandled rejection inside an
 *   isolated frame; in-realm those are the page's own). Strings are capped (message 1000,
 *   stack 4000) and each app may report 10 a second (burst 10) — a looping
 *   error cannot flood the host. `source` is set only when it lies in the
 *   app's own entry folder. Load failures also still reject sac.apps.open().
 */
(function () {
    if (!window.sac) { console.warn("[sac.apps] globals.js must load first — app runtime unavailable."); return; }
    if (sac.apps) return;   // idempotent

    // The kit folder ("…/kit/"), read at parse time — the one moment
    // document.currentScript is this file. An isolated app's frame loads
    // the same kit from here (sac.apps.kitUrl overrides).
    const KIT_BASE = (() => {
        const s = document.currentScript;
        try { return s && s.src ? new URL("../../", s.src).href : null; }
        catch (err) { return null; }
    })();

    const registry = new Map();   // id  → manifest (internal copy)
    const policies = new Map();   // id  → { hostIsolated, isolated, grant } — the host's choice
    const windows  = new Map();   // id  → { win, el }
    const views    = new Map();   // id  → { el, route, routeCbs }
    const injected = new Map();   // src → Promise (each script injected once)
    const opening  = new Map();   // id  → in-flight open() Promise
    const viewOpening = new Map();// id  → in-flight view creation Promise
    let stackOffset = 0;          // cascade multiple open windows slightly
    let inited = false;
    let tilesBound = false;       // the document-wide [data-app] click delegation
    let hashBound = false;
    let viewHost  = null;         // element the view elements live in
    let homeEl    = null;         // shown while no view is on stage ("#/")
    let activeId  = null;         // the view currently on stage
    let baseTitle = "";           // document.title at init, restored at home
    let hostInfo  = null;         // { name, icon, href } injected as context.host
    const dirty   = new Set();    // ids holding unsaved work (context.setDirty)

    /* ------------------------------------------------------ typed errors --
       A load or bridge failure carries err.code, so a host can word it:
       "integrity" (the author changed the pinned entry), "network", "denied",
       "not-found", "bad-request", "too-large", "timeout", "internal". */

    function appError(code, message) {
        const err = new Error(message);
        err.name = "SacAppError";
        err.code = code;
        return err;
    }

    /* ---------------------------------------------------- capabilities --
       The manifest's ASK (permissions / connect / opens / isolated). Light
       validation: a malformed known field is reported, unknown keys are left
       alone — forward compatible. */

    const PERMISSIONS = ["fs", "files", "identity"];
    const LOOPBACK = /^(localhost|127(?:\.\d{1,3}){3}|\[::1\])$/i;

    /** "https://api.example.com" (or http on loopback, for development) → its
     *  origin; anything else → null. A path, query or credentials disqualify:
     *  a grant is an origin, never a URL. */
    function originOf(value) {
        if (typeof value !== "string" || !value.trim()) return null;
        let url;
        try { url = new URL(value.trim()); } catch (err) { return null; }
        const secure = url.protocol === "https:" || (url.protocol === "http:" && LOOPBACK.test(url.hostname));
        if (!secure || url.username || url.password || url.search || url.hash) return null;
        if (url.pathname !== "/") return null;
        return url.origin;
    }

    /** → { problems: string[], clean: { permissions?, connect?, opens?, isolated? } } */
    function checkCapabilities(data) {
        const problems = [];
        const clean = {};
        if (data.permissions !== undefined) {
            const p = data.permissions;
            if (!p || typeof p !== "object" || Array.isArray(p)) {
                problems.push("permissions must be an object like { files: true }");
            } else {
                clean.permissions = Object.assign({}, p);
                PERMISSIONS.forEach((k) => {
                    if (p[k] !== undefined && typeof p[k] !== "boolean") {
                        problems.push(`permissions.${k} must be true or false`);
                        delete clean.permissions[k];
                    }
                });
            }
        }
        if (data.connect !== undefined) {
            if (!Array.isArray(data.connect)) {
                problems.push("connect must be an array of https origins");
            } else {
                clean.connect = [];
                data.connect.forEach((c) => {
                    const o = originOf(c);
                    if (o) { if (!clean.connect.includes(o)) clean.connect.push(o); }
                    else problems.push(`connect entry "${String(c)}" is not an https origin`);
                });
            }
        }
        if (data.opens !== undefined) {
            if (!Array.isArray(data.opens) || !data.opens.every((s) => typeof s === "string" && s.trim())) {
                problems.push("opens must be an array of MIME types or .extensions");
            } else {
                clean.opens = data.opens.map((s) => s.trim());
            }
        }
        if (data.isolated !== undefined && typeof data.isolated !== "boolean") {
            problems.push("isolated must be true or false");
        }
        return { problems, clean };
    }

    /** The host's choice for one app. Omitted options keep the previous
     *  choice, so a re-register (a recolored tile, a refreshed manifest) can
     *  never quietly turn a sandboxed app into a trusted one. */
    function resolvePolicy(manifest, opts, prev) {
        const o = opts || {};
        const hostIsolated = o.isolated !== undefined ? o.isolated === true : !!(prev && prev.hostIsolated);
        const grant = o.grant !== undefined ? Object.assign({}, o.grant || {}) : (prev ? prev.grant : {});
        return {
            hostIsolated,
            isolated: hostIsolated || manifest.isolated === true,
            grant,
        };
    }

    function policyOf(id) {
        return policies.get(id) || { hostIsolated: false, isolated: false, grant: {} };
    }

    /** grant.files as the host said it: true | false | { provider } — a
     *  provider ({ kind, open, save }, e.g. sac.files.virtual({ root })) or
     *  a factory (manifest) → provider | null, run here once per register
     *  (the host may not know the id before add() inspected the URL).
     *  Anything malformed → false: fail closed, with a warning. */
    function filesGrantOf(value, manifest) {
        if (value === undefined || value === true || value === false) return value;
        let p = value && typeof value === "object" ? value.provider : undefined;
        if (typeof p === "function") {
            try { p = p(Object.assign({}, manifest)); }
            catch (err) {
                console.warn(`[sac.apps] ${manifest.id}: the grant.files provider factory threw — files not granted`, err);
                return false;
            }
        }
        if (isFilesProvider(p)) return { provider: p };
        if (p != null || !value || typeof value !== "object") console.warn(`[sac.apps] ${manifest.id}: grant.files needs true, false or { provider } with open() and save() — files not granted`);
        return false;
    }

    // Context fields a host capability may not shadow.
    const RESERVED = ["appId", "manifest", "params", "theme", "fs", "identity", "files", "lang",
        "setDirty", "close", "granted", "isolated", "deepLink", "route", "onRoute", "href", "host",
        "accent", "regional", "commands", "toolbar", "api"];

    /** grant.api as the host said it → { name: { method: fn } }, own keys
     *  and functions only; a bad name or an empty capability is skipped. */
    function apiGrantOf(value, manifest) {
        const out = {};
        if (value == null) return out;
        if (typeof value !== "object" || Array.isArray(value)) {
            console.warn(`[sac.apps] ${manifest.id}: grant.api needs { name: { method: fn } } — nothing granted`);
            return out;
        }
        Object.keys(value).forEach((name) => {
            const cap = value[name];
            if (!/^[A-Za-z_$][\w$]{0,40}$/.test(name) || RESERVED.includes(name)) {
                console.warn(`[sac.apps] ${manifest.id}: grant.api "${name}" is not a free context name — skipped`);
                return;
            }
            if (!cap || typeof cap !== "object") return;
            const methods = {};
            Object.keys(cap).forEach((m) => {
                if (typeof cap[m] === "function" && /^[A-Za-z_$][\w$]{0,60}$/.test(m)) methods[m] = cap[m];
            });
            if (Object.keys(methods).length) out[name] = methods;
        });
        return out;
    }

    /** Runs one granted method; a failure becomes { code, message } — the
     *  host's own short code, else "internal". */
    function apiErrorOf(err) {
        const code = err && typeof err.code === "string" && /^[a-z][a-z0-9-]{0,39}$/.test(err.code)
            ? err.code : "internal";
        const e = appError(code, String((err && err.message) || err || "error").slice(0, 1000));
        e.hostCode = true;   // the bridge passes it through as is
        return e;
    }

    const isFilesProvider = (p) => !!p && typeof p.open === "function" && typeof p.save === "function";
    const scopedFiles = (g) => (g && g.files && typeof g.files === "object" && isFilesProvider(g.files.provider)
        ? g.files.provider : null);

    /** What an app actually receives — context.granted. */
    function grantedFor(manifest, pol) {
        const g = pol.grant || {};
        // files: a per-app provider → "scoped" (truthy, so `if (granted.files)`
        // keeps working); the page's own sac.files → true.
        const scoped = !!scopedFiles(g);
        const oddFiles = !scoped && g.files != null && typeof g.files === "object";
        const cleanList = (list) => (Array.isArray(list) ? list : [])
            .map(originOf).filter((o, i, all) => o && all.indexOf(o) === i);
        if (pol.isolated) {
            return {
                fs:       !!window.sac.fs,
                files:    !window.sac.files ? false : scoped ? "scoped" : g.files === true,
                identity: !window.sac.identity ? false
                    : g.identity === true ? true
                    : g.identity === "pseudonymous" ? "pseudonymous" : false,
                connect:  cleanList(g.connect),
                api:      Object.keys(g.api || {}),
            };
        }
        return {
            fs:       !!window.sac.fs,
            files:    !window.sac.files || g.files === false || oddFiles ? false : scoped ? "scoped" : true,
            identity: !window.sac.identity || g.identity === false ? false
                : g.identity === "pseudonymous" ? "pseudonymous" : true,
            connect:  cleanList(g.connect !== undefined ? g.connect : manifest.connect),
            api:      Object.keys(g.api || {}),
        };
    }

    /* ------------------------------------------------------ integrity --
       SRI strings: "sha256-<base64>" (sha384 / sha512 too; several,
       space-separated, match if any does). */

    const SRI_ALGOS = { sha256: "SHA-256", sha384: "SHA-384", sha512: "SHA-512" };

    function subtle() {
        return (window.crypto && window.crypto.subtle) || null;
    }

    function base64(buf) {
        const bytes = new Uint8Array(buf);
        let s = "";
        for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
        return btoa(s);
    }

    async function sriOf(buf, algo = "sha256") {
        const s = subtle();
        if (!s) return null;
        return `${algo}-${base64(await s.digest(SRI_ALGOS[algo], buf))}`;
    }

    /** true / false, or null when it cannot be told (no crypto.subtle). */
    async function integrityMatches(buf, integrity) {
        if (!subtle()) return null;
        for (const token of String(integrity).trim().split(/\s+/)) {
            const algo = token.slice(0, token.indexOf("-"));
            if (!SRI_ALGOS[algo]) continue;
            // A token may carry "?options" (SRI syntax) — the hash is before it.
            if ((await sriOf(buf, algo)) === token.split("?")[0]) return true;
        }
        return false;
    }

    /**
     * A <script> that failed says nothing about WHY — onerror fires the same
     * for a dead server and for bytes that no longer match the pin. So look
     * again: fetch the entry and hash it. Reachable but different → integrity;
     * unreachable (or unpinned, or matching after all) → network.
     */
    async function classifyLoadFailure(src, integrity) {
        if (!integrity) return appError("network", `Failed to load ${src}`);
        let buf;
        try {
            const res = await fetch(src, { credentials: "omit", cache: "no-store" });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            buf = await res.arrayBuffer();
        } catch (err) {
            return appError("network", `Failed to load ${src} (${err.message})`);
        }
        if ((await integrityMatches(buf, integrity)) === false) {
            return appError("integrity",
                `${src} no longer matches its pinned integrity — the author changed it; update or remove the app`);
        }
        return appError("network", `Failed to load ${src}`);
    }

    /* ------------------------------------------------------------ dirty -- */

    // One listener for the page: while ANY app holds unsaved work, leaving or
    // reloading asks first. The browser words the question; we only arm it.
    function onBeforeUnload(e) {
        if (!dirty.size) return;
        e.preventDefault();
        e.returnValue = "";
    }
    function setDirty(id, flag) {
        const was = dirty.has(id);
        if (flag) dirty.add(id); else dirty.delete(id);
        if (was === !!flag) return;
        if (dirty.size === 1 && flag)  window.addEventListener("beforeunload", onBeforeUnload);
        if (dirty.size === 0 && !flag) window.removeEventListener("beforeunload", onBeforeUnload);
        document.dispatchEvent(new CustomEvent("sac:dirty", {
            detail: { id, dirty: !!flag }, bubbles: true,
        }));
    }

    /* ------------------------------------------------------------- URL ---- */

    function resolveEl(ref) {
        if (!ref) return null;
        return typeof ref === "string" ? document.querySelector(ref) : ref;
    }

    /** replaceState never fires hashchange — the caller has already acted. */
    function replaceHash(hash) {
        window.history.replaceState({}, document.title,
            window.location.pathname + window.location.search + hash);
    }

    /** Scope composition (same rule as sac.router). When scope.js is loaded,
     *  a root-scope hash the runtime builds (`#/<id>/…`) is rewritten into the
     *  active workspace before it is WRITTEN, and a workspace prefix is stripped
     *  before an id is READ — so a view app is reachable, and stays, inside a
     *  scoped workspace. Without scope.js both pass through unchanged. */
    function scopedHash(hash) {
        return (window.sac && sac.scope && sac.scope.hashFor) ? sac.scope.hashFor(hash) : hash;
    }
    function rootHash(hash) {
        return (window.sac && sac.scope && sac.scope.stripPrefix) ? sac.scope.stripPrefix(hash) : hash;
    }

    /** "#/styleguide/components" → { id: "styleguide", route: "components" }.
     *  A "#/scope/SLUG/…" workspace prefix is stripped first. */
    function parseHash() {
        const m = /^#\/([^/?]+)(?:\/([^?]*))?/.exec(rootHash(window.location.hash || ""));
        if (!m) return null;
        return {
            id:    decodeURIComponent(m[1]),
            route: m[2] ? decodeURIComponent(m[2]) : "",
        };
    }

    /* ------------------------------------------------------------ theme --
       One source of truth with <sac-theme-toggle>: the data-theme attribute
       on <html> ("light" / "auto", absent = dark) + the "sac-theme"
       localStorage key ("light" / "auto", removed = dark). */

    const mqLight = window.matchMedia("(prefers-color-scheme: light)");

    function themeFlag() {
        const t = document.documentElement.getAttribute("data-theme");
        return t === "light" || t === "auto" ? t : "dark";
    }

    function themeResolved() {
        const flag = themeFlag();
        if (flag === "auto") return mqLight.matches ? "light" : "dark";
        return flag;
    }

    function themeSet(mode) {
        const flag = mode === "light" || mode === "auto" ? mode : "dark";
        const toggles = document.querySelectorAll("sac-theme-toggle");
        if (toggles.length && customElements.get("sac-theme-toggle")) {
            // The toggle owns the flag: its `theme` setter applies, persists
            // and re-highlights the pill — no second mechanism to race it.
            toggles.forEach((t) => { t.theme = flag; });
            return;
        }
        // No toggle on this page: apply + persist with identical semantics.
        const root = document.documentElement;
        if (flag === "dark") root.removeAttribute("data-theme");
        else root.setAttribute("data-theme", flag);
        if (flag === "dark") localStorage.removeItem("sac-theme");
        else localStorage.setItem("sac-theme", flag);
    }

    const themeSubs = new Set();
    let themeObserver = null;
    let lastResolved = null;

    function notifyTheme() {
        const resolved = themeResolved();
        if (resolved === lastResolved) return;
        lastResolved = resolved;
        themeSubs.forEach((cb) => {
            try { cb(resolved); }
            catch (err) { console.error("[sac.apps] theme onChange callback threw:", err); }
        });
    }

    function themeOnChange(cb) {
        if (!themeObserver) {
            lastResolved = themeResolved();
            themeObserver = new MutationObserver(notifyTheme);
            themeObserver.observe(document.documentElement,
                { attributes: true, attributeFilter: ["data-theme"] });
            mqLight.addEventListener("change", notifyTheme);
        }
        themeSubs.add(cb);
        return function unsubscribe() {
            themeSubs.delete(cb);
            if (!themeSubs.size && themeObserver) {
                themeObserver.disconnect();
                themeObserver = null;
                mqLight.removeEventListener("change", notifyTheme);
            }
        };
    }

    const theme = { get: themeFlag, set: themeSet, onChange: themeOnChange };

    /* ----------------------------------------------- pseudonymous id --
       One person, a different id in every app: SHA-256(salt, user id, app
       id). The salt is the host's secret, so an app cannot recompute or
       reverse it, and two apps comparing notes see two unrelated ids. */

    const SALT_KEY = "sac.apps.identity-salt";
    let sessionSalt = null;

    function identitySalt() {
        if (typeof sac.apps.identitySalt === "string" && sac.apps.identitySalt) return sac.apps.identitySalt;
        if (sessionSalt) return sessionSalt;
        try { sessionSalt = localStorage.getItem(SALT_KEY); } catch (err) { sessionSalt = null; }
        if (!sessionSalt) {
            const b = new Uint8Array(32);
            crypto.getRandomValues(b);
            sessionSalt = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
            // Not persisted (private mode): ids hold for this session only.
            try { localStorage.setItem(SALT_KEY, sessionSalt); } catch (err) { /* session only */ }
        }
        return sessionSalt;
    }

    async function pseudonymOf(userId, appId) {
        const bytes = new TextEncoder().encode(`sac.apps/identity\n${identitySalt()}\n${userId}\n${appId}`);
        const b64 = base64(await subtle().digest("SHA-256", bytes));
        return "p-" + b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    }

    /** { get, onChange } like sac.identity.forApp(), but only { id, name,
     *  avatar } with the id replaced. get() stays synchronous: it answers
     *  null until the first hash is done, then onChange announces — the same
     *  "paint nobody first" contract identity.js documents. */
    function pseudonymousIdentity(appId) {
        const subs = new Set();
        let current = null;
        let seq = 0;
        async function update(raw) {
            const my = ++seq;
            let next = null;
            if (raw && subtle()) {
                next = {
                    id: await pseudonymOf(raw.id == null ? "" : String(raw.id), appId),
                    name: raw.name == null ? null : String(raw.name),
                    avatar: raw.avatar == null ? null : String(raw.avatar),
                };
            } else if (raw && !subtle()) {
                console.warn("[sac.apps] a pseudonymous identity needs crypto.subtle (a secure context) — handing none");
            }
            if (my !== seq) return;
            if (JSON.stringify(next) === JSON.stringify(current)) return;
            current = next;
            subs.forEach((cb) => {
                try { cb(current); }
                catch (err) { console.error("[sac.apps] identity onChange callback threw:", err); }
            });
        }
        const source = sac.identity.forApp();
        source.onChange((p) => { update(p); });
        update(source.get());
        return {
            get: () => (current ? Object.assign({}, current) : null),
            onChange(cb) {
                if (typeof cb !== "function") return () => {};
                subs.add(cb);
                return () => subs.delete(cb);
            },
        };
    }

    /* ---------------------------------------------------------- context -- */

    /* ---------------------------------------------------- open with --- */

    const launchCbs = new Map();   // id → Set of onLaunch callbacks

    /** The FileRefs an app may get: only with a files grant, only refs. */
    function launchFiles(manifest, files) {
        if (!Array.isArray(files) || !files.length) return [];
        if (!grantedFor(manifest, policyOf(manifest.id)).files) return [];
        return files.filter((f) => f && typeof f === "object" && f.file instanceof Blob)
            .map((f) => ({ name: typeof f.name === "string" ? f.name : f.file.name || "", file: f.file, handle: f.handle == null ? null : f.handle }));
    }

    /** Files for an app that is already mounted: over the bridge, or to its
     *  onLaunch callbacks. */
    function deliverLaunch(id, rec, files) {
        const manifest = registry.get(id);
        const list = manifest ? launchFiles(manifest, files) : [];
        if (!list.length) return;
        if (rec && rec.bridge) { rec.bridge.launch(list); return; }
        (launchCbs.get(id) || []).forEach((cb) => {
            try { cb({ files: list.slice() }); }
            catch (err) { console.error(`[sac.apps] ${id} onLaunch handler threw:`, err); }
        });
    }

    /** "Open with": the registered apps whose `opens` matches a file. */
    function openersOf(file) {
        const f = file && typeof file === "object" ? file : {};
        const blob = f.file instanceof Blob ? f.file : (f instanceof Blob ? f : null);
        const name = String(f.name || (blob && blob.name) || "");
        const type = String(f.type || (blob && blob.type) || "").toLowerCase();
        const dot = name.lastIndexOf(".");
        const ext = dot > 0 ? name.slice(dot).toLowerCase() : "";
        const matches = (pat) => {
            const p = pat.toLowerCase();
            if (p.startsWith(".")) return !!ext && p === ext;
            if (!type) return false;
            if (p.endsWith("/*")) return type.startsWith(p.slice(0, -1));
            return p === type;
        };
        return list().filter((m) => Array.isArray(m.opens) && m.opens.some(matches));
    }

    function makeContext(manifest, params, files) {
        const id = manifest.id;
        const pol = policyOf(id);
        const granted = grantedFor(manifest, pol);
        const ctx = {
            appId: id,
            // The app's own manifest, copied — name/icon/description/version and
            // the optional `notices`, so sac.about.open(context.manifest) needs no
            // duplication. Read-only: mutating the copy never touches the registry.
            manifest: Object.assign({}, manifest),
            params: params == null ? new URLSearchParams() : new URLSearchParams(params),
            theme,
            // Scoped storage, when the kit's fs lib is loaded. A host that
            // grants no storage simply does not load it, and apps see null —
            // which is why an app still checks before reaching for it.
            fs: granted.fs ? sac.fs.for(id) : null,
            // Read-only: an app learns who is here, it does not get to rename
            // them everywhere. Null when the host granted no identity.
            identity: granted.identity === "pseudonymous" ? pseudonymousIdentity(id)
                : granted.identity ? sac.identity.forApp() : null,
            // The user's files (kit/js/lib/files.js): Open… / Save as… wherever
            // the host keeps them — the page's provider, or the one the host
            // granted this app alone (grant.files = { provider }). Null when
            // the host loaded no files lib, or granted none.
            files: granted.files === "scoped" ? sac.files.forApp(scopedFiles(pol.grant))
                : granted.files ? sac.files.forApp() : null,
            // The page's language (globals.js): read-only for apps — the
            // host owns the switch, like the theme. Re-render on onChange.
            lang: window.sac.lang ? {
                get: () => sac.lang.get(),
                onChange: (cb) => sac.lang.onChange(cb),
            } : null,
            // "I hold work that is not saved." The host warns before the page
            // goes away and can ask before removing the app; see isDirty().
            setDirty(flag) { setDirty(id, flag); },
            // Leave: a window closes, a view goes home.
            close() { close(id); },
            // "Open with": the files it was opened with, and later ones.
            launch: { files: launchFiles(manifest, files) },
            onLaunch(cb) {
                if (typeof cb !== "function") return () => {};
                if (!launchCbs.has(id)) launchCbs.set(id, new Set());
                launchCbs.get(id).add(cb);
                return () => { const set = launchCbs.get(id); if (set) set.delete(cb); };
            },
            // What the host actually handed over (vs. what the manifest asked).
            granted: Object.assign({}, granted, { connect: granted.connect.slice(), api: granted.api.slice() }),
            isolated: pol.isolated,
        };
        // The host's own capabilities (grant.api): context.<name>.<method>(),
        // always async, errors as { code, message } — what the bridge gives
        // an isolated app too.
        Object.entries(pol.grant.api || {}).forEach(([name, methods]) => {
            const cap = {};
            Object.entries(methods).forEach(([m, fn]) => {
                cap[m] = (...args) => Promise.resolve()
                    .then(() => fn(...args))
                    .catch((err) => { throw apiErrorOf(err); });
            });
            ctx[name] = Object.freeze(cap);
        });

        if (manifest.kind !== "view") {
            ctx.deepLink = {
                set(obj) {
                    const tail = window.location.hash;
                    if (obj == null) {
                        window.history.replaceState({}, document.title,
                            window.location.pathname + tail);
                        return;
                    }
                    const qs = new URLSearchParams();
                    qs.set("app", id);
                    Object.entries(obj).forEach(([k, v]) => {
                        if (v != null) qs.set(k, String(v));
                    });
                    window.history.replaceState({}, document.title,
                        `${window.location.pathname}?${qs}${tail}`);
                }
            };
            return ctx;
        }

        /* ---- view-only capabilities: the stage, the rail, the sub-route --- */

        const rec = views.get(id);
        ctx.route = rec ? rec.route : "";

        ctx.onRoute = (cb) => {
            const r = views.get(id);
            if (typeof cb !== "function" || !r) return () => {};
            r.routeCbs.add(cb);
            return () => r.routeCbs.delete(cb);
        };

        // What the host injects into the app's own chrome. Null when the
        // host declared none — the app then renders no jump and is simply
        // complete on its own.
        ctx.host = hostInfo ? Object.assign({}, hostInfo) : null;

        // The host owns the address space, so an app must never build one:
        // here a route lives under "#/<id>/", standalone it is just "#/".
        // Rail links and anchors go through this.
        ctx.href = (route) => {
            const clean = route == null ? "" : String(route).replace(/^\/+|\/+$/g, "");
            return scopedHash(`#/${id}${clean ? "/" + clean : ""}`);
        };

        ctx.deepLink = {
            set(route) {
                const clean = route == null ? "" : String(route).replace(/^\/+|\/+$/g, "");
                const r = views.get(id);
                if (r) r.route = clean;
                replaceHash(ctx.href(clean));
            }
        };
        return ctx;
    }

    /* --------------------------------------------------------- registry -- */

    /* An app's own failures after it loaded → sac:app-error. One bucket per
       app (10/s), shared by in-realm catches and the isolated bridge. */
    const errorBuckets = new Map();   // id → { tokens, at }
    const cap = (v, n) => (typeof v === "string" ? v.slice(0, n) : undefined);

    function reportError(id, kind, info) {
        const now = performance.now();
        const b = errorBuckets.get(id) || { tokens: 10, at: now };
        b.tokens = Math.min(10, b.tokens + ((now - b.at) / 1000) * 10);
        b.at = now;
        errorBuckets.set(id, b);
        if (b.tokens < 1) return;
        b.tokens -= 1;
        const i = info instanceof Error ? { message: info.message, stack: info.stack, code: info.code } : (info || {});
        const detail = { appId: id, kind, message: cap(String(i.message || ""), 1000) };
        const code = cap(i.code, 40);
        if (code) detail.code = code;
        const src = cap(i.source, 2000);
        if (src) detail.source = src;
        if (Number.isFinite(i.line)) detail.line = i.line;
        if (Number.isFinite(i.column)) detail.column = i.column;
        const stack = cap(i.stack, 4000);
        if (stack) detail.stack = stack;
        document.dispatchEvent(new CustomEvent("sac:app-error", { detail, bubbles: true }));
    }

    function emitChanged(id, type) {
        document.dispatchEvent(new CustomEvent("sac:apps-changed", {
            detail: { id, type },
            bubbles: true,
        }));
    }

    function register(manifest, opts) {
        if (!manifest || !manifest.id) {
            console.warn("[sac.apps] register() needs a manifest with an id");
            return;
        }
        const copy = Object.assign({}, manifest);
        // Light validation of the capability ask: a malformed field is
        // dropped with a warning (the host's own call must not throw at boot).
        const caps = checkCapabilities(copy);
        if (caps.problems.length) {
            console.warn(`[sac.apps] ${manifest.id}: ${caps.problems.join("; ")} — ignored`);
        }
        ["permissions", "connect", "opens"].forEach((k) => {
            if (copy[k] === undefined) return;
            if (caps.clean[k] !== undefined) copy[k] = caps.clean[k];
            else delete copy[k];
        });
        if (copy.isolated !== undefined && typeof copy.isolated !== "boolean") delete copy.isolated;
        // Upsert: Map.set keeps the original position for existing keys, so
        // the order of FIRST registration is the list order.
        registry.set(manifest.id, copy);
        const pol = resolvePolicy(copy, opts, policies.get(manifest.id));
        // A new grant: a files provider factory runs now, once, with the
        // manifest (a kept grant already holds its resolved provider).
        if (opts && opts.grant !== undefined && pol.grant.files !== undefined) {
            pol.grant.files = filesGrantOf(pol.grant.files, copy);
        }
        if (opts && opts.grant !== undefined) pol.grant.api = apiGrantOf(pol.grant.api, copy);
        policies.set(manifest.id, pol);

        // A view is a destination, so it belongs in the nav panel — one
        // registration, both renderings. `nav: false` opts out. In the Ctrl-K
        // palette it lists under "Apps", not "Views": users don't care whether
        // an app is a view or a window (a host lists its window apps under the
        // same group). `palette: false` keeps it out of the palette.
        if (manifest.kind === "view" && manifest.nav !== false && window.sac.router) {
            sac.router.register(`#/${manifest.id}`, null, {
                label: displayName(manifest),
                icon:  manifest.icon || null,
                palette: manifest.palette === false ? false
                    : () => sac.t("palette.group-apps", "Apps"),
            });
        }
        emitChanged(manifest.id, "register");

        // Registered while the address already points at it — an app installed
        // from a link that names it, or a shell registering after init(). No
        // hashchange will fire for a hash that never changed, so look again
        // here or the stage stays empty on the app the URL asked for.
        if (hashBound && manifest.kind === "view" && !activeId) routeFromHash();
    }

    function list() {
        return Array.from(registry.values(), (m) => Object.assign({}, m));
    }

    function get(id) {
        const m = registry.get(id);
        return m ? Object.assign({}, m) : null;
    }

    /* ----------------------------------------------------------- open ---- */

    function displayName(manifest) {
        // Legacy sac.launcher specs used `title` instead of `name`.
        return manifest.name || manifest.title || manifest.id;
    }

    /** whenDefined that gives up: a script that loads fine but defines a
     *  DIFFERENT tag than the manifest names would otherwise hang open()
     *  forever — no toast, and the cached pending promise poisons every later
     *  open of that app. Reject instead, and clear the load cache so a
     *  corrected manifest can retry. */
    function whenDefinedTimeout(tag, src, ms = 8000) {
        return new Promise((resolve, reject) => {
            let settled = false;
            customElements.whenDefined(tag).then(() => {
                if (settled) return;
                settled = true; resolve();
            });
            setTimeout(() => {
                if (settled) return;
                settled = true;
                injected.delete(src);
                reject(new Error(`"${tag}" was never defined after loading ${src} — does the script define this exact tag?`));
            }, ms);
        });
    }

    function ensureDefined(manifest) {
        if (customElements.get(manifest.tag)) return Promise.resolve();
        const pin = typeof manifest.integrity === "string" && manifest.integrity ? manifest.integrity : "";
        if (!injected.has(manifest.src)) {
            injected.set(manifest.src, new Promise((resolve, reject) => {
                const script = document.createElement("script");
                // A pinned install: the BROWSER refuses changed bytes (SRI).
                // CORS mode is what SRI needs; Pages sends ACAO "*".
                if (pin) {
                    script.integrity = pin;
                    script.crossOrigin = "anonymous";
                }
                script.src = manifest.src;
                script.onload = resolve;
                script.onerror = () => {
                    injected.delete(manifest.src); // a later open() may retry
                    script.remove();
                    // onerror cannot tell a dead server from changed bytes —
                    // classifyLoadFailure looks again (err.code).
                    classifyLoadFailure(manifest.src, pin).then(reject);
                };
                document.head.appendChild(script);
            }));
        }
        return injected.get(manifest.src)
            .then(() => whenDefinedTimeout(manifest.tag, manifest.src));
    }

    /** The toast for a failed load — a changed pinned entry says so. Any
     *  other failure (a network hiccup, a server waking up) offers "Try
     *  again", which runs `retry` — the same open once more (the failed
     *  script was dropped from the load cache, so it is fetched anew). */
    function reportLoadFailure(manifest, err, retry) {
        // Some messages carry the prefix already — log it once, and hand the
        // host the bare message.
        const bare = String((err && err.message) || err).replace(/^\[sac\.apps\]\s*/, "");
        console.error(`[sac.apps] ${bare}`);
        // The host hears it too, like a mount or runtime failure — an open
        // from an address (routeFromHash) has no caller to reject to.
        reportError(manifest.id, "load", { message: bare, stack: err && err.stack, code: err && err.code });
        if (typeof sac.toast !== "function") return;
        if (err && err.code === "integrity") {
            sac.toast(`“${displayName(manifest)}” ` + sac.t("apps.changed",
                "has changed since it was installed — update or remove it."), { kind: "error" });
        } else {
            const action = typeof retry === "function"
                ? { label: "Try again", labelKey: "apps.retry",
                    onClick: () => { if (registry.has(manifest.id)) Promise.resolve(retry()).catch(() => {}); } }
                : undefined;
            sac.toast(`“${displayName(manifest)}” ` + sac.t("apps.load-failed", "could not be loaded."),
                { kind: "error", action });
        }
    }

    /**
     * mount() threw (in-realm, or reported over an isolated app's bridge):
     * the window or view would otherwise stay empty. It shows why instead —
     * an .empty-state "“X” couldn't start." with a Close that discards the
     * broken instance, so the next open builds a fresh element and mounts
     * it again. In-realm the app element is swapped for the message (the
     * record keeps the message, so a re-open shows it again until Close);
     * an isolated app's frame is hidden behind it.
     */
    function showStartFailure(id) {
        const manifest = registry.get(id);
        const win = windows.get(id);
        const view = win ? null : views.get(id);
        const rec = win || view;
        if (!manifest || !rec || rec.failed) return;
        rec.failed = true;

        const panel = document.createElement("div");
        panel.className = "empty-state sac-app-failed";
        panel.setAttribute("role", "alert");
        const icon = document.createElement("sac-icon");
        icon.setAttribute("name", "error");
        icon.setAttribute("aria-hidden", "true");
        const title = document.createElement("h3");
        const line = document.createElement("p");
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "btn";
        btn.addEventListener("click", () => discardFailed(id));
        panel.append(icon, title, line, btn);
        const label = () => {
            title.textContent = sac.t("apps.start-failed", "“{name}” couldn't start.")
                .replace("{name}", displayName(manifest));
            line.textContent = sac.t("apps.start-failed-hint",
                "Something went wrong inside the app as it started. Close it and open it again to try once more.");
            btn.textContent = sac.t("apps.close", "Close");
        };
        label();
        if (sac.lang) {
            const off = sac.lang.onChange(() => { if (!panel.isConnected) { off(); return; } label(); });
        }

        // Fills its window or view, centred (.empty-state is a flex column).
        panel.style.height = "100%";
        panel.style.justifyContent = "center";
        if (rec.bridge) {
            // Isolated: the frame stays (the bridge owns it) behind the
            // message — display, not [hidden]: the frame's inline style
            // says display:block.
            if (rec.bridge.frame) rec.bridge.frame.style.display = "none";
            (win ? win.win : view.el).appendChild(panel);
        } else if (win) {
            win.el.replaceWith(panel);
            win.el = panel;
        } else {
            // A view: the message takes the element's place on the stage, in
            // a .sac-app-view shell (that class sets display:block, which
            // would undo .empty-state's flex) — same hidden state, same
            // accent seed.
            const shell = document.createElement("div");
            shell.className = "sac-app-view";
            shell.hidden = view.el.hidden;
            const seed = view.el.style.getPropertyValue("--accent");
            if (seed) shell.style.setProperty("--accent", seed);
            shell.appendChild(panel);
            view.el.replaceWith(shell);
            view.el = shell;
        }
        // Focus on the way out: a window about to open focuses its first
        // control itself (sac-window); one already showing, or a view on
        // stage, gets it here.
        if (win ? win.win.hasAttribute("open") : !view.el.hidden) btn.focus({ preventScroll: true });
    }

    /** Close on a start failure: the broken instance goes (window or view,
     *  its frame with it), so the next open() starts fresh. */
    function discardFailed(id) {
        launchCbs.delete(id);
        setDirty(id, false);
        const win = windows.get(id);
        if (win) {
            windows.delete(id);
            if (win.bridge) win.bridge.dispose(() => win.win.remove());
            else {
                // Let the window close the way it closes, then drop it.
                win.win.close();
                setTimeout(() => win.win.remove(), 400);
            }
            return;
        }
        const view = views.get(id);
        if (!view) return;
        views.delete(id);
        if (view.bridge) view.bridge.dispose(() => view.el.remove());
        else view.el.remove();
        if (activeId === id) leaveView(id);
    }

    /* ------------------------------------------------------------ views -- */

    /** Hand a changed sub-route to the app. Silent when nothing moved, so a
     *  re-activation does not look like navigation. */
    function deliverRoute(id, route) {
        const rec = views.get(id);
        if (!rec) return;
        const next = route || "";
        if (rec.route === next) return;
        rec.route = next;
        rec.routeCbs.forEach((cb) => {
            try { cb(next); }
            catch (err) { console.error(`[sac.apps] ${id} onRoute handler threw:`, err); }
        });
    }

    /** Put one view on stage: hide the others and the home section, restore
     *  the app's rail. The elements stay in the DOM — state survives a swap. */
    function showView(id, route) {
        const rec = views.get(id);
        if (!rec) return;
        views.forEach((r, key) => { r.el.hidden = key !== id; });
        if (homeEl) homeEl.hidden = true;
        activeId = id;

        // mount() runs on the app's FIRST appearance, never while it is still
        // hidden: an app that measures — sizing a canvas, scrolling to its
        // route — gets a real box this way. Still exactly once per element.
        if (!rec.mounted) {
            rec.mounted = true;
            const manifest = registry.get(id);
            if (manifest && rec.bridge) {
                // Isolated: the host keeps this context and answers the
                // frame's calls with it; the guest builds the same shape.
                const ctx = makeContext(manifest, rec.params, rec.files);
                rec.host = ctx.host;
                rec.bridge.mount(ctx);
            } else if (manifest && typeof rec.el.mount === "function") {
                const ctx = makeContext(manifest, rec.params, rec.files);
                // Retain the injected host object so a later host re-declaration
                // can mutate it in place — the app's nav holds it by reference
                // (nav.host = context.host). Null when the host injected none.
                rec.host = ctx.host;
                try { rec.el.mount(ctx); }
                catch (err) {
                    console.error(`[sac.apps] ${id}.mount() threw:`, err);
                    reportError(id, "mount", err);
                    showStartFailure(id);
                }
            }
            rec.params = null;
            rec.files = null;
        }

        deliverRoute(id, route);
        const manifest = registry.get(id);
        if (baseTitle && manifest) document.title = `${displayName(manifest)} · ${baseTitle}`;
        emitChanged(id, "view");
    }

    function goHome() {
        views.forEach((r) => { r.el.hidden = true; });
        activeId = null;
        if (homeEl) homeEl.hidden = false;
        if (baseTitle) document.title = baseTitle;
        emitChanged(null, "home");
    }

    /** @returns Promise<HTMLElement> — the created element, on stage. */
    function openView(manifest, route, params, accent, files) {
        const id = manifest.id;
        if (views.has(id)) {
            // Re-seed on every reopen, not only when a tile passed one — else
            // a tile accent latches forever and an accent-less reopen keeps the
            // stale colour instead of the app's own default.
            const seed = accent || manifest.accent;
            if (seed) views.get(id).el.style.setProperty("--accent", seed);
            else      views.get(id).el.style.removeProperty("--accent");
            const rec = views.get(id);
            // Not mounted yet: the files go into its first context.
            const atMount = !!files && !rec.mounted;
            if (atMount) rec.files = files;
            showView(id, route);
            if (files && !atMount) deliverLaunch(id, rec, files);
            return Promise.resolve(rec.el);
        }
        // Creation is async (the script has to arrive), and the trigger can
        // fire twice for one navigation — a hash-only history move fires
        // hashchange AND popstate. Without this the second call sails past
        // the views.has() check and builds a second, orphaned element.
        if (!viewOpening.has(id)) {
            viewOpening.set(id, createView(manifest, route, params, accent, files)
                .finally(() => viewOpening.delete(id)));
        } else if (files) {
            // A second open while it loads: its files arrive after mount.
            return viewOpening.get(id).then((el) => {
                showView(id, route);
                deliverLaunch(id, views.get(id), files);
                return el;
            });
        }
        return viewOpening.get(id).then((el) => { showView(id, route); return el; });
    }

    async function createView(manifest, route, params, accent, files) {
        const id = manifest.id;
        if (policyOf(id).isolated) return createFrameView(manifest, route, params, accent, files);
        try {
            await ensureDefined(manifest);
        } catch (err) {
            reportLoadFailure(manifest, err, () => open(id, params, { route, accent, files }));
            throw err;
        }
        if (!registry.has(id)) throw new Error(`[sac.apps] app removed while loading: ${id}`);

        const host = viewHost || document.getElementById("app-root");
        if (!host) {
            const msg = `[sac.apps] no view host for "${id}" — pass init({ viewHost })`;
            console.error(msg);
            throw new Error(msg);
        }

        const el = document.createElement(manifest.tag);
        el.className = "sac-app-view";
        el.hidden = true;              // showView() decides when it appears
        // Per-app accent: one seed on the view, everything derived follows.
        // A tile's own accent (opened via a colored launcher tile) wins.
        const seed = accent || manifest.accent;
        if (seed) el.style.setProperty("--accent", seed);

        // The record exists BEFORE mount(): context.route reads through it.
        // showView() does the mounting, once it is visible.
        views.set(id, {
            el, route: route || "", routeCbs: new Set(),
            mounted: false, params, files,
        });
        host.appendChild(el);
        return el;
    }

    /** An isolated view: a wrapper on the stage holding the app's frame. The
     *  wrapper plays the element's part (hidden / --accent / .sac-app-view);
     *  the frame must be in the document to load, so it goes in first. */
    async function createFrameView(manifest, route, params, accent, files) {
        const id = manifest.id;
        const host = viewHost || document.getElementById("app-root");
        if (!host) {
            const msg = `[sac.apps] no view host for "${id}" — pass init({ viewHost })`;
            console.error(msg);
            throw new Error(msg);
        }
        const wrap = document.createElement("div");
        wrap.className = "sac-app-view sac-app-frame";
        wrap.hidden = true;
        const seed = accent || manifest.accent;
        if (seed) wrap.style.setProperty("--accent", seed);
        host.appendChild(wrap);

        let bridge;
        try {
            bridge = await startFrame(manifest, wrap, wrap);
        } catch (err) {
            wrap.remove();
            reportLoadFailure(manifest, err, () => open(id, params, { route, accent, files }));
            throw err;
        }
        if (!registry.has(id)) {
            bridge.dispose();
            wrap.remove();
            throw new Error(`[sac.apps] app removed while loading: ${id}`);
        }
        views.set(id, {
            el: wrap, route: route || "", routeCbs: new Set(),
            mounted: false, params, files, bridge,
        });
        return wrap;
    }

    /* ----------------------------------------------------- isolation --- */

    let bridgeLib = null;

    /** kit/js/lib/app-bridge.js — loaded on demand, so a page that never
     *  hosts an isolated app never pays for it. An isolated app NEVER falls
     *  back to same-realm: without the bridge it does not open. */
    function loadBridgeLib() {
        if (sac.appBridge) return Promise.resolve(sac.appBridge);
        if (!bridgeLib) {
            bridgeLib = new Promise((resolve, reject) => {
                const base = sac.apps.kitUrl || KIT_BASE;
                if (!base) {
                    reject(appError("internal", "[sac.apps] cannot locate the kit for an isolated app — set sac.apps.kitUrl"));
                    return;
                }
                const s = document.createElement("script");
                s.src = new URL("js/lib/app-bridge.js", base).href;
                s.onload = () => (sac.appBridge ? resolve(sac.appBridge)
                    : reject(appError("internal", `[sac.apps] ${s.src} did not install sac.appBridge`)));
                s.onerror = () => reject(appError("network", `Failed to load ${s.src}`));
                document.head.appendChild(s);
            }).catch((err) => { bridgeLib = null; throw err; });
        }
        return bridgeLib;
    }

    /** Create the frame in `container`; resolves once the app's tag is
     *  defined inside it. accentEl carries the app's --accent seed. */
    async function startFrame(manifest, container, accentEl) {
        const lib = await loadBridgeLib();
        const bridge = lib.create({
            manifest,
            container,
            accentEl,
            granted:  grantedFor(manifest, policyOf(manifest.id)),
            api:      policyOf(manifest.id).grant.api || {},
            apiError: apiErrorOf,
            kitUrl:   sac.apps.kitUrl || KIT_BASE,
            frameUrl: sac.apps.frameUrl,
            limits:   sac.apps.limits,
            classify: classifyLoadFailure,
            onError:  (kind, info) => {
                reportError(manifest.id, kind, info);
                if (kind === "mount") showStartFailure(manifest.id);
            },
            appError,
        });
        try {
            await bridge.ready;
        } catch (err) {
            bridge.dispose();
            throw err;
        }
        return bridge;
    }

    function frameOf(id) {
        const rec = windows.get(id) || views.get(id);
        return rec && rec.bridge ? rec.bridge.frame : null;
    }

    /** The hash is the address of the stage. Routes only what we own: an
     *  unknown id belongs to another router (sac.router) and is left alone. */
    function routeFromHash() {
        const parsed = parseHash();
        if (!parsed) {
            if (activeId) goHome();
            return;
        }
        const manifest = registry.get(parsed.id);
        if (!manifest || manifest.kind !== "view") {
            // The address names no view — another page of the shell (a
            // sac.router route beside the views): the view on stage steps
            // aside, kept for its next open.
            if (activeId) goHome();
            return;
        }
        if (activeId === parsed.id) { deliverRoute(parsed.id, parsed.route); return; }
        openView(manifest, parsed.route).catch(() => {});
    }

    /* ------------------------------------------------------------- open --- */

    async function doOpen(id, params, opts) {
        const o = opts || {};
        const manifest = registry.get(id);
        if (!manifest) {
            console.warn(`[sac.apps] unknown app: ${id}`);
            throw new Error(`[sac.apps] unknown app: ${id}`);
        }

        if (manifest.kind === "page") {
            let href = manifest.href;
            const qs = params == null ? "" : new URLSearchParams(params).toString();
            if (qs) href += (href.includes("?") ? "&" : "?") + qs;
            window.location.href = href;
            return new Promise(() => {}); // navigating away — never resolves
        }

        if (manifest.kind === "view") {
            // The address IS the open call, so a plain link does what a click
            // does. pushState (not replace) — back returns where you came from.
            // A tile's route (opts.route) targets a spot inside the app.
            const known = views.get(id);
            const route = o.route != null ? String(o.route) : (known ? known.route : "");
            const target = scopedHash(`#/${id}${route ? "/" + route : ""}`);
            if (window.location.hash !== target) {
                window.history.pushState({}, document.title,
                    window.location.pathname + window.location.search + target);
            }
            return openView(manifest, route, params, o.accent, o.files);
        }

        // kind:"window" (the default — legacy specs carry no kind field).
        const existing = windows.get(id);
        if (existing && existing.win.isConnected) {
            // Re-opening an app the user minimized must show the app, not the
            // collapsed title bar. A maximized window keeps its state.
            // Re-seed on every reopen (see openView) so a tile accent does not
            // latch past the open that carried it.
            const seed = o.accent || manifest.accent;
            if (seed) existing.win.style.setProperty("--accent", seed);
            else      existing.win.style.removeProperty("--accent");
            if (existing.win.hasAttribute("minimized")) existing.win.restore?.();
            existing.win.open();
            if (o.files) deliverLaunch(id, existing, o.files);
            return existing.el;
        }

        if (policyOf(id).isolated) return openFrameWindow(manifest, params, o.accent, o.files);

        try {
            await ensureDefined(manifest);
        } catch (err) {
            reportLoadFailure(manifest, err, () => open(id, params, opts));
            throw err;
        }
        if (!registry.has(id)) throw new Error(`[sac.apps] app removed while loading: ${id}`);

        const win = buildWindow(manifest, o.accent);
        const el = document.createElement(manifest.tag);
        el.style.height = "100%";
        win.appendChild(el);
        document.body.appendChild(win);
        windows.set(id, { win, el });

        // mount(context): exactly once per element lifetime, right after the
        // element lands in the document. Opt-in — apps without mount() work.
        // A throw leaves no empty window: the message takes the app's place.
        if (typeof el.mount === "function") {
            try { el.mount(makeContext(manifest, params, o.files)); }
            catch (err) {
                console.error(`[sac.apps] ${id}.mount() threw:`, err);
                reportError(id, "mount", err);
                showStartFailure(id);
            }
        }

        // Defer open() so the CSS transition starts from the closed state.
        // A timeout, not requestAnimationFrame: a background tab paints no
        // frames, and the window would stay shut until it is looked at.
        setTimeout(() => win.open(), 0);
        return el;
    }

    /** An isolated window: the frame goes into the (still closed) window
     *  first — it must be in the document to load — and the window opens
     *  once the app is defined inside it. Resolves to the <iframe>. */
    async function openFrameWindow(manifest, params, accent, files) {
        const id = manifest.id;
        const win = buildWindow(manifest, accent);
        document.body.appendChild(win);
        let bridge;
        try {
            bridge = await startFrame(manifest, win, win);
        } catch (err) {
            win.remove();
            reportLoadFailure(manifest, err, () => open(id, params, { accent, files }));
            throw err;
        }
        if (!registry.has(id)) {
            bridge.dispose();
            win.remove();
            throw new Error(`[sac.apps] app removed while loading: ${id}`);
        }
        windows.set(id, { win, el: bridge.frame, bridge });
        bridge.mount(makeContext(manifest, params, files));
        setTimeout(() => win.open(), 0);
        return bridge.frame;
    }

    /** A closed <sac-window> sized, placed and seeded for one app. */
    function buildWindow(manifest, accent) {
        const win = document.createElement("sac-window");
        win.id = `sac-app-window-${manifest.id}`;
        win.setAttribute("title",  displayName(manifest));
        win.setAttribute("width",  manifest.width  || "500px");
        win.setAttribute("height", manifest.height || "600px");

        const w = parseInt(manifest.width  || "500", 10);
        const h = parseInt(manifest.height || "600", 10);
        const left = Math.max((window.innerWidth  - w) / 2 + stackOffset, 20);
        const top  = Math.max((window.innerHeight - h) / 2 + stackOffset, 20);
        stackOffset = (stackOffset + 40) % 200;
        win.setAttribute("left", `${left}px`);
        win.setAttribute("top",  `${top}px`);

        // Per-app accent: one seed on the window, everything derived follows.
        // A tile's own accent (opened via a colored launcher tile) wins.
        const seed = accent || manifest.accent;
        if (seed) win.style.setProperty("--accent", seed);

        // Window chrome, the app's choice: controls subset + fixed size.
        if (manifest.controls != null) win.setAttribute("controls", String(manifest.controls));
        if (manifest.resizable === false) win.setAttribute("no-resize", "");
        return win;
    }

    function open(id, params, opts) {
        // Collapse rapid double-opens into one window creation.
        if (opening.has(id)) {
            const files = opts && opts.files;
            // Collapsed into the open in flight — its files still arrive.
            if (!files) return opening.get(id);
            return opening.get(id).then((el) => {
                deliverLaunch(id, windows.get(id) || views.get(id), files);
                return el;
            });
        }
        const p = doOpen(id, params, opts);
        opening.set(id, p);
        p.finally(() => opening.delete(id)).catch(() => {});
        return p;
    }

    /* ------------------------------------------------- close / remove ---- */

    /** A view leaves the stage. Back to the home address only while the
     *  address still names it — once it has moved on (the user went to
     *  another page of the shell), it stays where it is. */
    function leaveView(id) {
        const parsed = parseHash();
        if (parsed && parsed.id === id) replaceHash(scopedHash("#/"));
        goHome();
    }

    function close(id) {
        const manifest = registry.get(id);
        if (manifest && manifest.kind === "view") {
            if (activeId === id) leaveView(id);
            return;
        }
        const rec = windows.get(id);
        if (rec) rec.win.close();
    }

    function unmountEl(id, el) {
        if (typeof el.unmount !== "function") return;
        try { el.unmount(); }
        catch (err) {
            console.error(`[sac.apps] ${id}.unmount() threw:`, err);
            reportError(id, "unmount", err);
        }
    }

    function remove(id) {
        registry.delete(id);
        policies.delete(id);
        launchCbs.delete(id);
        setDirty(id, false);
        const rec = windows.get(id);
        if (rec) {
            // An isolated app hears unmount over the bridge; its frame goes
            // with the window once it answered (or a moment later).
            if (rec.bridge) rec.bridge.dispose(() => rec.win.remove());
            else { unmountEl(id, rec.el); rec.win.remove(); }
            windows.delete(id);
        }
        const view = views.get(id);
        if (view) {
            if (view.bridge) view.bridge.dispose(() => view.el.remove());
            else { unmountEl(id, view.el); view.el.remove(); }
            views.delete(id);
            if (activeId === id) leaveView(id);
        }
        emitChanged(id, "remove");
    }

    function isOpen(id) {
        if (activeId === id) return true;
        const rec = windows.get(id);
        return !!(rec && rec.win.isConnected && rec.win.hasAttribute("open"));
    }

    /** The view currently on stage, or null at home. */
    function active() { return activeId; }

    /* --------------------------------------------------------- install --- */

    /**
     * One repo, one app, one shape — so a desktop can find everything from
     * the repo URL alone:
     *
     *   https://github.com/owner/repo   →  https://owner.github.io/repo/app.json
     *
     * A direct manifest URL, or a folder URL, is taken as given. GitHub Pages
     * answers with CORS "*", so the manifest can be READ before anything is
     * executed — which is the whole point: inspect() is data, add() is the
     * commitment.
     *
     * Not usable as sources, both verified: raw.githubusercontent serves
     * text/plain with nosniff (a browser refuses to run it as a script) and
     * release assets serve octet-stream. Pages is the delivery surface.
     */
    function manifestUrl(input) {
        const raw = String(input || "").trim();
        if (!raw) throw new Error("[sac.apps] no URL");
        const gh = /^(?:https?:\/\/)?(?:www\.)?github\.com\/([^/]+)\/([^/#?]+)/i.exec(raw);
        if (gh) {
            const repo = gh[2].replace(/\.git$/, "");
            return `https://${gh[1].toLowerCase()}.github.io/${repo}/app.json`;
        }
        const url = new URL(raw, window.location.href);
        if (!/\.json$/i.test(url.pathname)) {
            url.pathname = url.pathname.replace(/\/?$/, "/") + "app.json";
        }
        return url.href;
    }

    const REQUIRED = ["id", "name", "kind", "tag", "entry"];

    /**
     * Fetch and validate a manifest. Reads only — nothing is registered, no
     * app code runs. Show the result to the user, then call add().
     * @returns Promise<manifest> with `src` (entry resolved) and `origin`.
     */
    async function inspect(input) {
        const url = manifestUrl(input);
        let data;
        try {
            const res = await fetch(url, { credentials: "omit" });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            data = await res.json();
        } catch (err) {
            throw new Error(`[sac.apps] no app manifest at ${url} (${err.message})`);
        }
        const missing = REQUIRED.filter((k) => !data[k]);
        if (missing.length) {
            throw new Error(`[sac.apps] ${url} is not an app manifest — missing ${missing.join(", ")}`);
        }
        if (!/-/.test(data.tag)) {
            throw new Error(`[sac.apps] "${data.tag}" is not a valid custom element name`);
        }
        const caps = checkCapabilities(data);
        if (caps.problems.length) {
            throw new Error(`[sac.apps] ${url} is not a valid app manifest — ${caps.problems.join("; ")}`);
        }
        const src = new URL(data.entry, url).href;
        const out = Object.assign({}, data, caps.clean, {
            src,
            origin: new URL(url).origin,
            manifestUrl: url,
            entryIntegrity: await entryIntegrityOf(src),
        });
        // The pin is the HOST's record of what it installed, never the
        // author's claim — a manifest cannot pre-pin itself.
        delete out.integrity;
        return out;
    }

    /** SHA-256 of the entry's bytes, SRI format — what a pinned install
     *  keeps. null when the entry cannot be read here (no CORS, offline) or
     *  crypto.subtle is missing (an insecure context): inspecting stays
     *  possible, the install is just unpinned. */
    async function entryIntegrityOf(src) {
        if (!subtle()) return null;
        try {
            const res = await fetch(src, { credentials: "omit" });
            if (!res.ok) return null;
            return await sriOf(await res.arrayBuffer());
        } catch (err) {
            return null;
        }
    }

    /**
     * Install: register an inspected manifest (or inspect a URL first).
     * Registering does not run the app — its script is injected on first open,
     * exactly like an app the shell declared itself.
     * @returns Promise<manifest>
     */
    async function add(input, opts) {
        const o = opts || {};
        const manifest = typeof input === "string" ? await inspect(input) : Object.assign({}, input);
        // The pin: a hash string wins; true pins to what inspect() hashed;
        // false drops it. Unsaid, an isolated install pins itself and a
        // same-realm one keeps whatever it carried (today: nothing).
        const prev = policies.get(manifest.id);
        const isolated = resolvePolicy(manifest, o, prev).isolated;
        let pin = manifest.integrity || null;
        if (typeof o.integrity === "string" && o.integrity) pin = o.integrity;
        else if (o.integrity === true) pin = manifest.entryIntegrity || null;
        else if (o.integrity === false) pin = null;
        else if (!pin && isolated) pin = manifest.entryIntegrity || null;
        if (pin) manifest.integrity = pin;
        else delete manifest.integrity;
        register(manifest, { isolated: o.isolated, grant: o.grant });
        return manifest;
    }

    /* ------------------------------------------------------------ init --- */

    /**
     * A host that re-declares (init({host}) again — the signed-in user was
     * renamed, say) must reach the views it already mounted. It cannot touch an
     * app's nav (the hull rule holds), but the app handed context.host to its
     * nav BY REFERENCE (nav.host = context.host), so mutating that same object
     * in place refreshes the nav's data; a sac:host-changed event then tells
     * every sac-nav to re-read it. A view mounted while the host injected
     * nothing (host was null) has no object to mutate and cannot be reached this
     * way — a host that ever injects should inject from boot.
     */
    function syncMountedHosts() {
        views.forEach((rec) => {
            const h = rec.host;
            if (!h) return;
            Object.keys(h).forEach((k) => { if (!(k in hostInfo)) delete h[k]; });
            Object.assign(h, hostInfo);
        });
        document.dispatchEvent(new CustomEvent("sac:host-changed"));
    }

    function init(options) {
        const opts = options || {};
        // The stage and the home section. Defaults keep the plain SPA case
        // working with no options at all.
        viewHost = resolveEl(opts.viewHost) || viewHost || document.getElementById("app-root");
        if (opts.home) homeEl = resolveEl(opts.home);
        // What this host injects into every view's own chrome (context.host):
        // its name, the jump-home address, and optionally its suite nav and
        // toolbar controls (see the header).
        if (opts.host) {
            hostInfo = Object.assign({}, opts.host);
            // Re-declaration on a running host (e.g. the signed-in user was
            // renamed): reach the views already mounted with the old snapshot.
            if (inited) syncMountedHosts();
        }
        if (!baseTitle) baseTitle = document.title;

        if (!inited) inited = true;
        // init({ tiles: false }): no click delegation — a shell that uses
        // [data-app] for something of its own (or opens apps only from code)
        // keeps its clicks. A later init() without it binds it then.
        if (!tilesBound && opts.tiles !== false) {
            tilesBound = true;
            // Tiles: [data-app="<id>"] opens that app. Delegated, so tiles
            // rendered after init() work too. [data-overlay] is the legacy
            // spelling — same behavior. A hand-written tile is a full tile:
            // its --accent (or data-accent) seeds the app it opens — tile
            // color = app highlight — and data-route targets a view route.
            document.addEventListener("click", (e) => {
                const tile = e.target.closest("[data-app], [data-overlay]");
                if (!tile) return;
                // A modified click on an anchor tile is the user asking for a
                // new tab / window / download — let the browser honor it
                // instead of hijacking it into same-tab navigation.
                if (e.defaultPrevented || e.button !== 0 ||
                    e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
                e.preventDefault();
                const accent = tile.dataset.accent
                    || (tile.style && tile.style.getPropertyValue("--accent").trim())
                    || undefined;
                // A tile is an entry point: with no data-route it opens the app
                // at its ROOT (route ""), matching the href it advertises —
                // never the sub-route the view happened to be left on. (A
                // programmatic open(id) with no route still resumes; only this
                // explicit tile click is pinned to the root.)
                open(tile.dataset.app || tile.dataset.overlay, undefined,
                     { accent, route: tile.dataset.route || "" })
                    .catch(() => {}); // already logged/toasted by open()
            });
        }

        // Deep link: ?app=<id> auto-opens (legacy: ?tool=<id>), remaining
        // params travel to the app via context.params. The URL is cleaned
        // synchronously, BEFORE the async open lands — so an app that writes
        // its own deep link during mount() is not overwritten afterwards.
        const query = new URLSearchParams(window.location.search);
        const id = query.get("app") || query.get("tool");
        if (id && registry.has(id)) {
            query.delete("app");
            query.delete("tool");
            open(id, query).catch(() => {});
            window.history.replaceState({}, document.title,
                window.location.pathname + window.location.hash);
        }

        // The hash addresses the stage. Bound once; popstate as well as
        // hashchange, because open() pushes its address itself.
        if (!hashBound) {
            hashBound = true;
            window.addEventListener("hashchange", routeFromHash);
            window.addEventListener("popstate", routeFromHash);
        }
        routeFromHash();
    }

    sac.apps = {
        register, list, get, open, close, remove, isOpen, active, init,
        isDirty: (id) => dirty.has(id),
        inspect, add,
        theme,   // the one theme source; sac.app borrows it when standalone
        /** What the host decided for one app: { isolated, granted }. */
        policy(id) {
            const m = registry.get(id);
            if (!m) return null;
            const pol = policyOf(id);
            return { isolated: pol.isolated, granted: grantedFor(m, pol) };
        },
        frameOf,
        opening: openersOf,
        // Isolation settings (see the header): the harness a host serves
        // itself, the kit the frame loads, the bridge's limits.
        frameUrl: null,
        kitUrl:   null,
        limits:   { timeout: 30000, maxBytes: 64 * 1024 * 1024, rate: 200 },
        identitySalt: null,
    };

    /**
     * @deprecated sac.launcher is the pre-apps name of this API and forwards
     * to sac.apps unchanged. Legacy specs keep working: no `kind` means
     * "window", and `title` is honored as the display name. Kept so existing
     * hub pages don't break — removal is a future major.
     */
    sac.launcher = {
        register(spec) { register(spec); },
        open(id) { open(id).catch(() => {}); }, // legacy callers ignore the promise
        init() { init(); },
    };
})();
