/**
 * <sac-section title="FILTERS">
 *   …controls…
 * </sac-section>
 *
 * <sac-section title="View settings" collapsible collapsed remember="view">
 *   …controls that fold away under the headline…
 * </sac-section>
 *
 * Sidebar group separator: uppercase title + thin underline. With `collapsible`
 * the title becomes a toggle that folds the group away.
 *
 * Attributes:
 *   title       — uppercase heading text. Rendered at --text — a group heading is
 *                 meant to stand out from the labels it heads (AA with room to spare;
 *                 never the tertiary --text-dim, which failed AA at this size).
 *   collapsible — the title becomes a button (chevron, Enter/Space, aria-expanded)
 *                 that folds the body away. 44px hit target on touch.
 *   collapsed   — the folded state (reflected). Only meaningful with collapsible.
 *   remember    — a key: the folded state survives a reload (per viewer, in
 *                 localStorage as "sac-section:<key>"). A stored state wins over
 *                 the markup's `collapsed`. Leave it out when the app persists
 *                 the state itself (listen to sac:toggle, set `collapsed`).
 *
 * Properties: collapsed (boolean). Method: toggle(force?).
 *
 * Events:
 *   sac:toggle — detail { collapsed }. Fired on a user toggle and on toggle(),
 *                not when the attribute is set from outside.
 *
 * CSS parts (style from the light DOM, e.g. sac-section::part(title) { … }):
 *   title — the heading.   body — the slotted content wrapper.
 *   chevron — the toggle's chevron (collapsible only).
 */
class SacSection extends HTMLElement {
    static get observedAttributes() { return ["title", "collapsible", "collapsed"]; }

    constructor() {
        super();
        this.attachShadow({ mode: "open" });
        this.shadowRoot.innerHTML = `
            <style>
                :host {
                    display: block;
                    margin-bottom: 1.5rem;
                }
                /* Shares the caption shape (ui.css --caption-* tokens) with the
                   .sac-caption light-DOM utility, so the two never drift. The
                   heading lifts the colour to --text and adds the underline. */
                .title {
                    display: flex;
                    align-items: center;
                    gap: 0.4rem;
                    width: 100%;
                    box-sizing: border-box;
                    margin: 0;
                    padding: 0 0 0.5rem;
                    background: none;
                    border: 0;
                    border-bottom: 1px solid var(--border);
                    border-radius: 0;
                    text-align: left;
                    font-family: var(--caption-font);
                    font-size: var(--caption-size);
                    font-weight: var(--caption-weight);
                    letter-spacing: var(--caption-tracking);
                    text-transform: uppercase;
                    color: var(--text);
                }
                .label { flex: 1; min-width: 0; }
                .chevron {
                    display: none;
                    flex: none;
                    width: 14px;
                    height: 14px;
                    color: var(--text-muted);
                    transition: transform 0.2s ease;
                }
                :host([collapsible]) .title { cursor: pointer; }
                :host([collapsible]) .chevron { display: block; }
                :host([collapsible]) .title:hover .chevron { color: var(--text); }
                :host([collapsible]) .title:focus-visible {
                    outline: 2px solid var(--accent);
                    outline-offset: 2px;
                    border-radius: 4px;
                }
                :host([collapsible][collapsed]) .chevron { transform: rotate(-90deg); }

                /* Height transition via the 0fr/1fr grid-row trick: no measuring.
                   The gap above the body lives inside the fold (padding), so a
                   folded section is just its underlined title. */
                .fold {
                    display: grid;
                    grid-template-rows: 1fr;
                    transition: grid-template-rows 0.2s ease, visibility 0s linear 0s;
                }
                .clip { min-height: 0; }
                .fold.moving .clip { overflow: hidden; }
                :host([collapsible][collapsed]) .fold {
                    grid-template-rows: 0fr;
                    visibility: hidden;   /* out of the tab order once folded */
                    transition: grid-template-rows 0.2s ease, visibility 0s linear 0.2s;
                }
                :host([collapsible][collapsed]) .clip { overflow: hidden; }
                .body {
                    display: flex;
                    flex-direction: column;
                    gap: 0.5rem;
                    padding-top: 0.75rem;
                }
                @media (pointer: coarse) {
                    :host([collapsible]) .title { min-height: 44px; padding-top: 0; }
                }
                @media (prefers-reduced-motion: reduce) {
                    .fold, :host([collapsible][collapsed]) .fold, .chevron { transition: none; }
                }
            </style>
            <div class="title" part="title">
                <span class="label"></span>
                <svg class="chevron" part="chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                     stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                    <polyline points="6 9 12 15 18 9"/>
                </svg>
            </div>
            <div class="fold"><div class="clip">
                <div class="body" part="body"><slot></slot></div>
            </div></div>
        `;
        this._title = this.shadowRoot.querySelector(".title");
        this._label = this.shadowRoot.querySelector(".label");
        this._fold = this.shadowRoot.querySelector(".fold");

        this._title.addEventListener("click", () => {
            if (this.hasAttribute("collapsible")) this.toggle();
        });
        this._title.addEventListener("keydown", (e) => {
            if (!this.hasAttribute("collapsible") || e.repeat) return;
            if (e.key === "Enter" || e.key === " ") { e.preventDefault(); this.toggle(); }
        });
        // Clip only while the height moves, so an open body never cuts off
        // focus rings or popovers that reach past its edge.
        this._fold.addEventListener("transitionrun", (e) => {
            if (e.target === this._fold && e.propertyName === "grid-template-rows") this._fold.classList.add("moving");
        });
        const settle = (e) => {
            if (e.target === this._fold && e.propertyName === "grid-template-rows") this._fold.classList.remove("moving");
        };
        this._fold.addEventListener("transitionend", settle);
        this._fold.addEventListener("transitioncancel", settle);
    }

    connectedCallback() {
        const stored = this._stored();
        if (stored !== null) this.toggleAttribute("collapsed", stored);
        this._sync();
    }

    attributeChangedCallback() { this._sync(); }

    get collapsed() { return this.hasAttribute("collapsed"); }
    set collapsed(v) { this.toggleAttribute("collapsed", !!v); }

    toggle(force) {
        const next = force === undefined ? !this.collapsed : !!force;
        if (next === this.collapsed) return;
        this.collapsed = next;
        const key = this.getAttribute("remember");
        if (key) { try { localStorage.setItem("sac-section:" + key, next ? "1" : "0"); } catch { /* private mode */ } }
        this.dispatchEvent(new CustomEvent("sac:toggle", {
            detail: { collapsed: next }, bubbles: true, composed: true,
        }));
    }

    _stored() {
        const key = this.getAttribute("remember");
        if (!key) return null;
        try {
            const v = localStorage.getItem("sac-section:" + key);
            return v === null ? null : v === "1";
        } catch { return null; }
    }

    _sync() {
        if (!this._title) return;
        this._label.textContent = this.getAttribute("title") || "";
        const on = this.hasAttribute("collapsible");
        if (on) {
            this._title.setAttribute("role", "button");
            this._title.tabIndex = 0;
            this._title.setAttribute("aria-expanded", String(!this.collapsed));
        } else {
            this._title.removeAttribute("role");
            this._title.removeAttribute("tabindex");
            this._title.removeAttribute("aria-expanded");
        }
    }
}

customElements.define("sac-section", SacSection);
