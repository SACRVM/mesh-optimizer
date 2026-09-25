/**
 * <sac-sidebar></sac-sidebar>
 *
 * A left rail — the APP'S OWN chrome. The app puts the element in its own
 * markup and assigns `items`; nothing is projected from anywhere. One rail,
 * one look, and the app that draws it owns it (the same inversion as the
 * toolbar: a host injects context into an app, it never offers the app a
 * hull).
 *
 * With no items the rail hides itself.
 *
 * Property:
 *   items — array, re-renders on assignment:
 *     { label, icon?, href?, onClick?, active?, disabled? }
 *     { section }   — a group heading on its own
 *
 * Attributes:
 *   width  — rail width, default 220px. Also settable via the
 *            --sidebar-width custom property.
 *   drawer — set BY <sac-nav> when it adopts the rail (its burger opens it).
 *            Only on compact (ui.css §15) does it change anything: the
 *            rail leaves the flow and becomes an off-canvas drawer,
 *            var(--drawer-width) wide. Without a nav, set it yourself and
 *            drive the rail with the methods or the event below.
 *   open   — reflected; the drawer is out. Ignored when the rail is inline
 *            (desktop, or no [drawer]).
 *
 * Methods: open() / close() / toggle() — set or clear [open].
 *
 * Events:
 *   sac:sidebar-toggle — LISTENED FOR on window: dispatch it (optionally with
 *            detail { open: true|false }) to drive the rail from any button.
 *            sac-nav's burger does not need it — it holds the rail directly.
 *   sac:sidebar-open / sac:sidebar-close — fired by the rail (bubbles,
 *            composed) whenever [open] changes.
 *
 * Compact behaviour: while the drawer is open, tapping an item closes it
 * (the item navigated — the drawer did its job). Scrim, Escape, swipe-back
 * and the focus trap belong to the <sac-nav> that adopted the rail.
 *
 * Layout contract: the rail is a normal flex child — put it inside
 * .main-layout (which already clears the fixed <sac-nav>), beside your
 * scrolling content (.app-scroll).
 */
