/**
 * SACRVM APPKIT — scoped workspace, derived from the URL hash.
 *
 *   #/notes                 → { type: "root" }
 *   #/scope/SLUG/notes      → { type: "scoped", slug: "SLUG" }
 *
 * The URL is authoritative — two tabs can hold different scopes, a reload
 * preserves state, and deep-linking works (URL-first state rule). A scope
 * (a) rewrites data-layer paths via endpoint(), (b) rewrites navigation
 * hrefs via hashFor() so links stay inside the active scope, and (c) should
 * tint its switcher UI with --accent-warm so operating on shared state is
 * visually unmissable.
 *
 * The URL prefix segment defaults to "scope"; apps rename it via
 * sac.scope.configure({ prefix: "space" }).
 *
 * Subscribers listen for `sac:scope-changed` (emitted on every hashchange)
 * so they can re-fetch without re-parsing the URL themselves.
 */
(function () {
    if (!window.sac) { console.warn("[sac.scope] globals.js must load first — scope unavailable."); return; }
    let prefix = "scope";

    function pattern() {
        // #/<prefix>/SLUG or #/<prefix>/SLUG/anything — slug is any chars
        // except slash. Root-scope paths fall through.
        return new RegExp(`^#\\/${prefix}\\/([^\\/]+)(\\/.*)?$`);
    }

    function parse() {
        const hash = window.location.hash || "#/";
        const m = hash.match(pattern());
        if (m && m[1]) return { type: "scoped", slug: decodeURIComponent(m[1]) };
        return { type: "root" };
    }

    /** "#/scope/SLUG/notes" → "#/notes"; anything else passes through. */
    function stripPrefix(hash) {
        const m = (hash || "#/").match(pattern());
        if (m) return "#" + (m[2] || "/");
        return hash || "#/";
    }

    /**
     * Prefixes a resource path with `/<prefix>/SLUG` when the current scope
     * is active. `path` is the root-scope path (leading slash), e.g.
     * "/notes". The caller never has to know which scope is active.
     */
    function endpoint(path) {
        const s = parse();
        if (s.type === "scoped") {
            return `/${prefix}/${encodeURIComponent(s.slug)}${path}`;
        }
        return path;
    }

    /**
     * Builds a hash path in the current scope. "#/notes" stays unchanged at
     * root, and becomes "#/scope/SLUG/notes" inside a scope. Pass "#/" to
     * get back to the hub in the current scope.
     */
    function hashFor(rootPath) {
        const s = parse();
        if (!rootPath.startsWith("#/")) rootPath = "#/" + rootPath.replace(/^#?\/?/, "");
        if (s.type === "scoped") {
            const suffix = rootPath.slice(1); // drop leading "#"
            return `#/${prefix}/${encodeURIComponent(s.slug)}${suffix === "/" ? "" : suffix}`;
        }
        return rootPath;
    }

    /**
     * Switches the active scope, keeping the current view. From "#/notes",
     * set({type:"scoped", slug:"team"}) lands on "#/scope/team/notes";
     * set({type:"root"}) strips the prefix again.
     */
    function set(target) {
        const hash = window.location.hash || "#/";
        const path = hash.startsWith("#") ? hash.slice(1) : hash;
        const base = path.replace(new RegExp(`^\\/${prefix}\\/[^\\/]+`), "") || "/";
        const next = target.type === "scoped"
            ? `#/${prefix}/${encodeURIComponent(target.slug)}${base === "/" ? "" : base}`
            : `#${base}`;
        if (next !== hash) window.location.hash = next;
        else emit(); // force emit even on no-op so subscribers can re-render
    }

    function emit() {
        window.dispatchEvent(new CustomEvent("sac:scope-changed", { detail: parse() }));
    }

    window.addEventListener("hashchange", emit);

    sac.scope = {
        configure({ prefix: p } = {}) { if (p) prefix = p; },
        get: parse,
        stripPrefix,
        endpoint,
        hashFor,
        set
    };
})();
