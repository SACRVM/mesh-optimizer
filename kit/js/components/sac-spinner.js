/**
 * <sac-spinner label="Loading">
 *
 * Small inline spinner ring — drop it in a button, next to a status line,
 * or inside a panel while content loads. Size is a local custom property
 * rather than a kit token, so each instance can be sized independently:
 *   <sac-spinner style="--spinner-size: 32px"></sac-spinner>
 *
 * Attributes:
 *   label — accessible name (default "Loading"). Not rendered as visible
 *           text; the ring is the whole visual.
 *
 * Host: role="status", aria-label mirrors label (synced in place). Under
 * prefers-reduced-motion the ring stops spinning and renders as a static
 * ring rather than disappearing.
 */
(function () {

    /** Kit i18n: sac.t when globals.js is loaded, the English fallback when
     *  the component runs standalone. */
    const t = (key, fallback) =>
        (window.sac && window.sac.t) ? window.sac.t(key, fallback) : fallback;

class SacSpinner extends HTMLElement {
    static get observedAttributes() { return ["label"]; }

    constructor() {
        super();
        this.attachShadow({ mode: "open" });
    }

    connectedCallback() {
        if (!this.shadowRoot.firstChild) this._render();
        this.setAttribute("role", "status");
        this._sync();
    }

    attributeChangedCallback() {
        if (this.shadowRoot.firstChild) this._sync();
    }

    _sync() {
        this.setAttribute("aria-label", this.getAttribute("label") || t("spinner.loading", "Loading"));
    }

    _render() {
        this.shadowRoot.innerHTML = `
            <style>
                :host {
                    display: inline-flex;
                    width: var(--spinner-size, 20px);
                    height: var(--spinner-size, 20px);
                }
                .ring {
                    /* border-box, or the 2px border makes the flex item
                       20×24 (shrink hits only the main axis) — a rotating
                       ellipse visibly wobbles. */
                    box-sizing: border-box;
                    width: 100%;
                    height: 100%;
                    border: 2px solid color-mix(in srgb, var(--fg) 15%, transparent);
                    border-top-color: var(--accent);
                    border-radius: 50%;
                    animation: sac-spinner-spin 0.8s linear infinite;
                }
                @keyframes sac-spinner-spin {
                    to { transform: rotate(360deg); }
                }
                @media (prefers-reduced-motion: reduce) {
                    .ring { animation: none; }
                }
            </style>
            <div class="ring"></div>
        `;
    }
}

customElements.define("sac-spinner", SacSpinner);
})();
