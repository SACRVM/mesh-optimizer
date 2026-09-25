/**
 * <sac-nav brand="MY APP" brand-icon="cube" brand-href="#/" app-name="EDITOR">
 *   <div slot="context">…persistent controls (survive toolbar repaints)…</div>
 *   <div slot="toolbar" class="toolbar">…per-page buttons…</div>
 * </sac-nav>
 *
 * Fixed 50px glassmorphic ribbon + 300px slide-out panel. NOTHING here is
 * hardcoded to an app: the panel nav list is computed from
 * sac.router.routes() and re-rendered whenever a route registers
 * (sac:route-registered), the hash changes, or the scope changes
 * (sac:scope-changed). Works for hash-SPA routes AND plain multi-page hrefs
 * (register them with tagName = null; active state then matches
 * location.pathname).
 *
 * Attributes:
 *   brand      — brand text left of the separator (optional).
 *   brand-icon — sac.icons name rendered before the brand text (optional).
 *   brand-href — where the brand links to (default "#/", scope-aware).
 *   app-name   — accent-colored text after the brand (spacing separates the
 *                segments; no divider glyph — two icons plus a dot was noise).
 *   compact-title — the app's name as the phone ribbon shows it (see
 *                RESPONSIVE). Absent = brand for a hosted app, else app-name,
 *                else brand. Set it where app-name is no name (a version).
 *   host-nav   — "always" (default) | "wide". "wide" drops the host group
 *                (Home + the suite's app list) from the burger on compact —
 *                for a suite whose dashboard is the phone's main level; the
 *                ⌂ in the ribbon (shown while the menu is open) leads back to it. The app's own
 *                sections then render as the panel's flat list.
 *   sections-nav — "always" (default) | "wide". "wide" drops the app's own
 *                `sections` from the burger on compact — for an app whose
 *                rail already lists them, so the phone drawer holds ONE
 *                list with ONE scroll instead of the same entries twice.
 *   rail       — which rail the burger opens on compact (see RESPONSIVE):
 *                a CSS selector, or "none" to opt out. Absent = the first
 *                <sac-sidebar> / .sidebar inside a .main-layout next to the nav.
 *   host-href  — the HOST'S jump-home address. Attribute form of the jump
 *   host-label   only; a hosted app normally sets the `host` PROPERTY instead
 *   host-icon    (see below), which carries the whole injection. Observed, so
 *                setting them in mount() works. Standalone they are absent
 *                and nothing renders.
 *
 * Property:
 *   host — THE injection point of the app contract. A hosted app assigns
 *          context.host here, one line in mount():  nav.host = context.host
 *          Shape: { name, icon, href,          → the HOST jump-home
 *                                                segment, rendered with the
 *                                                brand recipe (one title-bar
 *                                                style everywhere; the app's
 *                                                own segment goes accent)
 *                   nav:     [{label, href, icon?}],       → a labeled host
 *                            group at the top of the burger panel (the
 *                            suite's cross-app navigation). An href of
 *                            `?app=<id>` for a registered app opens that
 *                            window IN PLACE on a plain click (sac.apps.open);
 *                            a modified/middle click keeps the deep link (new
 *                            tab). Lets a host list window apps, not just routes.
 *                   toolbar: [{icon | avatar:{name, src?},
 *                              label?, title?, href? | onClick?}] }
 *                            → host controls at the right end of the ribbon
 *                            (a signed-in user, a suite-wide action, …).
 *                            An entry wears EITHER an `icon` (sac.icons name)
 *                            or an `avatar` ({name, src?} → a <sac-avatar>, so
 *                            a signed-in user looks like one); `label` may
 *                            accompany either. Rendered as light-DOM
 *                            .nav-icon-btn elements — the same ui.css recipe
 *                            as the app's own ribbon buttons, so the two
 *                            always look alike.
 *          Everything is rendered by the APP'S OWN nav — the host supplies
 *          data, it never paints. null/absent = standalone, nothing renders.
 *
 *   sections — the app's OWN sub-navigation, OPTIONAL: [{label, href, icon?}].
 *          Entirely the app's choice — a simple app sets nothing and its
 *          suite entry stays a plain point. When set AND a host group is
 *          present, the entries nest indented under the app's own entry in
 *          the burger panel (found by address match) — one tree: the suite,
 *          with the running app unfolded. Standalone the same entries render
 *          as the panel's flat list.
 *
 * Methods:
 *   open() / close() / toggle() — what the burger does (the drawer on
 *          compact with a rail, else the panel). open() is a no-op when
 *          there is nothing to open.
 *
 * Events:
 *   sac:nav-open / sac:nav-close — detail { drawer } — the burger's panel
 *          and/or rail drawer came out / went away. Bubbles + composed.
 *
 * Slots:
 *   panel   — the app's OWN burger-panel content, rendered first, above the
 *             navigation groups: filters, account, settings — the burger is
 *             the app's, not only a global navigation. Its presence alone
 *             makes the burger appear. A tap on an a[href] or a
 *             [data-nav-close] inside closes the panel; other controls
 *             leave it open. Use rail="none" to keep the rail out of it.
 *   context — persistent controls (e.g. a scope switcher).
 *   toolbar — right-aligned content inside the ribbon. This is the OWNER'S
 *             chrome: the page or host that writes the <sac-nav> markup puts
 *             its own buttons here. There is no projection surface — an app
 *             draws its own toolbar in its own area; a host injects context
 *             into the app, it does not offer the app its hull.
 *
 * Note: when host and app views share one page (the launcher pattern), the
 * shared router lists the host's destinations too — routes whose hash
 * matches a host.nav entry are dropped from the app's own group, so
 * nothing is listed twice.
 *
 * RESPONSIVE (compact = ≤768px wide, or a short touch screen such as a phone
 * held sideways — the query in ui.css §15; everything else is unchanged):
 *   - Ribbon, menu closed: burger + the app's NAME as text (compact-title)
 *     + the app's own controls right-aligned — no row of bare glyphs. The
 *     name truncates only after the toolbar has overflowed into "…".
 *   - Opening the burger turns the ribbon into the desktop title bar: the
 *     app's controls slide out to the right while the ⌂ host jump with the
 *     suite's name ("Home" without a host label; first to truncate) and the
 *     app icon ease in before the app's name. Colours, sizes and spacing are
 *     the desktop brand row's, and the name wears its desktop colour closed
 *     and open alike — opening the menu changes no colour. That is
 *     where you are and the way home, so the panel drops its own Home entry
 *     on compact. An app with nothing behind a burger shows the icons all
 *     along.
 *   - Rail drawer: the nav ADOPTS the app's rail (see `rail`), marks it
 *     [drawer] and makes its burger the one way to open it — one burger, not
 *     two. When the panel also has entries (host nav, routes, sections) they
 *     stack above the rail in one column. The nav owns the drawer's scrim,
 *     Escape, swipe-left-to-close, closing on a link tap (a .sidebar closes
 *     on a[href] or [data-drawer-close]; <sac-sidebar> on any item) and the
 *     focus trap (everything outside the drawer turns inert while it is out).
 *   - Safe areas: the ribbon grows by env(safe-area-inset-top) and pads its
 *     sides by the left/right insets, so a notch never covers it.
 *
 * TOOLBAR OVERFLOW (every width, driven by a ResizeObserver, not a
 * breakpoint): when the toolbar slot plus the host tools do not fit, the
 * trailing buttons move behind a "…" <sac-menu> at the end of the ribbon —
 * same order, same icons, labelled by their text, aria-label or title. A
 * menu item clicks the original button, so its handlers run unchanged. The
 * buttons are hidden with [data-sac-overflow] (ui.css), never moved.
 * Candidates are the button/a elements in the toolbar slot (directly, or one
 * level inside a wrapper element) and the host tools. Mark a control
 * data-overflow="never" to keep it in the ribbon. Needs sac-menu loaded;
 * without it nothing overflows.
 *
 * Layout contract: content below needs padding-top: 50px plus the top safe
 * area (#app-root and .main-layout in ui.css do this).
 */
