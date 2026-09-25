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
 *       badge:       "NEW",                   // optional — short string, rendered by
 *                                             // <sac-launcher> as the tile's corner pill
 *       tile:        "wide",                  // optional tile footprint in the launcher
 *                                             // grid: "medium" (default, omit-able) |
 *                                             // "wide" (2 columns) | "large" (2 columns
 *                                             // × 2 rows); unknown values fall back to
 *                                             // medium silently
 *       tiles: [                              // optional — MULTIPLE launcher tiles for
 *           { id: "today",                    // one app (complex apps deploy several
 *             name: "Today",                  // entry points into a desktop). When set,
 *             icon: "clock",                  // these REPLACE the app's default tile.
 *             description: "…",               // Each entry may override name/icon/
 *             route: "today",                 // description/badge/tile/accent and adds:
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
 *   register(manifest)   upsert by id (re-register replaces; first
 *                        registration fixes the list order). Emits
 *                        "sac:apps-changed" on document.
 *   list()               → array of manifest copies, registration order
 *   get(id)              → manifest copy or null
 *   open(id, params?, opts?) → Promise<HTMLElement> resolving to the app
 *                        element.
 *                        params: URLSearchParams | object | string, handed to
 *                        the app via context.params.
 *                        opts { route, accent }: what a launcher tile carries —
 *                        route opens a view at "#/<id>/<route>", accent seeds
 *                        the app's --accent (tile color = app highlight).
 *                        kind:"page" navigates
 *                        (params appended) and the promise never resolves.
 *                        kind:"window" injects src once (keyed by src), awaits
 *                        customElements.whenDefined(tag) and shows the app in
 *                        a centered, slightly cascaded <sac-window> that stays
 *                        in the DOM and is re-open()ed on later calls.
 *                        Rejects on script load failure (console.error +
 *                        sac.toast if available).
                        kind:"view" does the same injection, then puts the
 *                        element on the shell's stage and sets the hash to
 *                        "#/<id>" — the address IS the open call, so a link
 *                        works as well as a click.
 *   close(id)            window: closes it (element + window stay in the DOM).
 *                        view: leaves the stage, back to the home section.
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
 *           kind,                  // space when it installed one). Null when
 *       },                         // the host loaded no files lib
 *       lang: {                    // the page's language (globals.js) —
 *           get(),                 // "en", "de", … READ-ONLY: the host owns
 *           onChange(cb),          // the switch, like the theme; re-render
 *       },                         // your strings (sac.t) in the callback
 *       setDirty(flag),            // true = unsaved work: leaving the page asks
 *                                  // first, sac.apps.isDirty(id) tells a host,
 *                                  // document gets sac:dirty { id, dirty }.
 *                                  // Closing a window loses nothing (it stays
 *                                  // in the DOM) and so never asks.
 *   }
 *
 * Events:
 *   sac:apps-changed (on document, bubbles) — detail { id, type }. The registry
 *   types are "register" and "remove" (what registry-driven UI like
 *   <sac-launcher> refreshes on). The stage also emits "view" (id = the app now
 *   on stage) and "home" (id = null, back at "#/"), so a host can track which
 *   view is showing.
 */
