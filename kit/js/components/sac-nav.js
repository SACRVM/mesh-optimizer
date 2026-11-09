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
 *   app-icon   — sac.icons name rendered before app-name, in accent: a suite
 *                whose pages are its apps reads exactly like a host showing a
 *                hosted app. Unhosted, the phone ribbon shows it instead of
 *                brand-icon, since the name there is the app's.
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
 *   setOverflowGroup(owner, entries) — lets ANY element contribute a group
 *          of entries to the "…" menu (see TOOLBAR OVERFLOW). `owner` is the
 *          key (normally the contributing element itself); `entries` is
 *          [{ label, icon?, disabled?, danger?, run(event) }] — `run` gets
 *          the menu's sac:select event. Pass null or [] to withdraw the
 *          group. Re-call it to relabel (e.g. on a language switch). A group
 *          whose owner element has left the DOM is dropped on the next
 *          layout. <sac-shortcut-bar> uses this to fold into the nav on
 *          compact.
 *
 * Events:
 *   sac:nav-open / sac:nav-close — detail { drawer } — the burger's panel
 *          and/or rail drawer came out / went away. Bubbles + composed.
 *
 * Focus (2.36): the burger's panel is modal, as the rail drawer is, at every
 *   width — opening it moves focus onto the panel itself (no field, so no
 *   phone keyboard; the panel is labelled "Menu"), everything outside the
 *   nav turns inert (layers above the open menu — dialogs, tooltips, toasts
 *   — stay live; what was inert already is left alone), and closing it
 *   (Escape, the scrim, an entry, the burger, a swipe) hands focus back to
 *   the burger when it was in the panel or nowhere. The entry for where you
 *   are carries aria-current="page" — a suite entry whose own section is
 *   the current one gets "true" (it contains the page).
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
 *     Escape, swipe-left-to-close (a finger or a pen; panel, rail and scrim
 *     follow it 1:1, then a spring finishes the close or puts it back),
 *     closing on a link tap (a .sidebar closes
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
 * level inside a wrapper element), the host tools, and a <sac-menu> there —
 * folded as ONE item: its entries join the "…" menu as a group (after a
 * separator), and choosing one fires the original menu's sac:select, so the
 * app's listener runs unchanged. Mark a control data-overflow="never" to
 * keep it in the ribbon. Groups contributed with setOverflowGroup() follow
 * the folded controls, each behind a separator, in contribution order; while
 * one has entries the "…" shows at every width. Needs sac-menu loaded;
 * without it nothing overflows.
 *
 * TITLE BAR (an installed app that hands the window's title bar to the
 * page): the nav IS the window's title bar. It sets [titlebar] on itself and
 * follows the browser — the person switches the overlay on and off there:
 *   - titlebar="overlay" — (display-mode: window-controls-overlay), from the
 *     manifest's "display_override": ["window-controls-overlay"]. The
 *     browser draws its minimise / maximise / close buttons over one corner
 *     (right on Windows and Linux, left on macOS); the ribbon keeps that
 *     corner clear (env(titlebar-area-*)), and the browser paints the
 *     buttons on the ribbon's own colour: while the overlay is on, the nav
 *     keeps a <meta name="theme-color"> of its own first in <head>, on the
 *     theme the kit's flag picked. It goes when the overlay does; the
 *     page's own theme-color metas are never touched.
 *   - titlebar="own" — (display-mode: borderless): the browser draws no
 *     window buttons, so the nav does — <sac-window>'s three traffic lights
 *     at the right end, in the theme's --accent-warm / --ok / --danger, with
 *     <sac-window>'s glyphs (− / maximise-restore / ×: shown on hover and
 *     keyboard focus, always on touch and under more contrast). Each
 *     one only where the browser lets a page do it (a control that does
 *     nothing is never rendered): minimise and maximise need
 *     window.minimize() / maximize() (Additional Windowing Controls, with
 *     the window-management permission); close is window.close().
 *   Both: the ribbon's free space moves the window (app-region: drag — a
 *   double-click maximises, the browser's own behaviour), and every control
 *   in it stays a control (no-drag: the burger, the brand and home links,
 *   the slotted context / toolbar / host tools, the "…", the window
 *   buttons). Height, panel and compact layout stay as they are. Only the
 *   top window's nav: one in a frame is not at the window's edge.
 *
 * Layout contract: content below needs padding-top: 50px plus the top safe
 * area (#app-root and .main-layout in ui.css do this).
 */
(function () {

    /** Kit i18n: sac.t when globals.js is loaded, the English fallback when
     *  the component runs standalone. */
    /** sac.motion when lib/motion.js is loaded; without it the drawer
     *  still closes on a swipe, only it does not follow the finger. */
    const motion = () => (window.sac && window.sac.motion) || null;

    const t = (key, fallback) =>
        (window.sac && window.sac.t) ? window.sac.t(key, fallback) : fallback;

    /** The nav's own strings — English fallbacks. Rendered nodes carry their
     *  key (data-i18n → text, data-i18n-label → aria-label, data-i18n-title
     *  → title) so a language switch rewrites them in place. */
    const STRINGS = {
        "nav.home":        "Home",
        "nav.host":        "Host",
        "nav.menu":        "Menu",
        "nav.more":        "More",
        "nav.no-sections": "No sections yet.",
        // The own window buttons (TITLE BAR) — <sac-window>'s keys.
        "window.minimize": "Minimize",
        "window.maximize": "Maximize",
        "window.restore":  "Restore",
        "window.close":    "Close",
    };
    const str = (key) => t(key, STRINGS[key]);

    /** The own window buttons' glyphs (TITLE BAR, own) — <sac-window>'s:
     *  minimise −, maximise ↖↘ / restore ↘↖ (two triangles), close ×. */
    const GLYPH = {
        min:   `<svg class="glyph" viewBox="0 0 9 9" aria-hidden="true" focusable="false"><path d="M1.5 4.5h6"/></svg>`,
        max:   `<svg class="glyph" viewBox="0 0 9 9" aria-hidden="true" focusable="false"><path class="g-fill g-max" d="M1.5 1.5h3.6L1.5 5.1zM7.5 7.5H3.9L7.5 3.9z"/><path class="g-fill g-restore" d="M4 4H.9L4 .9zM5 5h3.1L5 8.1z"/></svg>`,
        close: `<svg class="glyph" viewBox="0 0 9 9" aria-hidden="true" focusable="false"><path d="M2 2l5 5M7 2L2 7"/></svg>`,
    };

    /**
     * The colour the browser paints its window buttons on (TITLE BAR,
     * overlay): ONE <meta name="theme-color"> the kit owns, first in <head>
     * so it wins over the page's own (left as they are), on the ribbon's
     * colour. Held while any nav is the overlay's title bar; repainted when
     * the theme flag (data-theme), an inline theme or the OS scheme changes.
     */
    const themeColor = {
        navs: new Set(),
        meta: null,
        mo: null,
        mq: null,
        again: null,
        sync(nav, on) {
            if (on) this.navs.add(nav);
            else this.navs.delete(nav);
            if (!this.navs.size) return this.stop();
            if (!this.mo) {
                this.again = () => requestAnimationFrame(() => this.paint());
                this.mo = new MutationObserver(this.again);
                this.mo.observe(document.documentElement,
                    { attributes: true, attributeFilter: ["data-theme", "style", "class"] });
                this.mq = window.matchMedia("(prefers-color-scheme: light)");
                this.mq.addEventListener("change", this.again);
            }
            this.paint();
        },
        stop() {
            this.mo?.disconnect();
            this.mq?.removeEventListener("change", this.again);
            this.mo = this.mq = null;
            this.meta?.remove();
            this.meta = null;
        },
        paint() {
            const nav = this.navs.values().next().value;
            const color = nav && nav._ribbonColor();
            if (!color) return;
            if (!this.meta) {
                this.meta = document.createElement("meta");
                this.meta.name = "theme-color";
                this.meta.dataset.sacTitlebar = "";
                const first = document.head.querySelector('meta[name="theme-color"]');
                document.head.insertBefore(this.meta, first);
            }
            this.meta.content = color;
        },
    };

class SacNav extends HTMLElement {
    static get observedAttributes() { return ["brand", "brand-icon", "brand-href", "app-name", "app-icon", "host-href", "host-label", "host-icon", "host-nav", "sections-nav", "rail", "compact-title"]; }

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
        this._groups = new Map();     // setOverflowGroup(): owner → entries
    }

    /** Contribute (or withdraw, with null / []) a group of "…" menu entries.
     *  See the header, Methods. */
    setOverflowGroup(owner, entries) {
        if (owner == null) return;
        const list = Array.isArray(entries) ? entries.filter((e) => e && typeof e.run === "function") : [];
        if (list.length) this._groups.set(owner, list);
        else this._groups.delete(owner);
        this._scheduleOverflow();
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
        // TITLE BAR: before the first render, so it already has the window
        // buttons. Watched — the person switches the overlay on and off,
        // and the maximise dot names what it does now.
        this._tbMqs = [SacNav.OVERLAY, SacNav.BORDERLESS, SacNav.MAXIMIZED].map((q) => window.matchMedia(q));
        this._tbHandler = () => this._syncTitlebar();
        this._tbMqs.forEach((m) => m.addEventListener("change", this._tbHandler));
        this._syncTitlebar();
        this._mq = window.matchMedia(SacNav.COMPACT);
        this._mqHandler = () => {
            if (!this._mq.matches) this._setDrawer(false);
            this.render();
        };
        this._mq.addEventListener("change", this._mqHandler);
        // Toolbar overflow follows the nav's real width and its content.
        this._ro = new ResizeObserver(() => this._scheduleOverflow());
        this._ro.observe(this);
        // The toolbar grows after the first layout — icons upgrade, a menu
        // trigger renders, web fonts arrive — while the nav keeps its width.
        // Measure again once the fonts are in; the toolbar itself is observed
        // in _layoutOverflow().
        if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => this._scheduleOverflow());
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
        if (window.sac && sac.lang && !this._offLang) this._offLang = sac.lang.onChange(() => this._relabel());
    }

    /**
     * Language switch: the nav's own strings, in place — no render(), so an
     * open panel or drawer, the "…" menu, focus and the overflow layout all
     * survive. Host, brand, route and section labels are the app's / host's.
     */
    _relabel() {
        const sr = this.shadowRoot;
        sr.querySelectorAll("[data-i18n]").forEach((el) => { el.textContent = str(el.dataset.i18n); });
        sr.querySelectorAll("[data-i18n-label]").forEach((el) => el.setAttribute("aria-label", str(el.dataset.i18nLabel)));
        sr.querySelectorAll("[data-i18n-title]").forEach((el) => el.setAttribute("title", str(el.dataset.i18nTitle)));
        this._labelWinMax();
        // A shorter or longer label can change what fits in the ribbon.
        this._scheduleOverflow();
    }

    attributeChangedCallback() {
        // Hosted apps copy context.host in during mount(), after connect.
        if (this.shadowRoot.firstChild) this.render();
    }

    disconnectedCallback() {
        if (this._offLang) { this._offLang(); this._offLang = null; }
        if (this._escHandler)   document.removeEventListener("keydown", this._escHandler);
        if (this._hashHandler)  window.removeEventListener("hashchange", this._hashHandler);
        if (this._routeHandler) {
            window.removeEventListener("sac:route-registered", this._routeHandler);
            window.removeEventListener("sac:route-unregistered", this._routeHandler);
        }
        if (this._scopeHandler) window.removeEventListener("sac:scope-changed", this._scopeHandler);
        if (this._hostChangedHandler) document.removeEventListener("sac:host-changed", this._hostChangedHandler);
        this._mq?.removeEventListener("change", this._mqHandler);
        this._tbMqs?.forEach((m) => m.removeEventListener("change", this._tbHandler));
        themeColor.sync(this, false);
        this._dprMq?.removeEventListener("change", this._dprHandler);
        this._dprMq = null;
        this._ro?.disconnect();
        this._mo?.disconnect();
        cancelAnimationFrame(this._overflowFrame);
        this._setDrawer(false);
        this._releaseRail();
        // Removed with the panel out: give the page back.
        this._setInert(false);
    }

    render() {
        const brand     = this.getAttribute("brand") || "";
        const brandIcon = this.getAttribute("brand-icon") || "";
        const brandHref = this.getAttribute("brand-href") || "#/";
        const appName   = this.getAttribute("app-name") || "";
        const appIcon   = appName ? (this.getAttribute("app-icon") || "") : "";
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
        // Unhosted, the phone's name is the app's, so its icon is too.
        const cidIcon = (!hostHref && appIcon) || brandIcon;
        const panelHostNav  = hideHost ? [] : hostNav;
        const hasSlotted = !!this.querySelector(':scope > [slot="panel"]');
        this._hasSlotted = hasSlotted;

        const routes = (window.sac?.router?.routes() || []).filter(r => r.hash !== "#/")
            // nav: false — a route the host lists its own way (sac.router.register).
            .filter(r => r.nav !== false)
            // A route bound to one kind of workspace (scope: "root"/"scoped")
            // is left out of the other — re-checked on sac:scope-changed.
            .filter(r => !sac.router.inScope || sac.router.inScope(r))
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
        // TITLE BAR, own: the window buttons the browser lets a page drive.
        const own    = this.getAttribute("titlebar") === "own";
        const canMin = own && typeof window.minimize === "function";
        const canMax = own && typeof window.maximize === "function";

        // Kit strings: attribute position gets quote-escaping, the empty
        // state is a text node and gets &/< escaping instead.
        const esc = (s) => String(s).replace(/"/g, "&quot;");
        const escText = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;");
        const L = {
            menu:       esc(str("nav.menu")),
            home:       esc(str("nav.home")),
            more:       esc(str("nav.more")),
            noSections: escText(str("nav.no-sections")),
            minimize:   esc(str("window.minimize")),
            close:      esc(str("window.close")),
        };
        // A kit default (not the host's own label) carries its key for _relabel().
        const keyTitle = hostLabel ? `` : ` data-i18n-title="nav.home"`;
        const keyText  = (key) => hostLabel ? `` : ` data-i18n="${key}"`;
        // The entry for where you are says so to assistive tech too. The
        // suite entry whose own section is the current one is "true" (it
        // contains the page) — "page" belongs to one entry only.
        const cur = (on, kind = "page") => on ? ` aria-current="${kind}"` : ``;

        // A re-render replaces every node: focus on the burger or inside the
        // open panel would fall to <body>. Note where it was, put it back.
        const had = this.shadowRoot.activeElement;
        const refocus = !had ? null : had.classList.contains("menu-btn") ? "burger"
            : had.closest(".panel") ? "panel" : null;

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
                    /* The corner under the browser's window buttons (TITLE
                       BAR, overlay) — none anywhere else. */
                    --tb-left: 0px;
                    --tb-right: 0px;
                    height: 50px;
                    display: flex;
                    align-items: center;
                    padding: 0 1rem;
                    /* content-box: the notch inset adds to the 50px. */
                    padding-top: env(safe-area-inset-top, 0px);
                    padding-left: calc(1rem + env(safe-area-inset-left, 0px) + var(--tb-left));
                    padding-right: calc(1rem + env(safe-area-inset-right, 0px) + var(--tb-right));
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
                    gap: var(--bar-gap, 4px);
                    padding: 0;
                    flex: none;
                }
                .menu-btn:hover { background: var(--hover); }
                /* Press: answers the moment it goes down. */
                .menu-btn:active { background: var(--hover-strong); transition-duration: 0s; }
                .menu-btn:focus-visible,
                .more-btn:focus-visible {
                    outline: 2px solid var(--accent);
                    outline-offset: 2px;
                }
                /* Thickness and gap are whole device pixels (_snapBurger): at
                   125% / 175% a 2px line is 2.5 device pixels, and the
                   half-lit row fell above one line and below the next —
                   three lines, three thicknesses. On the device grid the
                   three share one offset, so they rasterize alike. */
                .menu-btn span {
                    display: block;
                    width: 18px;
                    height: var(--bar-h, 2px);
                    background: var(--text);
                    border-radius: var(--radius-s);
                    /* Not "all": the snapped size and shift must not animate. */
                    transition: transform 0.3s ease, opacity 0.3s ease;
                }
                .menu-btn.active span:nth-child(1) { transform: translateY(var(--bar-pitch, 6px)) rotate(45deg); }
                .menu-btn.active span:nth-child(2) { opacity: 0; }
                .menu-btn.active span:nth-child(3) { transform: translateY(calc(-1 * var(--bar-pitch, 6px))) rotate(-45deg); }
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
                /* An app segment with its own icon sits as far from the brand
                   as a hosted app from its host (.host-jump: 0.9rem). */
                .brand .app-mark { margin-left: 0.4rem; }

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
                .more-btn:active { background: var(--hover-strong); transition-duration: 0s; }

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
                    /* Scrolls up and down natively; a sideways finger is the
                       swipe-to-close (see _swipeStart). */
                    touch-action: pan-y pinch-zoom;
                    z-index: 2;
                    padding: 1.5rem 0;
                    overflow-y: auto;
                }
                /* Scrollbar — the kit recipe (ui.css §5), re-stated because
                   ::-webkit-scrollbar does not pierce a shadow root. Firefox, which has
                   no ::-webkit-scrollbar, gets the standard pair instead. */
                .panel::-webkit-scrollbar { width: var(--scrollbar-size); height: var(--scrollbar-size); }
                .panel::-webkit-scrollbar-track { background: transparent; }
                .panel::-webkit-scrollbar-thumb {
                    background: var(--scrollbar-thumb);
                    background-clip: content-box;
                    border: var(--scrollbar-gap) solid transparent;
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
                    /* Visible at once on the way in (it is off-screen until
                       the slide brings it): focus moves onto it in the same
                       task, and a visibility transition would still read
                       "hidden" there. Closing keeps the 0.5s delay above. */
                    transition: transform 0.5s var(--ease-swift), visibility 0s;
                }
                /* Focus lands on the panel itself when it opens (no field,
                   so no phone keyboard): a container, no ring. */
                .panel:focus { outline: none; }
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
                .panel.rail-look .nav-item:active:not(.active) { background: var(--hover-strong); transition-duration: 0s; }
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
                .nav-item:active:not(.active) { background: var(--hover-strong); transition-duration: 0s; }
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

                /* TITLE BAR (see the header): the free space moves the
                   window, every control stays a control. */
                :host([titlebar]) .ribbon { -webkit-app-region: drag; app-region: drag; }
                :host([titlebar]) .menu-btn,
                :host([titlebar]) .brand,
                :host([titlebar]) .compact-id a,
                :host([titlebar]) .more,
                :host([titlebar]) .win-ctrls,
                :host([titlebar]) ::slotted(*) { -webkit-app-region: no-drag; app-region: no-drag; }
                /* Overlay: nothing under the browser's window buttons — the
                   titlebar area is what the page may use, left and right of
                   it are the buttons (macOS left, Windows / Linux right). */
                :host([titlebar="overlay"]) .ribbon {
                    --tb-left: env(titlebar-area-x, 0px);
                    --tb-right: calc(100vw - env(titlebar-area-x, 0px) - env(titlebar-area-width, 100vw));
                }
                /* Own: <sac-window>'s traffic lights, the same recipe —
                   colour carries the meaning, title/aria-label the words. */
                .win-ctrls {
                    flex: none;
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    margin-left: 0.75rem;
                }
                .win-btn {
                    --btn-color: var(--danger);
                    width: 15px;
                    height: 15px;
                    border-radius: 50%;
                    background: var(--btn-color);
                    cursor: pointer;
                    border: none;
                    padding: 0;
                    transition: transform 0.2s, background 0.2s;
                    position: relative;
                }
                .win-btn:hover {
                    transform: scale(1.1);
                    background: color-mix(in oklab, var(--btn-color) 80%, var(--lift));
                }
                .win-btn:active { transform: scale(0.97); transition-duration: 0.1s; }
                .win-btn:focus-visible {
                    outline: 2px solid var(--accent);
                    outline-offset: 2px;
                }
                .win-btn.min-btn { --btn-color: var(--accent-warm); }
                .win-btn.max-btn { --btn-color: var(--ok); }
                .win-btn.close-btn { --btn-color: var(--danger); }
                /* Glyphs in the dots (<sac-window>'s recipe): shown while the
                   group is hovered or keyboard-focused, always on touch and
                   under more contrast — colour never carries the meaning
                   alone. Ink = the dot's own colour sunk dark (the kit's
                   --on-warm / --on-ok recipe), so every theme follows. */
                .win-btn { --glyph-ink: color-mix(in srgb, var(--sink) 62%, var(--btn-color)); }
                .win-btn .glyph {
                    position: absolute;
                    left: 20%;
                    top: 20%;
                    width: 60%;
                    height: 60%;
                    fill: none;
                    stroke: var(--glyph-ink);
                    stroke-width: 1.25;
                    stroke-linecap: round;
                    opacity: 0;
                    transition: opacity 0.12s var(--ease-smooth);
                    pointer-events: none;
                }
                .win-btn .glyph .g-fill { fill: var(--glyph-ink); stroke: none; }
                .win-btn .g-restore,
                .win-btn.restore .g-max { display: none; }
                .win-btn.restore .g-restore { display: inline; }
                .win-ctrls:hover .glyph { opacity: 1; }
                .win-ctrls:has(:focus-visible) .glyph { opacity: 1; }
                .ground-probe { background-color: var(--bg); }

                @media (max-width: 768px), (max-height: 480px) and (pointer: coarse) {
                    .ribbon {
                        padding-left: calc(0.5rem + env(safe-area-inset-left, 0px) + var(--tb-left));
                        padding-right: calc(0.5rem + env(safe-area-inset-right, 0px) + var(--tb-right));
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
                        right: calc(0.5rem + env(safe-area-inset-right, 0px) + var(--tb-right));
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
                    /* <sac-window>'s touch dots: 20px, 24px apart, halos meet. */
                    .win-ctrls { gap: 24px; }
                    .win-btn { width: 20px; height: 20px; }
                    .win-btn::after { content: ''; position: absolute; inset: -12px; }
                }
                @media (hover: none) {
                    .menu-btn:hover, .more-btn:hover { background: none; }
                    .win-btn:hover { transform: none; background: var(--btn-color); }
                    .win-btn .glyph { opacity: 1; }
                    /* …but the press itself still shows (a touch is a hover too). */
                    .menu-btn:active, .more-btn:active { background: var(--hover-strong); }
                    .win-btn:active { transform: scale(0.97); }
                }
                @media (prefers-reduced-motion: reduce) {
                    .menu-btn span, .backdrop, .panel, .more-btn, .right,
                    .cid-home, .cid-icon, .win-btn, .win-btn .glyph { transition: none !important; }
                    .win-btn:hover { transform: none; }
                }
                /* Reduced transparency / more contrast: the blurred ribbon and
                   panel turn solid (same hue), the edge a clearly visible line. */
                @media (prefers-reduced-transparency: reduce) {
                    .ribbon,
                    .panel { background: var(--glass-solid); backdrop-filter: none; -webkit-backdrop-filter: none; }
                }
                @media (prefers-contrast: more) {
                    .ribbon,
                    .panel { background: var(--glass-solid); backdrop-filter: none; -webkit-backdrop-filter: none; }
                    .ribbon { border-bottom-color: var(--border-contrast); }
                    .panel { border-right-color: var(--border-contrast); }
                    .win-btn .glyph { opacity: 1; }
                }
            </style>
            <nav class="ribbon${titled ? " titled" : ""}">
                ${showBurger ? `
                <button class="menu-btn" aria-label="${L.menu}" data-i18n-label="nav.menu" aria-expanded="false">
                    <span></span><span></span><span></span>
                </button>` : ``}
                ${hostHref ? `
                <a class="brand host-jump" href="${hostHref.replace(/"/g, "&quot;")}"
                   title="${esc(hostLabel || L.home)}"${keyTitle}>
                    <span class="brand-mark"><sac-icon name="${hostIcon}"></sac-icon></span>
                    ${hostLabel ? `<span class="host-label">${hostLabel}</span>` : ``}
                </a>` : ``}
                <a class="brand${brandIcon ? " has-icon" : ""}" href="${hrefFor(brandHref)}">
                    ${brandIcon ? `<span class="brand-mark"><sac-icon name="${brandIcon}"></sac-icon></span>` : ``}
                    ${brand ? `<span class="brand-text${hostHref ? " app-name" : ""}">${brand}</span>` : ``}
                    ${appIcon ? `<span class="brand-mark app-mark"><sac-icon name="${esc(appIcon)}"></sac-icon></span>` : ``}
                    ${appName ? `<span class="app-name">${appName}</span>` : ``}
                </a>
                ${compactTitle ? `
                <div class="compact-id">
                    ${hostHref ? `
                    <a class="cid-home" href="${esc(hostHref)}" title="${esc(hostLabel || L.home)}"${keyTitle}><sac-icon name="${esc(hostIcon)}"></sac-icon><span class="cid-home-label"${keyText("nav.home")}>${escText(hostLabel || str("nav.home"))}</span></a>` : ``}
                    <a class="compact-title${titleAccent ? " app-name" : ""}" href="${hrefFor(brandHref)}">
                        ${cidIcon ? `<span class="cid-icon"><sac-icon name="${esc(cidIcon)}"></sac-icon></span>` : ``}
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
                    <button slot="trigger" class="more-btn" type="button" aria-label="${L.more}" title="${L.more}" data-i18n-label="nav.more" data-i18n-title="nav.more">
                        <sac-icon name="more"></sac-icon>
                    </button>
                </sac-menu>
                </div>
                ${own ? `
                <!-- The window's own buttons (TITLE BAR, own) — they stay
                     put while the controls slide out on compact. -->
                <div class="win-ctrls">
                    ${canMin ? `<button class="win-btn min-btn" type="button" data-win="min" title="${L.minimize}" aria-label="${L.minimize}" data-i18n-label="window.minimize" data-i18n-title="window.minimize">${GLYPH.min}</button>` : ``}
                    ${canMax ? `<button class="win-btn max-btn" type="button" data-win="max">${GLYPH.max}</button>` : ``}
                    <button class="win-btn close-btn" type="button" data-win="close" title="${L.close}" aria-label="${L.close}" data-i18n-label="window.close" data-i18n-title="window.close">${GLYPH.close}</button>
                </div>` : ``}
            </nav>
            <div class="backdrop"></div>
            <span class="ground-probe" hidden></span>
            <aside class="panel${compact ? " rail-look" : ""}" tabindex="-1" aria-label="${L.menu}" data-i18n-label="nav.menu">
                <!-- The app's own panel content (any use: filters, account,
                     settings…) — first, above the navigation groups. -->
                <div class="panel-slot"><slot name="panel"></slot></div>
                ${(panelHostHref || panelHostNav.length) ? `
                <div class="panel-label"${keyText("nav.host")}>${escText(hostLabel || str("nav.host"))}</div>
                <ul class="nav-list">
                    ${panelHostHref ? `
                    <li>
                        <!-- The way back to the host lives in the burger too, not
                             only in the ribbon ⌂ — the menu is the place you look
                             to navigate, so the suite's home belongs at the top of
                             its own group. Same data the ribbon jump already has. -->
                        <a class="nav-item ${isActiveHref(panelHostHref) ? "active" : ""}" href="${esc(panelHostHref)}"${cur(isActiveHref(panelHostHref))}>
                            <sac-icon name="${esc(hostIcon)}"></sac-icon>
                            <span data-i18n="nav.home">${escText(str("nav.home"))}</span>
                        </a>
                    </li>` : ``}
                    ${panelHostNav.map(e => {
                        // The entry addressing the running app carries the
                        // app's own sections as an indented subtree.
                        const self = isActiveHref(e.href);
                        const inSection = self && sections.some(s => isActiveHref(s.href));
                        return `
                        <li>
                            <a class="nav-item ${self ? "active" : ""}" href="${esc(hrefFor(e.href))}"${cur(self, inSection ? "true" : "page")}>
                                ${e.icon ? `<sac-icon name="${esc(e.icon)}"></sac-icon>` : ""}
                                <span>${escText(e.label)}</span>
                            </a>
                            ${self && sections.length ? `
                            <ul class="sub-list">
                                ${sections.map(s => `
                                    <li>
                                        <a class="nav-item ${isActiveHref(s.href) ? "active" : ""}" href="${esc(hrefFor(s.href))}"${cur(isActiveHref(s.href))}>
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
                    ? ((panelHostHref || panelHostNav.length || sections.length || hasSlotted || compact) ? `` : `<div class="panel-empty" data-i18n="nav.no-sections">${L.noSections}</div>`)
                    : `<ul class="nav-list">
                         ${routes.map(r => `
                             <li>
                                 <a class="nav-item ${!r.open && isActive(r) ? "active" : ""}" href="${esc(hrefFor(r.hash))}"${r.open ? ` data-open-route="${esc(r.hash)}"` : ""}${cur(!r.open && isActive(r))}>
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
                            <a class="nav-item ${isActiveHref(s.href) ? "active" : ""}" href="${esc(hrefFor(s.href))}"${cur(isActiveHref(s.href))}>
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
        if (refocus) {
            const sr = this.shadowRoot;
            const to = refocus === "panel" && this.isOpen ? sr.querySelector(".panel") : sr.querySelector(".menu-btn");
            to?.focus({ preventScroll: true });
        }
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
            const was = this.isOpen;
            this.isOpen = open;
            panel.classList.toggle("open", open);
            // Panel mode (no rail drawer out): the menu is modal, as the
            // drawer is — focus goes into it, the page behind turns inert,
            // and on close focus comes back to the burger (when it was in
            // the panel, or nowhere: a tap on the scrim drops it on <body>).
            // Stacked over the drawer, _syncDrawer does all of this.
            if (open !== was && !this._drawerOpen) {
                if (open) {
                    this._setInert(true);
                    panel.focus({ preventScroll: true });
                } else {
                    const back = this._focusInPanelOrLost();
                    this._setInert(false);
                    if (back) menuBtn?.focus({ preventScroll: true });
                }
            }
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

        // TITLE BAR, own: the window buttons.
        this.shadowRoot.querySelectorAll(".win-btn").forEach((b) =>
            b.addEventListener("click", () => this._windowAction(b.dataset.win)));
        this._labelWinMax();
        // TITLE BAR, overlay: the first render is the first ribbon to read.
        if (this.getAttribute("titlebar") === "overlay") themeColor.paint();

        // The "…" toolbar overflow menu clicks the original control — or, for
        // an entry of a folded <sac-menu>, fires that menu's own sac:select.
        const more = this.shadowRoot.querySelector(".more");
        more.addEventListener("sac:select", (e) => {
            e.stopPropagation();
            const entry = this._moreEntries && this._moreEntries[Number(e.detail && e.detail.action)];
            if (entry && entry.run) {        // a setOverflowGroup() entry
                try { entry.run(e); }
                catch (err) { console.error("[sac-nav] overflow entry threw:", err); }
                return;
            }
            if (!entry || !entry.el.isConnected) return;
            if (entry.action == null) { entry.el.click(); return; }
            entry.el.dispatchEvent(new CustomEvent("sac:select", {
                detail: { action: entry.action }, bubbles: true, composed: true,
            }));
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
                // A route registered with `open` (a window app in the list):
                // run it instead of following the hash, which is only its key.
                if (el.dataset.openRoute) {
                    e.preventDefault();
                    // Close first: while the menu is out the page is inert,
                    // and a window open() focuses must not be inside it.
                    this._closeAll();
                    const route = (window.sac?.router?.routes() || []).find(r => r.hash === el.dataset.openRoute);
                    if (route && route.open) {
                        try { route.open(route); }
                        catch (err) { console.error("[sac-nav] a route's open() threw:", err); }
                    }
                    return;
                }
                const m = /[?&]app=([^&]+)/.exec(el.getAttribute("href") || "");
                const id = m && decodeURIComponent(m[1]);
                if (id && !e.defaultPrevented && e.button === 0 &&
                    !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey &&
                    window.sac?.apps?.get?.(id)) {
                    e.preventDefault();
                    this._closeAll();     // first: the window must not open into an inert page
                    Promise.resolve(sac.apps.open(id)).catch(() => {});
                    return;
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

    /* ------------------------------------------------ the window's title bar */

    static OVERLAY    = "(display-mode: window-controls-overlay)";
    static BORDERLESS = "(display-mode: borderless)";
    static MAXIMIZED  = "(display-state: maximized)";

    /** Which title bar the nav is (see TITLE BAR): "overlay", "own" or "". */
    _titlebarMode() {
        // A nav in a frame is not at the window's edge.
        if (window.top !== window) return "";
        if (window.matchMedia(SacNav.BORDERLESS).matches) return "own";
        if (window.matchMedia(SacNav.OVERLAY).matches) return "overlay";
        return "";
    }

    /** [titlebar] and what hangs on it: the own buttons, the theme-color. */
    _syncTitlebar() {
        const mode = this._titlebarMode();
        if (mode !== (this.getAttribute("titlebar") || "")) {
            if (mode) this.setAttribute("titlebar", mode);
            else this.removeAttribute("titlebar");
            if (this.shadowRoot.firstChild) this.render();
        }
        this._labelWinMax();
        themeColor.sync(this, mode === "overlay");
    }

    /** The maximise dot names what it does now — maximise, or restore. */
    _labelWinMax() {
        const btn = this.shadowRoot.querySelector('.win-btn[data-win="max"]');
        if (!btn) return;
        const maximized = window.matchMedia(SacNav.MAXIMIZED).matches;
        const label = str(maximized ? "window.restore" : "window.maximize");
        btn.setAttribute("aria-label", label);
        btn.setAttribute("title", label);
        btn.classList.toggle("restore", maximized);     // its glyph follows
    }

    /** An own window button. The browser may still refuse (no
     *  window-management permission; a window a script may not close). */
    _windowAction(what) {
        const refused = (err) => console.warn(`[sac-nav] the browser refused "${what}":`, err);
        try {
            const done = what === "min" ? window.minimize()
                : what === "max" ? (window.matchMedia(SacNav.MAXIMIZED).matches ? window.restore() : window.maximize())
                : window.close();
            if (done && typeof done.catch === "function") done.catch(refused);
        } catch (err) { refused(err); }
    }

    /** The ribbon as ONE opaque colour (for theme-color): its glass laid
     *  over the theme's ground, composited on a 1px canvas. */
    _ribbonColor() {
        const ribbon = this.shadowRoot.querySelector(".ribbon");
        const probe = this.shadowRoot.querySelector(".ground-probe");
        if (!ribbon || !probe) return "";
        if (!SacNav._px) {
            const c = document.createElement("canvas");
            c.width = c.height = 1;
            SacNav._px = c.getContext("2d", { willReadFrequently: true });
        }
        const g = SacNav._px;
        g.clearRect(0, 0, 1, 1);
        g.fillStyle = getComputedStyle(probe).backgroundColor;
        g.fillRect(0, 0, 1, 1);
        g.fillStyle = getComputedStyle(ribbon).backgroundColor;
        g.fillRect(0, 0, 1, 1);
        const [r, gr, b] = g.getImageData(0, 0, 1, 1).data;
        return "#" + [r, gr, b].map((v) => v.toString(16).padStart(2, "0")).join("");
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
        rail.addEventListener("pointerdown", this._swipeStart);
        rail.addEventListener("pointermove", this._swipeMove);
        rail.addEventListener("pointerup", this._swipeEnd);
        rail.addEventListener("pointercancel", this._swipeEnd);
    }

    _releaseRail() {
        const rail = this._rail;
        if (!rail) return;
        this._railMO?.disconnect();
        rail.removeEventListener("click", this._railClick);
        rail.removeEventListener("pointerdown", this._swipeStart);
        rail.removeEventListener("pointermove", this._swipeMove);
        rail.removeEventListener("pointerup", this._swipeEnd);
        rail.removeEventListener("pointercancel", this._swipeEnd);
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
            // In the rail, in the stacked panel, or nowhere (a tap on the
            // scrim drops focus on <body>): it goes back to the burger.
            const inside = (rail && (rail === document.activeElement || rail.contains(document.activeElement)))
                || this._focusInPanelOrLost();
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

    /** Focus trap: everything outside the nav (and the rail drawer, when it
     *  is out) turns inert while the menu is out — panel or drawer. What was
     *  inert already is left alone, and only what this set is given back.
     *  Layers above the open menu (dialogs, tooltips, toasts: z-index over
     *  19000) stay live: a dialog opened from the panel must answer. */
    _setInert(on) {
        this._inerted.forEach((el) => { el.inert = false; });
        this._inerted = [];
        if (!on) return;
        const keep = [this];
        if (this._drawerOpen && this._rail) keep.push(this._rail);
        for (const start of keep) {
            for (let node = start; node.parentElement && node !== document.body; node = node.parentElement) {
                for (const sib of node.parentElement.children) {
                    if (sib === node || sib.inert || /^(SCRIPT|STYLE|LINK|TEMPLATE)$/.test(sib.tagName)) continue;
                    if (keep.some((k) => sib === k || sib.contains(k))) continue;
                    if ((parseInt(getComputedStyle(sib).zIndex, 10) || 0) > 19000) continue;
                    sib.inert = true;
                    this._inerted.push(sib);
                }
            }
        }
    }

    /** Focus is in the panel (or the app's slotted panel content), or
     *  nowhere: closing must hand it back to the burger. Focus the user has
     *  put elsewhere (a ribbon control) stays where it is. */
    _focusInPanelOrLost() {
        const a = this.getRootNode().activeElement;
        if (!a) {
            const d = document.activeElement;
            return !d || d === document.body || d === document.documentElement;
        }
        if (a === document.body || a === document.documentElement) return true;
        if (a === this) {
            const s = this.shadowRoot.activeElement;
            return !s || !!s.closest(".panel");
        }
        return this.contains(a) && !!a.closest('[slot="panel"]');
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

    /* Swipe left to close — a finger or a pen, never from a control that
       drags, never from the scrim (a tap there closes anyway). After 10px
       that are clearly sideways the panel, the rail drawer and the scrim
       follow the finger 1:1 (resisting rightwards); let go and a spring
       closes it — when it was pushed past half its width or flicked shut —
       or puts it back. Caught again mid-flight, it carries on from there. */
    _swipeStart = (e) => {
        if (e.pointerType === "mouse" || this._swipe) return;
        if (!(this.isOpen || this._drawerOpen)) return;
        const path = e.composedPath();
        if (path.some((n) => n.classList?.contains("backdrop") && n.getRootNode() === this.shadowRoot)) return;
        // Never from a control that drags, nor from a surface that takes the
        // finger itself (touch-action: none — a canvas, a pan-zoom viewport).
        const drags = path.some((n) => n.nodeType === 1 && (n.matches(
            'input, textarea, select, [contenteditable]:not([contenteditable="false"]), ' +
            'sac-slider, [role="slider"], [role="separator"], [data-no-swipe]')
            || getComputedStyle(n).touchAction === "none"));
        if (drags) return;
        const caught = this._swipeSpring;
        if (caught) { caught.stop(); this._swipeSpring = null; }
        const m = motion();
        this._swipe = {
            id: e.pointerId, x0: e.clientX, y0: e.clientY,
            // Caught mid-flight: already sideways, carrying on from its offset.
            decided: !!caught, dx: caught ? this._swipeDx : 0, base: caught ? this._swipeDx : 0,
            track: m ? m.tracker() : null,
        };
    };
    _swipeMove = (e) => {
        const s = this._swipe;
        if (!s || e.pointerId !== s.id) return;
        const dx = e.clientX - s.x0, dy = e.clientY - s.y0;
        if (!s.decided) {
            if (Math.hypot(dx, dy) < 10) return;
            if (Math.abs(dx) <= Math.abs(dy) * 1.2) { this._swipe = null; return; }   // a scroll
            s.decided = true;
            s.x0 = e.clientX;            // from here on 1:1 — no jump by the slop
            if (motion()) this._holdDrawer(true);
        }
        const m = motion();
        if (!m) { s.dx = e.clientX - s.x0; return; }
        const raw = s.base + e.clientX - s.x0;
        s.dx = raw > 0 ? m.rubberband(raw, this._drawerWidth()) : raw;
        this._placeDrawer(s.dx);
        s.track.add(s.dx, e.timeStamp);
    };
    _swipeEnd = (e) => {
        const s = this._swipe;
        if (!s || e.pointerId !== s.id) return;
        this._swipe = null;
        if (!s.decided) return;
        const m = motion();
        if (!m) { if (s.dx < -60) this._closeAll(); return; }
        const w = this._drawerWidth();
        const v = e.type === "pointerup" ? s.track.velocity(e.timeStamp) : 0;
        const close = s.dx + m.project(v) < -w / 2;
        const spring = this._swipeSpring = m.spring({
            from: s.dx, to: close ? -1.1 * w : 0, velocity: v,
            damping: !close && Math.abs(v) > 400 ? 0.8 : 1,
            response: 0.3,
            onUpdate: (x) => this._placeDrawer(x),
            onDone: () => {
                if (this._swipeSpring !== spring) return;
                this._swipeSpring = null;
                if (close) this._closeAll();
                this._holdDrawer(false);
            },
        });
    };

    /** The width that is out: the panel's, the rail drawer's, the wider. */
    _drawerWidth() {
        const panel = this.shadowRoot.querySelector(".panel");
        return Math.max(this.isOpen && panel ? panel.offsetWidth : 0,
            this._drawerOpen && this._rail ? this._rail.offsetWidth : 0) || 300;
    }

    /** Take the panel, the rail and the scrim off their CSS transitions for
     *  a finger to move them (true), or hand them back to the stylesheet. */
    _holdDrawer(hold) {
        const els = [this.shadowRoot.querySelector(".panel"), this._rail,
            this.shadowRoot.querySelector(".backdrop")].filter(Boolean);
        for (const el of els) {
            el.style.transition = hold ? "none" : "";
            if (!hold) { el.style.transform = ""; el.style.translate = ""; el.style.opacity = ""; }
        }
        if (!hold) this._swipeDx = 0;
    }

    /** Everything that is out, dx px off its open place; the scrim fades
     *  with the distance. */
    _placeDrawer(dx) {
        this._swipeDx = dx;
        const panel = this.shadowRoot.querySelector(".panel");
        if (this.isOpen && panel) panel.style.transform = `translateX(${dx}px)`;
        if (this._drawerOpen && this._rail) this._rail.style.translate = `${dx}px 0`;
        const backdrop = this.shadowRoot.querySelector(".backdrop");
        if (backdrop) backdrop.style.opacity = String(Math.min(1, Math.max(0, 1 + dx / this._drawerWidth())));
    }

    /* ------------------------------------------------- toolbar overflow */

    _scheduleOverflow() {
        cancelAnimationFrame(this._overflowFrame);
        this._overflowFrame = requestAnimationFrame(() => { this._snapBurger(); this._layoutOverflow(); });
    }

    /** The burger's three lines on the device grid: thickness and gap
     *  rounded to whole device pixels, so every line sits the same fraction
     *  off a pixel row and the browser's paint snapping treats all three
     *  alike. Runs with every layout pass — a render, a resize, a browser
     *  zoom — and on a resolution change (a window moved to a screen with
     *  another scale). */
    _snapBurger() {
        const btn = this.shadowRoot.querySelector(".menu-btn");
        const dpr = window.devicePixelRatio || 1;
        if (this._dprMq?.dpr !== dpr) {
            this._dprMq?.removeEventListener("change", this._dprHandler);
            this._dprHandler = this._dprHandler || (() => this._scheduleOverflow());
            this._dprMq = window.matchMedia(`(resolution: ${dpr}dppx)`);
            this._dprMq.dpr = dpr;
            this._dprMq.addEventListener("change", this._dprHandler);
        }
        if (!btn) return;
        const dev = (css) => Math.max(1, Math.round(css * dpr)) / dpr;
        const h = dev(2), gap = dev(4);
        btn.style.setProperty("--bar-h", `${h}px`);
        btn.style.setProperty("--bar-gap", `${gap}px`);
        btn.style.setProperty("--bar-pitch", `${h + gap}px`);
    }

    /** Toolbar controls that may move into the "…" menu, in ribbon order. */
    _overflowCandidates() {
        const out = [];
        const isControl = (el) => el.matches("button, a[href], sac-menu");
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
        // Watch the toolbar's own boxes too: they change size without the nav
        // doing so. The observer settles — a re-run with the same outcome
        // leaves every box at the size it last reported.
        const slot = sr.querySelector('slot[name="toolbar"]');
        for (const el of [...(slot ? slot.assignedElements() : []),
                          ...this.querySelectorAll(':scope > [slot="host-tools"]')]) {
            if (!this._roWatched) this._roWatched = new WeakSet();
            if (this._ro && !this._roWatched.has(el)) { this._ro.observe(el); this._roWatched.add(el); }
        }
        // Contributed groups (setOverflowGroup) keep the "…" out on their own;
        // an owner element that left the DOM without withdrawing is dropped.
        this._groups.forEach((_, owner) => {
            if (owner instanceof Node && !owner.isConnected) this._groups.delete(owner);
        });
        const groups = customElements.get("sac-menu") ? [...this._groups.values()] : [];
        more.hidden = !groups.length;

        const brand = sr.querySelector(".brand:not(.host-jump)");
        const context = sr.querySelector(".context");
        // Measured on the ribbon's own children, not ribbon.scrollWidth: a
        // descendant's closed popover may still take layout and would count
        // as overflow.
        // Truncated = the text is really wider than its box. scrollWidth and
        // clientWidth are rounded integers, so a 1px difference is measured
        // exactly (text range vs. content box) instead of being tolerated —
        // a tolerated pixel still renders the ellipsis.
        const truncated = (el) => {
            if (!el || el.scrollWidth <= el.clientWidth) return false;
            if (el.scrollWidth > el.clientWidth + 1) return true;
            const range = document.createRange();
            range.selectNodeContents(el);
            const cs = getComputedStyle(el);
            const inner = el.getBoundingClientRect().width
                - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight)
                - parseFloat(cs.borderLeftWidth) - parseFloat(cs.borderRightWidth);
            return range.getBoundingClientRect().width > inner + 0.25;
        };
        const fits = () => {
            const box = ribbon.getBoundingClientRect();
            const limit = box.right - parseFloat(getComputedStyle(ribbon).paddingRight) + 1;
            const edge = Math.max(...[...ribbon.children].map((c) => c.getBoundingClientRect().right));
            return edge <= limit &&
            // The brand's text spans truncate on their own (ellipsis), so
            // measure them, not only the link around them.
            ![brand, ...(brand ? brand.querySelectorAll("span") : []),
              ...sr.querySelectorAll(".compact-title, .cid-text")]
                .some(truncated) &&
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
            if (!over.length && !groups.length) more.hidden = true;
        }
        this._overflowed = over;

        more.querySelectorAll("[data-action], hr").forEach((n) => n.remove());
        // One "…" entry per control; a folded <sac-menu> contributes its own
        // entries as a group behind a separator.
        const entries = [];
        const addButton = (src, label, disabled) => {
            const b = document.createElement("button");
            b.type = "button";
            b.dataset.action = String(entries.length - 1);
            if (disabled) b.disabled = true;
            const icon = src.querySelector("sac-icon");
            const avatar = src.querySelector("sac-avatar");
            const svg = src.querySelector("svg");
            if (icon) {
                const ic = document.createElement("sac-icon");
                ic.setAttribute("name", icon.getAttribute("name") || "");
                b.appendChild(ic);
            } else if (avatar) {
                b.appendChild(avatar.cloneNode(true));
            } else if (svg) {
                b.appendChild(svg.cloneNode(true));
            }
            b.appendChild(document.createTextNode(label));
            more.appendChild(b);
        };
        over.forEach((el) => {
            if (el.localName === "sac-menu") {
                const items = [...el.children].filter((c) =>
                    c.matches("button[data-action]:not([hidden])") && c.getAttribute("slot") !== "trigger");
                if (!items.length) return;
                if (more.querySelector("[data-action]")) more.appendChild(document.createElement("hr"));
                items.forEach((item) => {
                    entries.push({ el, action: item.dataset.action });
                    addButton(item, item.textContent.trim() || item.getAttribute("aria-label") || item.title || "",
                        item.disabled);
                });
                return;
            }
            entries.push({ el, action: null });
            addButton(el, el.textContent.trim() || el.getAttribute("aria-label") || el.title || "",
                el.disabled || el.getAttribute("aria-disabled") === "true");
        });
        // Contributed groups: each behind a separator, after the folded controls.
        groups.forEach((group) => {
            if (more.querySelector("[data-action]")) more.appendChild(document.createElement("hr"));
            group.forEach((g) => {
                entries.push({ run: g.run });
                const b = document.createElement("button");
                b.type = "button";
                b.dataset.action = String(entries.length - 1);
                if (g.disabled) b.disabled = true;
                if (g.danger) b.setAttribute("data-danger", "");
                if (g.icon) {
                    const ic = document.createElement("sac-icon");
                    ic.setAttribute("name", g.icon);
                    b.appendChild(ic);
                }
                b.appendChild(document.createTextNode(g.label == null ? "" : String(g.label)));
                more.appendChild(b);
            });
        });
        this._moreEntries = entries;
    }

    attachPersistentHandlers() {
        this._escHandler = (e) => {
            if (e.key === "Escape" && (this.isOpen || this._drawerOpen)) this._closeAll();
        };
        document.addEventListener("keydown", this._escHandler);
        // Swipe-left closes the panel too (the rail carries its own listeners).
        this.addEventListener("pointerdown", this._swipeStart);
        this.addEventListener("pointermove", this._swipeMove);
        this.addEventListener("pointerup", this._swipeEnd);
        this.addEventListener("pointercancel", this._swipeEnd);

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

        // Re-render when a route registers (or goes) so the panel follows
        // even when view scripts run after the nav's first render.
        this._routeHandler = () => this.render();
        window.addEventListener("sac:route-registered", this._routeHandler);
        window.addEventListener("sac:route-unregistered", this._routeHandler);

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