(function () {

    /** Kit i18n: sac.t when globals.js is loaded, the English fallback when
     *  the component runs standalone. */
    const t = (key, fallback) =>
        (window.sac && window.sac.t) ? window.sac.t(key, fallback) : fallback;

class SacNav extends HTMLElement {
    static get observedAttributes() { return ["host-href", "host-label", "host-icon", "host-nav", "sections-nav", "rail", "compact-title"]; }

    constructor() {
        super();
        this.attachShadow({ mode: "open" });
        this.isOpen = false;
        this._host = null;
        this._sections = [];
        this._rail = null;            // the adopted rail (compact drawer)
        this._drawerOpen = false;
        this._inerted = [];
        this._overflowed = [];
        this._overflowFrame = 0;
    }

    /** The host's injection (see header). Assign context.host in mount().
     *  A host may re-declare later (e.g. the signed-in user was renamed):
     *  sac.apps mutates this same object in place and fires sac:host-changed,
     *  which repaints the injected chrome without a fresh assignment here. */
    get host() { return this._host; }
    set host(v) {
        this._host = v || null;
        this._syncHostTools();
        if (this.shadowRoot.firstChild) this.render();
    }

    /**
     * The host's toolbar controls are rendered as LIGHT-DOM .nav-icon-btn
     * elements slotted into "host-tools" — the exact same ui.css recipe as
     * the app's own ribbon buttons, so the two can never look different.
     * Owned and replaced wholesale by the nav (marked data-sac-host-tool).
     */
    _syncHostTools() {
        this.querySelectorAll("[data-sac-host-tool]").forEach((el) => el.remove());
        const tools = (this._host && Array.isArray(this._host.toolbar)) ? this._host.toolbar : [];
        tools.forEach((tb) => {
            const el = document.createElement(tb.href ? "a" : "button");
            el.className = "nav-icon-btn" + (tb.label ? " labeled" : "") +
                          (tb.avatar ? " avatar" : "");
            el.slot = "host-tools";
            el.dataset.sacHostTool = "";
            el.title = tb.title || tb.label || "";
            if (tb.href) el.href = tb.href;
            else el.type = "button";
            // An identity avatar wins over an icon glyph — a signed-in user
            // wears their own badge; everything else is an icon, as before.
            if (tb.avatar && tb.avatar.name != null) {
                const av = document.createElement("sac-avatar");
                av.setAttribute("name", tb.avatar.name);
                if (tb.avatar.src) av.setAttribute("src", tb.avatar.src);
                el.appendChild(av);
            } else if (tb.icon) {
                const ic = document.createElement("sac-icon");
                ic.setAttribute("name", tb.icon);
                el.appendChild(ic);
            }
            if (tb.label) {
                const sp = document.createElement("span");
                sp.textContent = tb.label;
                el.appendChild(sp);
            }
            if (!tb.href && typeof tb.onClick === "function") {
                el.addEventListener("click", () => tb.onClick(tb));
            }
            this.appendChild(el);
        });
    }

    /** The app's own sub-navigation (see header). Optional. */
    get sections() { return this._sections; }
    set sections(v) {
        this._sections = Array.isArray(v) ? v : [];
        if (this.shadowRoot.firstChild) this.render();
    }

    connectedCallback() {
        this._mq = window.matchMedia(SacNav.COMPACT);
        this._mqHandler = () => {
            if (!this._mq.matches) this._setDrawer(false);
            this.render();
        };
        this._mq.addEventListener("change", this._mqHandler);
        // Toolbar overflow follows the nav's real width and its content.
        this._ro = new ResizeObserver(() => this._scheduleOverflow());
        this._ro.observe(this);
        this._mo = new MutationObserver(() => {
            // Panel content added or removed: the burger may appear or go.
            if (!!this.querySelector(':scope > [slot="panel"]') !== !!this._hasSlotted) this.render();
            this._scheduleOverflow();
        });
        // A link (or [data-nav-close]) in the app's panel content closes the
        // panel like a nav entry does; anything else — a filter, a toggle —
        // leaves it open.
        this.addEventListener("click", (e) => {
            const hit = e.target.closest?.("a[href], [data-nav-close]");
            if (hit && hit.closest('[slot="panel"]')) this._closeAll();
        });
        this._mo.observe(this, { childList: true, subtree: true, characterData: true,
            attributes: true, attributeFilter: ["hidden", "disabled", "title", "aria-label"] });
        this.render();
        this.attachPersistentHandlers();
    }

    attributeChangedCallback() {
        // Hosted apps copy context.host in during mount(), after connect.
        if (this.shadowRoot.firstChild) this.render();
    }

    disconnectedCallback() {
        if (this._escHandler)   document.removeEventListener("keydown", this._escHandler);
        if (this._hashHandler)  window.removeEventListener("hashchange", this._hashHandler);
        if (this._routeHandler) window.removeEventListener("sac:route-registered", this._routeHandler);
        if (this._scopeHandler) window.removeEventListener("sac:scope-changed", this._scopeHandler);
        if (this._hostChangedHandler) document.removeEventListener("sac:host-changed", this._hostChangedHandler);
        this._mq?.removeEventListener("change", this._mqHandler);
        this._ro?.disconnect();
        this._mo?.disconnect();
        cancelAnimationFrame(this._overflowFrame);
        this._setDrawer(false);
        this._releaseRail();
    }

    render() {
        const brand     = this.getAttribute("brand") || "";
        const brandIcon = this.getAttribute("brand-icon") || "";
        const brandHref = this.getAttribute("brand-href") || "#/";
        const appName   = this.getAttribute("app-name") || "";
        // The host's presence in the app's own chrome (see the header).
        // The `host` property is the full injection; the host-* attributes
        // remain as the static-page form of the jump alone.
        const injected  = this._host || {};
        const hostHref  = injected.href || this.getAttribute("host-href") || "";
        const hostLabel = injected.name || this.getAttribute("host-label") || "";
        const hostIcon  = injected.icon || this.getAttribute("host-icon") || "home";
        const hostNav   = Array.isArray(injected.nav) ? injected.nav : [];
        const hostTools = Array.isArray(injected.toolbar) ? injected.toolbar : [];
        // sections-nav="wide": on compact the app's sections leave the
        // burger — the app's rail lists them already (one list, one scroll).
        const sections  = (this.getAttribute("sections-nav") === "wide" && this._mq?.matches)
            ? [] : this._sections;
        // host-nav="wide": on compact the suite list leaves the burger — the
        // app's dashboard is the phone's main level, ⌂ in the ribbon goes
        // back to it. The ribbon jump itself always stays.
        const hideHost = this.getAttribute("host-nav") === "wide" && !!this._mq?.matches;
        // Compact: the ribbon's brand row (shown while the menu is open)
        // carries the way home, so the panel's own
        // Home entry would say it twice.
        const compact = !!this._mq?.matches;
        const panelHostHref = (hideHost || compact) ? "" : hostHref;
        const compactTitle = this.getAttribute("compact-title") ||
            (hostHref ? brand : (appName || brand));
        // The desktop colours this name as the app segment (accent) when it
        // IS one: the brand of a hosted app, or an app-name.
        const titleAccent = !!hostHref ||
            (!this.getAttribute("compact-title") && !!appName);
        const panelHostNav  = hideHost ? [] : hostNav;
        const hasSlotted = !!this.querySelector(':scope > [slot="panel"]');
        this._hasSlotted = hasSlotted;

        const routes = (window.sac?.router?.routes() || []).filter(r => r.hash !== "#/")
            // On a shared page (launcher pattern) the router carries the
            // host's destinations too — the host group already lists those,
            // so the app's own group drops the duplicates.
            .filter(r => !hostNav.some(e => e.href === r.hash));
        // currentResource() strips any scope prefix so "active" state
        // highlights the right nav item in every scope.
        const currentResource = window.sac?.router?.currentResource?.() || window.location.hash || "#/";
        const hrefFor = (h) => (h.startsWith("#") && window.sac?.scope?.hashFor) ? sac.scope.hashFor(h) : h;
        // A route with sub-routes stays active while you are inside it:
        // "#/styleguide" owns "#/styleguide/components" (sac.apps view apps
        // address their own state that way). Same rule for injected host
        // entries, keyed on their href.
        const isActiveHref = (h) => !!h && (h.startsWith("#")
            ? (h === currentResource || currentResource.startsWith(h + "/"))
            : window.location.pathname === h);
        const isActive = (r) => isActiveHref(r.hash);

        // The burger only earns its place when the panel it opens has something
        // in it — the host suite nav, the app's own routes, or its sections.
        // Empty on all three (a standalone app with no routes and no host) means
        // no panel, so no button: the kit never renders a control that does
        // nothing (the same rule sac-footer's link follows). Recomputed every
        // render, so a late route (sac:route-registered) or a re-declared host
        // (sac:host-changed) brings the burger back the moment there is content.
        const hasPanel = !!panelHostHref || panelHostNav.length > 0 || routes.length > 0 ||
            sections.length > 0 || hasSlotted;
        this._hasPanel = hasPanel;
        // On compact the burger also opens the app's rail — then it earns its
        // place even with an empty panel (a tool page: no routes, one rail).
        this._adoptRail();
        const showBurger = hasPanel || this._railMode();
        // Compact ribbon faces (see RESPONSIVE): with a burger the closed
        // ribbon shows just the app's name ("titled"); opening it swaps in
        // the desktop brand row. Without a burger the brand row stays.
        const titled = compact && showBurger && !!compactTitle;

        // Kit strings: attribute position gets quote-escaping, the empty
        // state is a text node and gets &/< escaping instead.
        const esc = (s) => String(s).replace(/"/g, "&quot;");
        const escText = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;");
        const L = {
            menu:       esc(t("nav.menu", "Menu")),
            home:       esc(t("nav.home", "Home")),
            more:       esc(t("nav.more", "More")),
            noSections: escText(t("nav.no-sections", "No sections yet.")),
        };

        this.shadowRoot.innerHTML = `
            <style>
                :host {
                    position: fixed;
                    top: 0; left: 0; right: 0;
                    z-index: 9999;
                }
                /* Stacking: floating windows live in 10000–18999, dialogs
                   from 20000. While the burger's panel (or the rail drawer)
                   is out, the nav rises above every window and stays under
                   dialogs — the menu is never covered by a window. */
                :host([menu-open]) { z-index: 19000; }
                .ribbon {
                    height: 50px;
                    display: flex;
                    align-items: center;
                    padding: 0 1rem;
                    /* content-box: the notch inset adds to the 50px. */
                    padding-top: env(safe-area-inset-top, 0px);
                    padding-left: calc(1rem + env(safe-area-inset-left, 0px));
                    padding-right: calc(1rem + env(safe-area-inset-right, 0px));
                    background: var(--glass-strong);
                    backdrop-filter: blur(12px);
                    -webkit-backdrop-filter: blur(12px);
                    border-bottom: 1px solid var(--border-strong);
                }
                /* Burger that morphs into an X while the panel is open —
                   open state is readable from the ribbon alone. */
                .menu-btn {
                    background: none;
                    border: none;
                    cursor: pointer;
                    width: 32px;
                    height: 32px;
                    margin-right: 0.5rem;
                    border-radius: var(--radius-m);
                    display: flex;
                    flex-direction: column;
                    justify-content: center;
                    align-items: center;
                    gap: 4px;
                    padding: 0;
                    flex: none;
                }
                .menu-btn:hover { background: var(--hover); }
                .menu-btn:focus-visible,
                .more-btn:focus-visible {
                    outline: 2px solid var(--accent);
                    outline-offset: 2px;
                }
                .menu-btn span {
                    display: block;
                    width: 18px;
                    height: 2px;
                    background: var(--text);
                    border-radius: var(--radius-s);
                    transition: all 0.3s ease;
                }
                .menu-btn.active span:nth-child(1) { transform: translateY(6px) rotate(45deg); }
                .menu-btn.active span:nth-child(2) { opacity: 0; }
                .menu-btn.active span:nth-child(3) { transform: translateY(-6px) rotate(-45deg); }
                /* Icon-to-text spacing is the .brand gap alone (0.5rem) — a
                   margin here on top of it doubled the space. */
                .brand-mark {
                    color: var(--accent);
                    display: flex;
                    align-items: center;
                }
                .brand-mark sac-icon { --icon-size: 22px; }
                .brand {
                    font-family: 'Outfit', sans-serif;
                    font-weight: 800;
                    font-size: 0.95rem;
                    letter-spacing: 0.08em;
                    color: var(--text);
                    display: flex; align-items: center; gap: 0.5rem;
                    text-decoration: none;
                    /* Shrinks and truncates only after the toolbar has
                       overflowed into the "…" menu (see _layoutOverflow). */
                    min-width: 0;
                    overflow: hidden;
                    white-space: nowrap;
                }
                .brand-mark { flex: none; }
                .brand > span:not(.brand-mark) { overflow: hidden; text-overflow: ellipsis; }
                .brand .app-name { color: var(--accent); }

                /* The host's injected presence renders with the BRAND recipe —
                   one title-bar style everywhere: host, then the app's segment
                   in accent. Spacing alone separates the segments — a divider
                   glyph on top of two icon+name pairs reads restless. */
                .host-jump { margin-right: 0.9rem; flex: none; }
                .spacer { flex: 1; min-width: 0; }

                /* Compact identity row: [⌂] [app icon] NAME. The name is
                   the brand recipe as text and always stays; the two icons
                   tuck away while the menu is closed and ease in when it
                   opens (see the compact block below). Desktop: hidden. */
                .compact-id { display: none; align-items: center; min-width: 0; }
                .compact-title {
                    display: flex;
                    align-items: center;
                    min-width: 0;
                    overflow: hidden;
                    font-family: 'Outfit', sans-serif;
                    font-weight: 800;
                    font-size: 0.95rem;
                    letter-spacing: 0.08em;
                    color: var(--text);
                    text-decoration: none;
                    white-space: nowrap;
                }
                .compact-title .cid-text { overflow: hidden; text-overflow: ellipsis; }
                .cid-home, .cid-icon {
                    display: flex;
                    align-items: center;
                    flex: none;
                    overflow: hidden;
                    color: var(--accent);
                    --icon-size: 22px;
                    max-width: 32px;
                    margin-right: 0.5rem;     /* icon to name: the .brand gap */
                    opacity: 1;
                    text-decoration: none;
                }
                /* The way home names where it goes — the suite's name — and is
                   the first thing to truncate when the row runs out of room.
                   Colours, sizes and spacing are the DESKTOP brand row's, so
                   the open phone menu reads exactly like the desktop bar. */
                .cid-home {
                    gap: 0.5rem;              /* = the desktop .brand gap */
                    max-width: 16rem;
                    flex: 0 100 auto;   /* shrinks long before the app name */
                    min-width: 22px;
                    margin-right: 0.9rem;     /* = desktop .host-jump */
                    font-family: 'Outfit', sans-serif;
                    font-weight: 800;
                    font-size: 0.95rem;
                    letter-spacing: 0.08em;
                    white-space: nowrap;
                }
                .cid-home sac-icon { flex: none; }
                .cid-home-label {
                    min-width: 0;
                    overflow: hidden;
                    text-overflow: ellipsis;
                    color: var(--text);
                }
                /* The app's name in the desktop brand's colour — accent when it
                   is the app segment (hosted, or an app-name) — closed and open
                   alike, so opening the menu changes no colour at all. */
                .compact-title.app-name { color: var(--accent); }
                .compact-title { flex: 0 1 auto; }
                .cid-home:focus-visible, .compact-title:focus-visible {
                    outline: 2px solid var(--accent);
                    outline-offset: 2px;
                    border-radius: var(--radius-s);
                }

                .right { display: flex; align-items: center; min-width: 0; }
                .toolbar-slot { display: flex; gap: 0.25rem; align-items: center; flex: none; }
                .context { display: flex; align-items: center; margin-right: 0.6rem; min-width: 0; overflow: hidden; }
                .context:empty { margin-right: 0; }

                /* The toolbar overflow menu's trigger — the .nav-icon-btn
                   recipe, written out because ui.css does not pierce here. */
                .more { flex: none; margin-left: 0.25rem; }
                .more[hidden] { display: none; }
                .more-btn {
                    width: 36px;
                    height: 36px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    padding: 0;
                    border: none;
                    border-radius: 50%;
                    background: transparent;
                    color: var(--text-muted);
                    cursor: pointer;
                    --icon-size: 20px;
                    transition: background 0.2s var(--ease-smooth), color 0.2s var(--ease-smooth);
                }
                .more-btn:hover { background: var(--hover); color: var(--text); }

                .backdrop {
                    position: fixed;
                    top: calc(50px + env(safe-area-inset-top, 0px)); left: 0; right: 0; bottom: 0;
                    background: color-mix(in srgb, var(--sink) 50%, transparent);
                    opacity: 0;
                    visibility: hidden;
                    transition: opacity 0.3s, visibility 0.3s;
                    z-index: 1;
                }
                .backdrop.open { opacity: 1; visibility: visible; }

                .panel {
                    position: fixed;
                    top: calc(50px + env(safe-area-inset-top, 0px)); left: 0; bottom: 0;
                    width: var(--drawer-width);   /* min(300px, 85vw) */
                    background: color-mix(in srgb, var(--glass-hue) 95%, transparent);
                    backdrop-filter: blur(20px);
                    -webkit-backdrop-filter: blur(20px);
                    border-right: 1px solid var(--border-strong);
                    transform: translateX(-110%);
                    visibility: hidden;
                    transition: transform 0.5s var(--ease-swift), visibility 0.5s;
                    z-index: 2;
                    padding: 1.5rem 0;
                    overflow-y: auto;
                }
                /* Scrollbar — the kit recipe (ui.css §5), re-stated because
                   ::-webkit-scrollbar does not pierce a shadow root. Firefox, which has
                   no ::-webkit-scrollbar, gets the standard pair instead. */
                .panel::-webkit-scrollbar { width: 10px; height: 10px; }
                .panel::-webkit-scrollbar-track { background: transparent; }
                .panel::-webkit-scrollbar-thumb {
                    background: var(--scrollbar-thumb);
                    background-clip: content-box;
                    border: 2px solid transparent;
                    border-radius: 999px;
                }
                .panel::-webkit-scrollbar-thumb:hover {
                    background: var(--scrollbar-thumb-hover);
                    background-clip: content-box;
                }
                .panel::-webkit-scrollbar-corner { background: transparent; }
                @supports not selector(::-webkit-scrollbar) {
                    .panel { scrollbar-width: thin; scrollbar-color: var(--scrollbar-thumb) transparent; }
                }
                .panel.open {
                    transform: translateX(0);
                    visibility: visible;
                }
                /* Compact with a rail: the panel's entries stack ABOVE the
                   rail drawer in one column — the rail starts where the
                   panel ends (--drawer-top, measured on open). */
                /* border-box on the panel and its items only — the ribbon
                   stays content-box on purpose (the notch inset adds to its
                   50px). Matters for the stacked panel, whose padding must
                   not widen it past the rail below. */
                .panel, .nav-item { box-sizing: border-box; }
                .panel.with-rail {
                    bottom: auto;
                    max-height: 45dvh;
                    border-bottom: 1px solid var(--border);
                }
                /* Compact: the panel wears the RAIL's recipe (sac-sidebar) —
                   solid ground (nothing of the page shows through), same
                   hairlines, item pills and section captions — so panel and
                   rail drawer read as one material, stacked or alone.
                   [rail-look] is set by render() while compact. */
                .panel.rail-look {
                    padding: 0.75rem;
                    padding-bottom: calc(0.75rem + env(safe-area-inset-bottom, 0px));
                    background: var(--panel);
                    backdrop-filter: none;
                    -webkit-backdrop-filter: none;
                    border-right: 1px solid var(--border);
                }
                .panel.rail-look .nav-list {
                    display: flex;
                    flex-direction: column;
                    gap: 2px;
                }
                .panel.rail-look .nav-item {
                    gap: 0.6rem;
                    padding: 0.45rem 0.6rem;
                    border-radius: var(--radius-m);
                    color: var(--text-muted);
                    font-size: 0.85rem;
                    --icon-size: 16px;
                }
                .panel.rail-look .nav-item sac-icon { --icon-size: 16px; }
                .panel.rail-look .nav-item:hover { background: var(--hover); color: var(--text); }
                .panel.rail-look .nav-item.active {
                    background: var(--accent-tint);
                    color: var(--accent-text);
                    font-weight: 600;
                }
                .panel.rail-look .sub-list .nav-item { padding-left: 2.2rem; font-size: 0.8rem; }
                .panel.rail-look .panel-label {
                    margin: 0.9rem 0 0.25rem 0.5rem;
                    padding: 0;
                    font-size: 0.7rem;
                    font-weight: 700;
                    letter-spacing: 0.05em;
                    color: var(--text-dim);
                }
                .panel.rail-look .panel-label:first-child { margin-top: 0.15rem; }
                .panel.rail-look .panel-sep { margin: 0.6rem 0.5rem; }
                .panel.rail-look ::slotted([slot="panel"]) { padding: 0 0.5rem 0.75rem; }
                .nav-list { list-style: none; padding: 0; margin: 0; }
                .nav-item {
                    display: flex;
                    align-items: center;
                    gap: 0.75rem;
                    padding: 0.75rem 1.5rem;
                    color: color-mix(in srgb, var(--fg) 78%, var(--bg));
                    text-decoration: none;
                    font-size: 0.95rem;
                    cursor: pointer;
                    transition: background 0.2s;
                }
                .nav-item:hover {
                    background: color-mix(in srgb, var(--fg) 5%, transparent);
                    color: var(--text);
                }
                .nav-item.active {
                    background: var(--accent-tint);
                    color: var(--accent);
                }
                .nav-item sac-icon { --icon-size: 18px; }
                .panel-slot { display: contents; }
                ::slotted([slot="panel"]) { display: block; padding: 0 1.5rem 0.9rem; }
                .panel-empty {
                    padding: 1rem 1.5rem;
                    color: var(--text-dim);
                    font-size: 0.85rem;
                    font-style: italic;
                }
                /* Group labels + separator, only rendered when the host
                   injected a nav group (two groups need naming). */
                .panel-label {
                    padding: 0 1.5rem 0.4rem;
                    color: var(--text-dim);
                    font-size: 0.7rem;
                    font-weight: 600;
                    text-transform: uppercase;
                    letter-spacing: 0.08em;
                }
                .panel-sep {
                    border: none;
                    border-top: 1px solid var(--border);
                    margin: 0.9rem 1.5rem;
                }
                /* The app's own sections, nested under its suite entry. */
                .sub-list { list-style: none; padding: 0; margin: 0; }
                .sub-list .nav-item {
                    padding: 0.45rem 1.5rem 0.45rem 3.1rem;
                    font-size: 0.85rem;
                }
                .sub-list .nav-item sac-icon { --icon-size: 15px; }

                /* Host toolbar controls (injected via the host property) —
                   right end of the ribbon, after the app's own toolbar.
                   Only LAYOUT lives here: the buttons themselves are
                   light-DOM .nav-icon-btn elements (see _syncHostTools),
                   styled by the one recipe in ui.css — the exact same class
                   as the app's own ribbon buttons, so they cannot drift. */
                .host-tools {
                    flex: none;
                    display: flex;
                    gap: 0.25rem;
                    align-items: center;
                    margin-left: 0.5rem;
                    /* Hairline scope divider: the host's controls read as a
                       distinct group from the app's own toolbar to their left,
                       so two lookalike buttons (an app About + a host About)
                       never read as one row. 1px neutral, never a thick colour. */
                    padding-left: 0.6rem;
                    border-left: 1px solid var(--border);
                }

                @media (max-width: 768px), (max-height: 480px) and (pointer: coarse) {
                    .ribbon {
                        padding-left: calc(0.5rem + env(safe-area-inset-left, 0px));
                        padding-right: calc(0.5rem + env(safe-area-inset-right, 0px));
                    }
                    /* One identity row instead of the brand: [⌂] [icon] NAME.
                       Closed (".titled" = there is a burger): only the NAME —
                       no row of bare glyphs. Opening the menu eases the ⌂
                       and the app icon in before the name (it slides right,
                       stays white) while the controls slide out to the right:
                       the open menu reads like the desktop title bar. With
                       no burger the icons are there all along. */
                    .ribbon { position: relative; }
                    .brand, .host-jump { display: none; }
                    .compact-id { display: flex; }
                    .cid-home, .cid-icon {
                        transition: max-width 0.35s var(--ease-swift), margin-right 0.35s var(--ease-swift), gap 0.35s var(--ease-swift),
                                    opacity 0.3s var(--ease-smooth) 0.05s, visibility 0s;
                    }
                    .ribbon.titled:not(.menu-open) .cid-home,
                    .ribbon.titled:not(.menu-open) .cid-icon {
                        gap: 0;
                        max-width: 0;
                        margin-right: 0;
                        opacity: 0;
                        visibility: hidden;   /* no tab stop while tucked away */
                        transition: max-width 0.35s var(--ease-swift), margin-right 0.35s var(--ease-swift), gap 0.35s var(--ease-swift),
                                    opacity 0.2s var(--ease-smooth), visibility 0s 0.35s;
                    }
                    .right {
                        transition: translate 0.35s var(--ease-swift), opacity 0.25s var(--ease-smooth),
                                    visibility 0.35s;
                    }
                    .ribbon.menu-open .right {
                        position: absolute;
                        top: env(safe-area-inset-top, 0px);
                        bottom: 0;
                        right: calc(0.5rem + env(safe-area-inset-right, 0px));
                        translate: calc(100% + 1rem) 0;
                        opacity: 0;
                        visibility: hidden;
                        pointer-events: none;
                    }
                    .context { margin-right: 0.35rem; }
                    .host-tools { margin-left: 0.35rem; padding-left: 0.35rem; }
                }
                @media (pointer: coarse) {
                    .menu-btn, .more-btn { width: 44px; height: 44px; }
                    .sub-list .nav-item,
                    .panel.rail-look .nav-item { min-height: 44px; }
                }
                @media (hover: none) {
                    .menu-btn:hover, .more-btn:hover { background: none; }
                }
                @media (prefers-reduced-motion: reduce) {
                    .menu-btn span, .backdrop, .panel, .more-btn, .right,
                    .cid-home, .cid-icon { transition: none !important; }
                }
            </style>
            <nav class="ribbon${titled ? " titled" : ""}">
                ${showBurger ? `
                <button class="menu-btn" aria-label="${L.menu}" aria-expanded="false">
                    <span></span><span></span><span></span>
                </button>` : ``}
                ${hostHref ? `
                <a class="brand host-jump" href="${hostHref.replace(/"/g, "&quot;")}"
                   title="${(hostLabel || "Home").replace(/"/g, "&quot;")}">
                    <span class="brand-mark"><sac-icon name="${hostIcon}"></sac-icon></span>
                    ${hostLabel ? `<span class="host-label">${hostLabel}</span>` : ``}
                </a>` : ``}
                <a class="brand${brandIcon ? " has-icon" : ""}" href="${hrefFor(brandHref)}">
                    ${brandIcon ? `<span class="brand-mark"><sac-icon name="${brandIcon}"></sac-icon></span>` : ``}
                    ${brand ? `<span class="brand-text${hostHref ? " app-name" : ""}">${brand}</span>` : ``}
                    ${appName ? `<span class="app-name">${appName}</span>` : ``}
                </a>
                ${compactTitle ? `
                <div class="compact-id">
                    ${hostHref ? `
                    <a class="cid-home" href="${esc(hostHref)}" title="${esc(hostLabel || L.home)}"><sac-icon name="${esc(hostIcon)}"></sac-icon><span class="cid-home-label">${escText(hostLabel || t("nav.home", "Home"))}</span></a>` : ``}
                    <a class="compact-title${titleAccent ? " app-name" : ""}" href="${hrefFor(brandHref)}">
                        ${brandIcon ? `<span class="cid-icon"><sac-icon name="${esc(brandIcon)}"></sac-icon></span>` : ``}
                        <span class="cid-text">${compactTitle}</span>
                    </a>
                </div>` : ``}
                <div class="spacer"></div>
                <!-- The app's controls, one group: on compact they slide out
                     to the right while the menu is open. -->
                <div class="right">
                <div class="context"><slot name="context"></slot></div>
                <div class="toolbar-slot"><slot name="toolbar"></slot></div>
                ${hostTools.length ? `
                <div class="host-tools"><slot name="host-tools"></slot></div>` : ``}
                <sac-menu class="more" hidden>
                    <button slot="trigger" class="more-btn" type="button" aria-label="${L.more}" title="${L.more}">
                        <sac-icon name="more"></sac-icon>
                    </button>
                </sac-menu>
                </div>
            </nav>
            <div class="backdrop"></div>
            <aside class="panel${compact ? " rail-look" : ""}">
                <!-- The app's own panel content (any use: filters, account,
                     settings…) — first, above the navigation groups. -->
                <div class="panel-slot"><slot name="panel"></slot></div>
                ${(panelHostHref || panelHostNav.length) ? `
                <div class="panel-label">${escText(hostLabel || t("nav.host", "Host"))}</div>
                <ul class="nav-list">
                    ${panelHostHref ? `
                    <li>
                        <!-- The way back to the host lives in the burger too, not
                             only in the ribbon ⌂ — the menu is the place you look
                             to navigate, so the suite's home belongs at the top of
                             its own group. Same data the ribbon jump already has. -->
                        <a class="nav-item ${isActiveHref(panelHostHref) ? "active" : ""}" href="${esc(panelHostHref)}">
                            <sac-icon name="${esc(hostIcon)}"></sac-icon>
                            <span>${escText(t("nav.home", "Home"))}</span>
                        </a>
                    </li>` : ``}
                    ${panelHostNav.map(e => {
                        // The entry addressing the running app carries the
                        // app's own sections as an indented subtree.
                        const self = isActiveHref(e.href);
                        return `
                        <li>
                            <a class="nav-item ${self ? "active" : ""}" href="${esc(hrefFor(e.href))}">
                                ${e.icon ? `<sac-icon name="${esc(e.icon)}"></sac-icon>` : ""}
                                <span>${escText(e.label)}</span>
                            </a>
                            ${self && sections.length ? `
                            <ul class="sub-list">
                                ${sections.map(s => `
                                    <li>
                                        <a class="nav-item ${isActiveHref(s.href) ? "active" : ""}" href="${esc(hrefFor(s.href))}">
                                            ${s.icon ? `<sac-icon name="${esc(s.icon)}"></sac-icon>` : ""}
                                            <span>${escText(s.label)}</span>
                                        </a>
                                    </li>
                                `).join("")}
                            </ul>` : ``}
                        </li>`;
                    }).join("")}
                </ul>
                ${routes.length ? `<hr class="panel-sep">${(appName || brand)
                    ? `<div class="panel-label">${escText(appName || brand)}</div>` : ``}` : ``}` : ``}
                ${routes.length === 0
                    ? ((panelHostHref || panelHostNav.length || sections.length || hasSlotted || compact) ? `` : `<div class="panel-empty">${L.noSections}</div>`)
                    : `<ul class="nav-list">
                         ${routes.map(r => `
                             <li>
                                 <a class="nav-item ${isActive(r) ? "active" : ""}" href="${esc(hrefFor(r.hash))}">
                                     ${r.icon ? `<sac-icon name="${esc(r.icon)}"></sac-icon>` : ""}
                                     <span>${escText(r.label)}</span>
                                 </a>
                             </li>
                         `).join("")}
                       </ul>`}
                ${!panelHostNav.length && sections.length ? `
                <ul class="nav-list">
                    ${sections.map(s => `
                        <li>
                            <a class="nav-item ${isActiveHref(s.href) ? "active" : ""}" href="${esc(hrefFor(s.href))}">
                                ${s.icon ? `<sac-icon name="${esc(s.icon)}"></sac-icon>` : ""}
                                <span>${escText(s.label)}</span>
                            </a>
                        </li>
                    `).join("")}
                </ul>` : ``}
            </aside>
        `;

        // Re-attach handlers on freshly-rendered shadow-root children.
        this.attachEphemeralHandlers();
    }

    attachEphemeralHandlers() {
        const menuBtn  = this.shadowRoot.querySelector(".menu-btn");
        const backdrop = this.shadowRoot.querySelector(".backdrop");
        const panel    = this.shadowRoot.querySelector(".panel");

        // Backdrop and burger show "something is out" — the panel, the rail
        // drawer, or both stacked (compact).
        const ribbon = this.shadowRoot.querySelector(".ribbon");
        this._syncChrome = () => {
            const any = this.isOpen || this._drawerOpen;
            const was = ribbon.classList.contains("menu-open");
            ribbon.classList.toggle("menu-open", any && !!this._mq?.matches);
            // Re-measure once the controls have slid back in: mid-slide
            // their translated box would read as overflow.
            if (was && !any) setTimeout(() => this._scheduleOverflow(), 400);
            if (any !== !!this._announced) {
                this._announced = any;
                this.dispatchEvent(new CustomEvent(any ? "sac:nav-open" : "sac:nav-close",
                    { detail: { drawer: this._drawerOpen }, bubbles: true, composed: true }));
            }
            backdrop.classList.toggle("open", any);
            // Rise at once; sink only after the panel has slid out, so the
            // closing slide is not cut by a window it passes under.
            clearTimeout(this._layerTimer);
            if (any) this.setAttribute("menu-open", "");
            else this._layerTimer = setTimeout(() => this.removeAttribute("menu-open"), 500);
            if (menuBtn) {
                menuBtn.classList.toggle("active", any);
                menuBtn.setAttribute("aria-expanded", String(any));
            }
        };
        const setOpen = (open) => {
            this.isOpen = open;
            panel.classList.toggle("open", open);
            this._syncChrome();
        };
        this._setOpen = setOpen;

        // No burger when there is nothing to open (see showBurger): guard it.
        // On compact with a rail the burger drives the drawer instead.
        if (menuBtn) menuBtn.addEventListener("click", () => {
            if (this._railMode()) this._setDrawer(!this._drawerOpen);
            else setOpen(!this.isOpen);
        });
        backdrop.addEventListener("click", () => this._closeAll());

        // The "…" toolbar overflow menu clicks the original control.
        const more = this.shadowRoot.querySelector(".more");
        more.addEventListener("sac:select", (e) => {
            const el = this._overflowed[Number(e.detail && e.detail.action)];
            if (el && el.isConnected) el.click();
        });

        // Clicking a panel nav-item closes the panel — and so do the ribbon's
        // brand/host links: they navigate too, just from outside the panel.
        this.shadowRoot.querySelectorAll(".nav-item, .brand, .compact-title, .cid-home").forEach(el => {
            el.addEventListener("click", (e) => {
                // A host.nav entry can point at a window app via ?app=<id>.
                // Open it IN PLACE — the anchor's full navigation would reload,
                // land home and throw you out of the app you were in. Plain left
                // click only: a modified/middle click keeps the anchor's deep-link
                // semantics (a new tab with the window open), and an unknown id or
                // a host with no sac.apps simply falls back to that too. Mirrors
                // the launcher tile's [data-app] contract.
                const m = /[?&]app=([^&]+)/.exec(el.getAttribute("href") || "");
                const id = m && decodeURIComponent(m[1]);
                if (id && !e.defaultPrevented && e.button === 0 &&
                    !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey &&
                    window.sac?.apps?.get?.(id)) {
                    e.preventDefault();
                    Promise.resolve(sac.apps.open(id)).catch(() => {});
                }
                this._closeAll();
            });
        });

        // Restore panel state after a re-render (routes changed while open).
        // With no burger there is no panel to reopen.
        if (menuBtn) { if (this.isOpen) setOpen(true); }
        else this.isOpen = false;
        if (this._drawerOpen) this._layoutDrawer();
        this._syncChrome();
        this._scheduleOverflow();
    }

    /* ------------------------------------------------ compact: rail drawer */

    static COMPACT = "(max-width: 768px), (max-height: 480px) and (pointer: coarse)";

    /** Compact, with a rail that has something in it (an empty
     *  <sac-sidebar> hides itself — no burger for an empty drawer). */
    _railMode() { return !!(this._mq && this._mq.matches && this._rail && !this._rail.hidden); }

    /** The rail the burger drives on compact (see the `rail` attribute). */
    _findRail() {
        const sel = this.getAttribute("rail");
        if (sel === "none") return null;
        let el = null;
        try {
            el = sel
                ? this.getRootNode().querySelector(sel)
                : this.parentElement?.querySelector(".main-layout sac-sidebar, .main-layout .sidebar");
        } catch { el = null; }   // an invalid selector adopts nothing
        return el || null;
    }

    _adoptRail() {
        const rail = this._findRail();
        if (rail === this._rail) return;
        this._setDrawer(false);
        this._releaseRail();
        this._rail = rail;
        if (!rail) return;
        rail.setAttribute("drawer", "");
        // [open] is the one truth; a <sac-sidebar> closes itself on an item
        // tap, app code may call rail.close() — follow whoever changed it.
        // [hidden] flips when a <sac-sidebar> gets its first items (or loses
        // them): the burger appears or goes, so re-render.
        this._railMO = new MutationObserver((records) => {
            if (records.some((r) => r.attributeName === "hidden")) {
                if (rail.hidden) this._setDrawer(false);
                this.render();
                return;
            }
            this._syncDrawer(rail.hasAttribute("open") && this._railMode());
        });
        this._railMO.observe(rail, { attributes: true, attributeFilter: ["open", "hidden"] });
        this._railClick = (e) => {
            if (!this._drawerOpen || rail.localName === "sac-sidebar") return;
            if (e.target.closest?.("a[href], [data-drawer-close]")) this._setDrawer(false);
        };
        rail.addEventListener("click", this._railClick);
        rail.addEventListener("touchstart", this._swipeStart, { passive: true });
        rail.addEventListener("touchend", this._swipeEnd, { passive: true });
    }

    _releaseRail() {
        const rail = this._rail;
        if (!rail) return;
        this._railMO?.disconnect();
        rail.removeEventListener("click", this._railClick);
        rail.removeEventListener("touchstart", this._swipeStart);
        rail.removeEventListener("touchend", this._swipeEnd);
        rail.removeAttribute("drawer");
        rail.removeAttribute("open");
        rail.style.removeProperty("--drawer-top");
        this._rail = null;
    }

    /** Open or close the rail drawer (compact only; closing always works). */
    _setDrawer(open) {
        const rail = this._rail;
        open = !!(open && rail && this._railMode());
        if (rail) rail.toggleAttribute("open", open);
        this._syncDrawer(open);
    }

    _syncDrawer(open) {
        if (open === this._drawerOpen) return;
        this._drawerOpen = open;
        const rail = this._rail;
        if (open) {
            this._layoutDrawer();
            this._setInert(true);
            // Focus INTO the drawer, but onto the rail itself — focusing its
            // first field would pop the phone keyboard over the drawer.
            if (rail) {
                if (!rail.hasAttribute("tabindex")) rail.setAttribute("tabindex", "-1");
                rail.focus({ preventScroll: true });
            }
        } else {
            if (rail) rail.removeAttribute("open");
            const inside = rail && (rail === document.activeElement || rail.contains(document.activeElement));
            if (this.isOpen) this._setOpen?.(false);
            this.shadowRoot.querySelector(".panel")?.classList.remove("with-rail");
            this._setInert(false);
            if (inside) this.shadowRoot.querySelector(".menu-btn")?.focus({ preventScroll: true });
        }
        this._syncChrome?.();
    }

    /** Stack the panel's entries above the rail when there are any. */
    _layoutDrawer() {
        const rail = this._rail;
        const panel = this.shadowRoot.querySelector(".panel");
        if (!rail || !panel) return;
        if (this._hasPanel) {
            panel.classList.add("with-rail");
            this._setOpen?.(true);
            // The rail starts where the panel ends — and keeps doing so when
            // the panel's height changes while open (a late re-render, a font
            // swap): measured once, a gap or an overlap would open up.
            const place = () => {
                if (this._drawerOpen && panel.classList.contains("with-rail")) {
                    rail.style.setProperty("--drawer-top", `${Math.round(panel.getBoundingClientRect().bottom)}px`);
                }
            };
            place();
            this._panelRO?.disconnect();
            this._panelRO = new ResizeObserver(place);
            this._panelRO.observe(panel);
        } else {
            panel.classList.remove("with-rail");
            rail.style.removeProperty("--drawer-top");
        }
    }

    /** Focus trap: everything outside the nav and the drawer turns inert. */
    _setInert(on) {
        this._inerted.forEach((el) => { el.inert = false; });
        this._inerted = [];
        if (!on || !this._rail) return;
        const keep = [this, this._rail];
        for (let node = this._rail; node.parentElement && node !== document.body; node = node.parentElement) {
            for (const sib of node.parentElement.children) {
                if (sib === node || sib.inert || /^(SCRIPT|STYLE|LINK|TEMPLATE)$/.test(sib.tagName)) continue;
                if (keep.some((k) => sib === k || sib.contains(k))) continue;
                sib.inert = true;
                this._inerted.push(sib);
            }
        }
    }

    /** What the burger does: on compact with a rail, the drawer (stacked
     *  under the panel's entries); otherwise the panel. No-op when there is
     *  nothing to open. */
    open() {
        if (this._railMode()) this._setDrawer(true);
        else if (this._hasPanel) this._setOpen?.(true);
    }
    close() { this._closeAll(); }
    toggle() {
        if (this.isOpen || this._drawerOpen) this.close();
        else this.open();
    }

    _closeAll() {
        this._setOpen?.(false);
        this._setDrawer(false);
    }

    /* Swipe left to close the drawer — never from a control that drags. */
    _swipeStart = (e) => {
        this._swipe = null;
        if (!(this.isOpen || this._drawerOpen) || e.touches.length !== 1) return;
        const drags = e.composedPath().some((n) => n.matches?.(
            'input, textarea, select, sac-slider, [role="slider"], [role="separator"], [data-no-swipe]'));
        if (drags) return;
        this._swipe = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    };
    _swipeEnd = (e) => {
        const s = this._swipe;
        this._swipe = null;
        if (!s || !e.changedTouches.length) return;
        const dx = e.changedTouches[0].clientX - s.x;
        const dy = e.changedTouches[0].clientY - s.y;
        if (dx < -60 && Math.abs(dx) > Math.abs(dy) * 1.5) this._closeAll();
    };

    /* ------------------------------------------------- toolbar overflow */

    _scheduleOverflow() {
        cancelAnimationFrame(this._overflowFrame);
        this._overflowFrame = requestAnimationFrame(() => this._layoutOverflow());
    }

    /** Toolbar controls that may move into the "…" menu, in ribbon order. */
    _overflowCandidates() {
        const out = [];
        const isControl = (el) => el.matches("button, a[href]");
        const slot = this.shadowRoot.querySelector('slot[name="toolbar"]');
        const top = [
            ...(slot ? slot.assignedElements() : []),
            ...this.querySelectorAll(':scope > [slot="host-tools"]'),
        ];
        top.forEach((el) => {
            if (isControl(el)) out.push(el);
            else for (const c of el.children) if (isControl(c)) out.push(c);
        });
        return out.filter((el) => el.getAttribute("data-overflow") !== "never");
    }

    _layoutOverflow() {
        const sr = this.shadowRoot;
        const ribbon = sr.querySelector(".ribbon");
        const more = sr.querySelector(".more");
        if (!ribbon || !more || !this.isConnected) return;
        // Menu open on compact: the controls are out of the flow — measuring
        // now would un-overflow everything. Closing re-runs the layout.
        if (ribbon.classList.contains("menu-open")) return;

        const items = this._overflowCandidates();
        items.forEach((el) => el.removeAttribute("data-sac-overflow"));
        more.hidden = true;

        const brand = sr.querySelector(".brand:not(.host-jump)");
        const context = sr.querySelector(".context");
        // Measured on the ribbon's own children, not ribbon.scrollWidth: a
        // descendant's closed popover may still take layout and would count
        // as overflow.
        const fits = () => {
            const box = ribbon.getBoundingClientRect();
            const limit = box.right - parseFloat(getComputedStyle(ribbon).paddingRight) + 1;
            const edge = Math.max(...[...ribbon.children].map((c) => c.getBoundingClientRect().right));
            return edge <= limit &&
            // The brand's text spans truncate on their own (ellipsis), so
            // measure them, not only the link around them.
            ![brand, ...(brand ? brand.querySelectorAll("span") : []),
              ...sr.querySelectorAll(".compact-title, .cid-text")]
                .some((el) => el && el.scrollWidth > el.clientWidth + 1) &&
                (!context || context.scrollWidth <= context.clientWidth + 1);
        };

        const over = [];
        if (customElements.get("sac-menu") && !fits()) {
            more.hidden = false;
            const visible = items.filter((el) => el.getClientRects().length > 0);
            for (let i = visible.length - 1; i >= 0 && !fits(); i--) {
                visible[i].setAttribute("data-sac-overflow", "");
                over.unshift(visible[i]);
            }
            if (!over.length) more.hidden = true;
        }
        this._overflowed = over;

        more.querySelectorAll("[data-action]").forEach((n) => n.remove());
        over.forEach((el, i) => {
            const b = document.createElement("button");
            b.type = "button";
            b.dataset.action = String(i);
            if (el.disabled || el.getAttribute("aria-disabled") === "true") b.disabled = true;
            const icon = el.querySelector("sac-icon");
            const avatar = el.querySelector("sac-avatar");
            const svg = el.querySelector("svg");
            if (icon) {
                const ic = document.createElement("sac-icon");
                ic.setAttribute("name", icon.getAttribute("name") || "");
                b.appendChild(ic);
            } else if (avatar) {
                b.appendChild(avatar.cloneNode(true));
            } else if (svg) {
                b.appendChild(svg.cloneNode(true));
            }
            const label = el.textContent.trim() || el.getAttribute("aria-label") || el.title || "";
            b.appendChild(document.createTextNode(label));
            more.appendChild(b);
        });
    }

    attachPersistentHandlers() {
        this._escHandler = (e) => {
            if (e.key === "Escape" && (this.isOpen || this._drawerOpen)) this._closeAll();
        };
        document.addEventListener("keydown", this._escHandler);
        // Swipe-left closes the panel too (the rail carries its own listeners).
        this.addEventListener("touchstart", this._swipeStart, { passive: true });
        this.addEventListener("touchend", this._swipeEnd, { passive: true });

        // These three handlers re-render the whole panel, deliberately: unlike
        // the form components (which update in place to protect a live drag),
        // nothing the nav holds is lost by a rebuild, and its content is
        // genuinely structural — the app's own sections nest UNDER the active
        // host entry, so switching app or scope RELOCATES that subtree, not
        // just an .active class. A full render is the simple, correct model
        // here; an in-place diff would be more code and more risk for no gain.
        //
        // Navigation also closes the panel. Without this, leaving through a
        // ribbon link or back/forward parks the panel open behind a hidden view
        // (sac.apps keeps swapped-out views in the DOM), and it greets the user
        // already open on their return.
        this._hashHandler = () => { this._closeAll(); this.isOpen = false; this.render(); };
        window.addEventListener("hashchange", this._hashHandler);

        // Re-render when a new route registers so the panel fills in even if
        // view scripts run after the nav's first render.
        this._routeHandler = () => this.render();
        window.addEventListener("sac:route-registered", this._routeHandler);

        // Scope switch: hrefs pick up the new prefix, active-state moves.
        this._scopeHandler = () => this.render();
        window.addEventListener("sac:scope-changed", this._scopeHandler);

        // The host re-declared its package after mount (e.g. the signed-in user
        // was renamed). sac.apps mutated context.host — the very object held as
        // this._host — in place and fired this event, so re-reading it repaints
        // the ⌂ jump, the suite nav and the host toolbar. No app cooperation:
        // the app handed its nav the host by reference and never touches it again.
        this._hostChangedHandler = () => {
            this._syncHostTools();
            if (this.shadowRoot.firstChild) this.render();
        };
        document.addEventListener("sac:host-changed", this._hostChangedHandler);
    }
}

customElements.define("sac-nav", SacNav);
})();
