/**
 * <sac-footer brand="MY APP" version="1.0.0" link-href="https://…" link-label="GITHUB">
 *
 * Minimal branded footer. The link only renders when link-href is set —
 * a live demonstration of the no-dead-links rule (never render a control
 * that does nothing).
 *
 * Attributes:
 *   brand      — footer text (uppercase style).
 *   version    — optional version string, rendered as " · v<version>".
 *   link-href  — optional external link.
 *   link-label — text for the link (default "LINK").
 *
 * Compact/touch: usually the last thing on the page, so the bottom padding
 * adds env(safe-area-inset-bottom) — the home indicator never sits on the
 * text (0 on desktop, where nothing changes). The line wraps at 360px. Under
 * (pointer: coarse) the link gets a 44px-tall invisible hit halo.
 */
(function () {

    /** Kit i18n: sac.t when globals.js is loaded, the English fallback when
     *  the component runs standalone. */
    const t = (key, fallback) =>
        (window.sac && window.sac.t) ? window.sac.t(key, fallback) : fallback;

class SacFooter extends HTMLElement {
    static get observedAttributes() { return ["brand", "version", "link-href", "link-label"]; }

    constructor() {
        super();
        this.attachShadow({ mode: "open" });
    }

    connectedCallback() {
        this.render();
        if (window.sac && sac.lang && !this._offLang) this._offLang = sac.lang.onChange(() => this._relabel());
    }
    disconnectedCallback() {
        if (this._offLang) { this._offLang(); this._offLang = null; }
    }
    attributeChangedCallback() { if (this.shadowRoot.firstChild) this.render(); }

    /** Language switch: only the kit's default link label is the kit's. */
    _relabel() {
        const a = this.shadowRoot.querySelector("a");
        if (a && !this.getAttribute("link-label")) a.textContent = t("footer.link", "LINK");
    }

    render() {
        const brand   = this.getAttribute("brand") || "";
        const version = this.getAttribute("version");
        const href    = this.getAttribute("link-href");
        const label   = this.getAttribute("link-label") || t("footer.link", "LINK");

        this.shadowRoot.innerHTML = `
            <style>
                :host {
                    display: block;
                    text-align: center;
                    padding: 1.5rem 1rem;
                    color: var(--text-muted);
                    font-size: 0.75rem;
                    letter-spacing: 0.05em;
                    text-transform: uppercase;
                    border-top: 1px solid var(--border);
                    margin-top: 4rem;
                    padding-bottom: calc(1.5rem + env(safe-area-inset-bottom, 0px));
                    overflow-wrap: anywhere;
                }
                a {
                    color: inherit;
                    text-decoration: none;
                    margin-left: 0.5rem;
                }
                a:hover { color: var(--accent); }
                @media (pointer: coarse) {
                    a { position: relative; }
                    a::after {
                        content: "";
                        position: absolute;
                        left: -0.5rem;
                        right: -0.5rem;
                        top: 50%;
                        height: 44px;
                        translate: 0 -50%;
                    }
                }
                @media (hover: none) {
                    a:hover { color: inherit; }
                }
                .version { opacity: 0.7; }
            </style>
            <span>${brand}</span>
            ${version ? `<span class="version"> · v${version}</span>` : ``}
            ${href ? `<a href="${href}" target="_blank" rel="noopener">${label}</a>` : ``}
        `;
    }
}

customElements.define("sac-footer", SacFooter);
})();
