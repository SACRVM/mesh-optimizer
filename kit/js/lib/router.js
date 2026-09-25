/**
 * SACRVM APPKIT — hash-based SPA router (+ multi-page nav registry).
 *
 * SPA use:
 *   sac.router.register("#/notes", "my-notes-view", { label: "Notes", icon: "note" });
 *   sac.router.mount("#app-root");
 *   // On hashchange the mount point's innerHTML is swapped to the matching
 *   // tag — views are custom elements; connectedCallback is the lifecycle
 *   // hook and disconnectedCallback is where listeners get removed.
 *
 * Multi-page use:
 *   Register plain hrefs and never call mount(); <sac-nav> renders the
 *   entries as ordinary links and derives the active one from
 *   location.pathname:
 *   sac.router.register("/svg-to-world/", null, { label: "SVG to World", icon: "shapes" });
 *
 * Scoped workspaces: when scope.js is loaded, a `#/scope/SLUG/...` prefix is
 * stripped before route lookup, so one registration serves both the root and
 * any scoped workspace (see scope.js).
 */
(function () {
    if (!window.sac) { console.warn("[sac.router] globals.js must load first — router unavailable."); return; }
    const routes = new Map();    // "#/notes" → { tag, label, icon }
    let rootElement = null;

    function currentHash() {
        return window.location.hash || "#/";
    }

    // With scope.js loaded, "#/scope/SLUG/notes" → "#/notes"; otherwise the
    // hash passes through unchanged.
    function resourceHash() {
        const hash = currentHash();
        return sac.scope ? sac.scope.stripPrefix(hash) : hash;
    }

    function render() {
        if (!rootElement) return;
        const key = resourceHash();
        const entry = routes.get(key) || routes.get("#/");
        if (!entry || !entry.tag) { rootElement.innerHTML = ""; return; }
        rootElement.innerHTML = `<${entry.tag}></${entry.tag}>`;
        // A view swap is a page change — don't inherit the old view's scroll.
        window.scrollTo(0, 0);
    }

    sac.router = {
        register(hash, tagName, options = {}) {
            routes.set(hash, {
                tag: tagName || null,
                label: options.label || tagName || hash,
                icon:  options.icon  || null
            });
            // Notify listeners (e.g. <sac-nav>) that the route table changed.
            // Needed because nav components are instantiated before view
            // scripts register, so their first render sees an empty map.
            window.dispatchEvent(new CustomEvent("sac:route-registered", {
                detail: { hash, tag: tagName }
            }));
            if (rootElement && resourceHash() === hash) render();
        },
        routes() {
            return Array.from(routes.entries()).map(([hash, info]) => ({ hash, ...info }));
        },
        current() {
            return currentHash();
        },
        // Returns the root-scope hash of the currently-active view, with any
        // scope prefix stripped. Useful for "am I on #/notes?" checks that
        // should succeed in every scope.
        currentResource() {
            return resourceHash();
        },
        navigate(hash) {
            window.location.hash = hash;
        },
        mount(selector) {
            rootElement = document.querySelector(selector);
            if (!rootElement) {
                console.error(`[sac.router] mount: no element matches ${selector}`);
                return;
            }
            window.addEventListener("hashchange", render);
            render();
        }
    };
})();