(function () {
    if (!window.sac) { console.warn("[sac.apps] globals.js must load first — app runtime unavailable."); return; }
    if (sac.apps) return;   // idempotent

    const registry = new Map();   // id  → manifest (internal copy)
    const windows  = new Map();   // id  → { win, el }
    const views    = new Map();   // id  → { el, route, routeCbs }
    const injected = new Map();   // src → Promise (each script injected once)
    const opening  = new Map();   // id  → in-flight open() Promise
    const viewOpening = new Map();// id  → in-flight view creation Promise
    let stackOffset = 0;          // cascade multiple open windows slightly
    let inited = false;
    let hashBound = false;
    let viewHost  = null;         // element the view elements live in
    let homeEl    = null;         // shown while no view is on stage ("#/")
    let activeId  = null;         // the view currently on stage
    let baseTitle = "";           // document.title at init, restored at home
    let hostInfo  = null;         // { name, icon, href } injected as context.host
    const dirty   = new Set();    // ids holding unsaved work (context.setDirty)

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

    /* ---------------------------------------------------------- context -- */

    function makeContext(manifest, params) {
        const id = manifest.id;
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
            fs: window.sac.fs ? sac.fs.for(id) : null,
            // Read-only: an app learns who is here, it does not get to rename
            // them everywhere. Null when the host granted no identity.
            identity: window.sac.identity ? sac.identity.forApp() : null,
            // The user's files (kit/js/lib/files.js): Open… / Save as… wherever
            // the host keeps them. Null when the host loaded no files lib.
            files: window.sac.files ? sac.files.forApp() : null,
            // The page's language (globals.js): read-only for apps — the
            // host owns the switch, like the theme. Re-render on onChange.
            lang: window.sac.lang ? {
                get: () => sac.lang.get(),
                onChange: (cb) => sac.lang.onChange(cb),
            } : null,
            // "I hold work that is not saved." The host warns before the page
            // goes away and can ask before removing the app; see isDirty().
            setDirty(flag) { setDirty(id, flag); },
        };

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

    function emitChanged(id, type) {
        document.dispatchEvent(new CustomEvent("sac:apps-changed", {
            detail: { id, type },
            bubbles: true,
        }));
    }

    function register(manifest) {
        if (!manifest || !manifest.id) {
            console.warn("[sac.apps] register() needs a manifest with an id");
            return;
        }
        // Upsert: Map.set keeps the original position for existing keys, so
        // the order of FIRST registration is the list order.
        registry.set(manifest.id, Object.assign({}, manifest));

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
        if (!injected.has(manifest.src)) {
            injected.set(manifest.src, new Promise((resolve, reject) => {
                const script = document.createElement("script");
                script.src = manifest.src;
                script.onload = resolve;
                script.onerror = () => {
                    injected.delete(manifest.src); // a later open() may retry
                    reject(new Error(`Failed to load ${manifest.src}`));
                };
                document.head.appendChild(script);
            }));
        }
        return injected.get(manifest.src)
            .then(() => whenDefinedTimeout(manifest.tag, manifest.src));
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
            if (manifest && typeof rec.el.mount === "function") {
                const ctx = makeContext(manifest, rec.params);
                // Retain the injected host object so a later host re-declaration
                // can mutate it in place — the app's nav holds it by reference
                // (nav.host = context.host). Null when the host injected none.
                rec.host = ctx.host;
                try { rec.el.mount(ctx); }
                catch (err) { console.error(`[sac.apps] ${id}.mount() threw:`, err); }
            }
            rec.params = null;
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
    function openView(manifest, route, params, accent) {
        const id = manifest.id;
        if (views.has(id)) {
            // Re-seed on every reopen, not only when a tile passed one — else
            // a tile accent latches forever and an accent-less reopen keeps the
            // stale colour instead of the app's own default.
            const seed = accent || manifest.accent;
            if (seed) views.get(id).el.style.setProperty("--accent", seed);
            else      views.get(id).el.style.removeProperty("--accent");
            showView(id, route);
            return Promise.resolve(views.get(id).el);
        }
        // Creation is async (the script has to arrive), and the trigger can
        // fire twice for one navigation — a hash-only history move fires
        // hashchange AND popstate. Without this the second call sails past
        // the views.has() check and builds a second, orphaned element.
        if (!viewOpening.has(id)) {
            viewOpening.set(id, createView(manifest, route, params, accent)
                .finally(() => viewOpening.delete(id)));
        }
        return viewOpening.get(id).then((el) => { showView(id, route); return el; });
    }

    async function createView(manifest, route, params, accent) {
        const id = manifest.id;
        try {
            await ensureDefined(manifest);
        } catch (err) {
            console.error(`[sac.apps] ${err.message}`);
            if (typeof sac.toast === "function") {
                sac.toast(`Could not load "${displayName(manifest)}".`, { kind: "error" });
            }
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
            mounted: false, params,
        });
        host.appendChild(el);
        return el;
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
        if (!manifest || manifest.kind !== "view") return;
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
            return openView(manifest, route, params, o.accent);
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
            return existing.el;
        }

        try {
            await ensureDefined(manifest);
        } catch (err) {
            console.error(`[sac.apps] ${err.message}`);
            if (typeof sac.toast === "function") {
                sac.toast(`Could not load "${displayName(manifest)}".`, { kind: "error" });
            }
            throw err;
        }
        if (!registry.has(id)) throw new Error(`[sac.apps] app removed while loading: ${id}`);

        const win = document.createElement("sac-window");
        win.id = `sac-app-window-${id}`;
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
        const seed = o.accent || manifest.accent;
        if (seed) win.style.setProperty("--accent", seed);

        // Window chrome, the app's choice: controls subset + fixed size.
        if (manifest.controls != null) win.setAttribute("controls", String(manifest.controls));
        if (manifest.resizable === false) win.setAttribute("no-resize", "");

        const el = document.createElement(manifest.tag);
        el.style.height = "100%";
        win.appendChild(el);
        document.body.appendChild(win);
        windows.set(id, { win, el });

        // mount(context): exactly once per element lifetime, right after the
        // element lands in the document. Opt-in — apps without mount() work.
        if (typeof el.mount === "function") {
            try { el.mount(makeContext(manifest, params)); }
            catch (err) { console.error(`[sac.apps] ${id}.mount() threw:`, err); }
        }

        // Defer open() so the CSS transition starts from the closed state.
        // A timeout, not requestAnimationFrame: a background tab paints no
        // frames, and the window would stay shut until it is looked at.
        setTimeout(() => win.open(), 0);
        return el;
    }

    function open(id, params, opts) {
        // Collapse rapid double-opens into one window creation.
        if (opening.has(id)) return opening.get(id);
        const p = doOpen(id, params, opts);
        opening.set(id, p);
        p.finally(() => opening.delete(id)).catch(() => {});
        return p;
    }

    /* ------------------------------------------------- close / remove ---- */

    function close(id) {
        const manifest = registry.get(id);
        if (manifest && manifest.kind === "view") {
            if (activeId === id) { replaceHash(scopedHash("#/")); goHome(); }
            return;
        }
        const rec = windows.get(id);
        if (rec) rec.win.close();
    }

    function unmountEl(id, el) {
        if (typeof el.unmount !== "function") return;
        try { el.unmount(); }
        catch (err) { console.error(`[sac.apps] ${id}.unmount() threw:`, err); }
    }

    function remove(id) {
        registry.delete(id);
        setDirty(id, false);
        const rec = windows.get(id);
        if (rec) {
            unmountEl(id, rec.el);
            rec.win.remove();
            windows.delete(id);
        }
        const view = views.get(id);
        if (view) {
            unmountEl(id, view.el);
            view.el.remove();
            views.delete(id);
            if (activeId === id) { replaceHash(scopedHash("#/")); goHome(); }
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
        return Object.assign({}, data, {
            src:    new URL(data.entry, url).href,
            origin: new URL(url).origin,
            manifestUrl: url,
        });
    }

    /**
     * Install: register an inspected manifest (or inspect a URL first).
     * Registering does not run the app — its script is injected on first open,
     * exactly like an app the shell declared itself.
     * @returns Promise<manifest>
     */
    async function add(input) {
        const manifest = typeof input === "string" ? await inspect(input) : input;
        register(manifest);
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

        if (!inited) {
            inited = true;
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
