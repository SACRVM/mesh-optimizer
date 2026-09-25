/**
 * <app-my-fullscreen-app> — a FULLSCREEN app (manifest kind: "view").
 *
 * The app is COMPLETE: it draws its own chrome — nav, rail, scrolling body.
 * Standalone it is its own host; index.html is just the page that loads it.
 * On a desktop, the host injects its presence through context.host and the
 * app copies it onto its own <sac-nav> — nothing else changes.
 *
 * It owns a sub-route: context.route in, context.deepLink.set() out,
 * context.onRoute() for the back button and pasted links.
 */
(function () {
    const BASE = sac.app.base();

    // Whatever your app's sections are. Two is enough to show the shape.
    const SECTIONS = [
        { id: "first",  label: "First",  icon: "star" },
        { id: "second", label: "Second", icon: "shapes" },
    ];

    class AppMyFullscreenApp extends sac.app.Element {
        build() {
            sac.app.styles(BASE + "app.css", "app-my-fullscreen-app-css");
            // The app's own chrome. The rail is the app's table of contents;
            // sliders and colour fields stay in the content area — they are
            // not navigation. On a phone the nav adopts the rail (the first
            // <sac-sidebar> inside .main-layout) and its burger opens it as a
            // drawer that closes on an item tap — nothing to wire.
            this.innerHTML = `
                <sac-nav brand="MY FULLSCREEN APP" brand-icon="cube">
                    <div slot="context"><sac-theme-toggle></sac-theme-toggle></div>
                </sac-nav>
                <div class="main-layout">
                    <sac-sidebar></sac-sidebar>
                    <div class="app-scroll"><div class="page"></div></div>
                </div>`;
            this._nav  = this.querySelector("sac-nav");
            this._rail = this.querySelector("sac-sidebar");
            this._page = this.querySelector(".page");
        }

        onMount(context) {
            this._ctx = context;
            // The brand links to the app's own root — wherever that is.
            this._nav.setAttribute("brand-href", context.href(""));
            // The host's injection — jump-home, the suite's nav (burger
            // panel) and its toolbar controls (right end of the ribbon),
            // all rendered by the app's own nav. Standalone context.host
            // is null and the nav shows none of it.
            this._nav.host = context.host;
            this._show(context.route || SECTIONS[0].id);
            // Rail clicks, the back button and pasted URLs all arrive here.
            this._offRoute = context.onRoute((route) => this._show(route || SECTIONS[0].id));
        }

        onUnmount() {
            if (this._offRoute) { this._offRoute(); this._offRoute = null; }
        }

        _show(id) {
            const section = SECTIONS.find((s) => s.id === id) || SECTIONS[0];

            // Render only the active section: a desktop keeps this element
            // alive when you switch away, so what you leave behind is kept.
            this._page.innerHTML = `
                <h1>${section.label}</h1>
                <p class="lead">This section is addressable —
                   <code>${this._ctx.href(section.id)}</code>.</p>
            `;

            this._rail.items = [
                { section: "My Fullscreen App" },
                ...SECTIONS.map((s) => ({
                    label:  s.label,
                    icon:   s.icon,
                    // context.href, never a hand-built "#/id/route": the host
                    // owns the address space, and standalone there is no id.
                    href:   this._ctx.href(s.id),
                    active: s.id === section.id,
                })),
            ];

            // Make the current state linkable. replaceState — switching
            // sections is not a new page in the history.
            this._ctx.deepLink.set(section.id);
        }
    }

    sac.app.define("app-my-fullscreen-app", AppMyFullscreenApp);
})();