(function () {

    /** Kit i18n: sac.t when globals.js is loaded, the English fallback when
     *  the component runs standalone. */
    const t = (key, fallback) =>
        (window.sac && window.sac.t) ? window.sac.t(key, fallback) : fallback;

class SacSidebar extends HTMLElement {
    static get observedAttributes() { return ["width", "open"]; }

    constructor() {
        super();
        this.attachShadow({ mode: "open" });
        this._items = [];
        this._onToggleEvent = (e) => {
            const want = e.detail && typeof e.detail.open === "boolean" ? e.detail.open : null;
            this.toggle(want);
        };
    }

    connectedCallback() {
        if (!this.shadowRoot.firstChild) this._render();
        this._syncWidth();
        this.renderSidebar();
        window.addEventListener("sac:sidebar-toggle", this._onToggleEvent);
        if (window.sac && sac.lang && !this._offLang) this._offLang = sac.lang.onChange(() => this._relabel());
    }

    disconnectedCallback() {
        window.removeEventListener("sac:sidebar-toggle", this._onToggleEvent);
        if (this._offLang) { this._offLang(); this._offLang = null; }
    }

    /** Language switch: the rail's own landmark name. Item labels are the
     *  app's — it re-assigns `items` in its own language handler. */
    _relabel() {
        const list = this.shadowRoot.getElementById("list");
        if (list) list.setAttribute("aria-label", t("sidebar.label", "Sections"));
    }

    attributeChangedCallback(name, oldValue, newValue) {
        if (name === "open") {
            if ((oldValue === null) === (newValue === null)) return;
            this.dispatchEvent(new CustomEvent(newValue !== null ? "sac:sidebar-open" : "sac:sidebar-close",
                { bubbles: true, composed: true }));
            return;
        }
        if (this.shadowRoot.firstChild) this._syncWidth();
    }

    open()   { this.setAttribute("open", ""); }
    close()  { this.removeAttribute("open"); }
    /** Flip the drawer; pass a boolean to force a side. */
    toggle(force) {
        const next = typeof force === "boolean" ? force : !this.hasAttribute("open");
        this.toggleAttribute("open", next);
    }

    get items() { return this._items; }
    set items(v) {
        this._items = Array.isArray(v) ? v : [];
        if (this.shadowRoot.firstChild) this.renderSidebar();
    }

    _syncWidth() {
        const w = this.getAttribute("width");
        if (w) this.style.setProperty("--sidebar-width", w);
        else   this.style.removeProperty("--sidebar-width");
    }

    /**
     * Rewrites the list from this.items. Called by the setter and on
     * connect. In-place: the rail never re-renders its own shell.
     */
    renderSidebar() {
        const list = this.shadowRoot.getElementById("list");
        if (!list) return;
        const items = this._items;

        // Empty rail = no rail. Hidden rather than removed, so a later
        // assignment fills it again without the app re-laying anything out.
        this.toggleAttribute("hidden", items.length === 0);
        if (!items.length) { list.replaceChildren(); return; }

        list.replaceChildren(...items.map((item) => {
            if (item.section != null && item.label == null) {
                const h = document.createElement("div");
                h.className = "section";
                h.textContent = item.section;
                return h;
            }
            // A link when the item has an address, a button when it has an
            // action — never a link that only runs script (no dead controls).
            const el = document.createElement(item.href ? "a" : "button");
            el.className = "item" + (item.active ? " active" : "");
            if (item.href) {
                el.href = item.href;
            } else {
                el.type = "button";
                if (item.onClick) el.addEventListener("click", (e) => item.onClick(e));
            }
            // An item tap inside the open drawer is the drawer's job done.
            el.addEventListener("click", () => { if (this.hasAttribute("open")) this.close(); });
            if (item.disabled) {
                el.setAttribute("aria-disabled", "true");
                if (el.tagName === "BUTTON") el.disabled = true;
            }
            if (item.active) el.setAttribute("aria-current", "true");
            if (item.icon && window.sac?.icons) {
                const icon = document.createElement("sac-icon");
                icon.setAttribute("name", item.icon);
                el.appendChild(icon);
            }
            const span = document.createElement("span");
            span.textContent = item.label == null ? "" : String(item.label);
            el.appendChild(span);
            return el;
        }));
    }

    _render() {
        this.shadowRoot.innerHTML = `
            <style>
                *, *::before, *::after { box-sizing: border-box; }

                :host {
                    --sidebar-width: 220px;
                    display: flex;
                    flex-direction: column;
                    flex: none;
                    width: var(--sidebar-width);
                    background: var(--panel);
                    border-right: 1px solid var(--border);
                    overflow-y: auto;
                    font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
                    z-index: 90;
                }
                :host([hidden]) { display: none; }

                /* Compact: off-canvas drawer (see the header). The same
                   recipe as .sidebar[drawer] in ui.css — a light-DOM rule
                   cannot reach a shadow host's own styles reliably, so it is
                   written out twice. */
                @media (max-width: 768px), (max-height: 480px) and (pointer: coarse) {
                    :host([drawer]) {
                        position: fixed;
                        top: var(--drawer-top, calc(50px + env(safe-area-inset-top, 0px)));
                        bottom: 0;
                        left: 0;
                        width: var(--drawer-width);
                        z-index: 10000;
                        padding-left: env(safe-area-inset-left, 0px);
                        padding-bottom: env(safe-area-inset-bottom, 0px);
                        translate: -105% 0;
                        visibility: hidden;
                        transition: translate 0.5s var(--ease-swift), visibility 0.5s;
                    }
                    :host([drawer][open]) {
                        translate: none;
                        visibility: visible;
                    }
                }
                @media (pointer: coarse) {
                    .item { min-height: 44px; }
                }

                nav {
                    display: flex;
                    flex-direction: column;
                    gap: 2px;
                    padding: 0.75rem;
                }

                .section {
                    margin: 0.9rem 0 0.25rem 0.5rem;
                    font-size: 0.7rem;
                    font-weight: 700;
                    text-transform: uppercase;
                    letter-spacing: 0.05em;
                    color: var(--text-dim);
                }
                .section:first-child { margin-top: 0.15rem; }

                .item {
                    display: flex;
                    align-items: center;
                    gap: 0.6rem;
                    width: 100%;
                    padding: 0.45rem 0.6rem;
                    border: none;
                    border-radius: var(--radius-m);
                    background: none;
                    color: var(--text-muted);
                    font: inherit;
                    font-size: 0.85rem;
                    text-align: left;
                    text-decoration: none;
                    cursor: pointer;
                    --icon-size: 16px;
                    transition: background 0.15s var(--ease-smooth),
                                color 0.15s var(--ease-smooth);
                }
                .item:hover { background: var(--hover); color: var(--text); }
                .item:focus-visible {
                    outline: 2px solid var(--accent);
                    outline-offset: -2px;
                }
                /* Active item: accent tint + accent text — no edge stripe
                   (kit rule: no thick colored borders on rounded surfaces). */
                .item.active {
                    background: var(--accent-tint);
                    color: var(--accent-text);
                    font-weight: 600;
                }
                .item[aria-disabled="true"] {
                    opacity: 0.45;
                    cursor: not-allowed;
                }
                .item span { min-width: 0; overflow: hidden; text-overflow: ellipsis; }

                @media (prefers-reduced-motion: reduce) {
                    .item, :host([drawer]) { transition: none; }
                }
            </style>
            <nav id="list" aria-label="${String(t("sidebar.label", "Sections")).replace(/"/g, "&quot;")}"></nav>
        `;
    }
}

customElements.define("sac-sidebar", SacSidebar);
})();
