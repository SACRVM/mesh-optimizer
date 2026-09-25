/**
 * <sac-loader>
 *
 * Full-screen blocking overlay with two concentric spinning rings
 * (accent + accent-warm). Used for heavy processing.
 *
 * Methods:
 *   show(title, subtitle)  — displays overlay
 *   hide()                 — fades out over 300ms
 *
 * Compact/touch: the overlay covers the whole screen (fixed, inset 0) and its
 * content keeps clear of notches and the home indicator with safe-area
 * padding; a long title or subtitle wraps centered instead of running past
 * the screen edges. It has no controls.
 */
(function () {

    /** Kit i18n: sac.t when globals.js is loaded, the English fallback when
     *  the component runs standalone. */
    const t = (key, fallback) =>
        (window.sac && window.sac.t) ? window.sac.t(key, fallback) : fallback;

class SacLoader extends HTMLElement {
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

    show(title, subtitle = "") {
        // No title given: the kit's own "Loading..." — relabelled on a
        // language switch; a caller's title is the caller's.
        this._autoTitle = title == null;
        if (this._autoTitle) title = t("loader.loading", "Loading...");
        this.render(title, subtitle);
        const overlay = this.shadowRoot.querySelector(".overlay");
        if (overlay) {
            overlay.style.display = "flex";
            // A timeout, not requestAnimationFrame: a background tab paints
            // no frames, so the fade-in would sit at opacity 0 — an overlay
            // that is displayed but invisible.
            setTimeout(() => { overlay.style.opacity = "1"; }, 0);
        }
    }

    hide() {
        const overlay = this.shadowRoot.querySelector(".overlay");
        if (!overlay) return;
        overlay.style.opacity = "0";
        setTimeout(() => { overlay.style.display = "none"; }, 300);
    }

    /** Language switch: swap the default title in place (overlay state kept). */
    _relabel() {
        const el = this.shadowRoot.querySelector(".title");
        if (el && this._autoTitle) el.textContent = t("loader.loading", "Loading...");
    }

    render(title = "", subtitle = "") {
        this.shadowRoot.innerHTML = `
            <style>
                .overlay {
                    position: fixed;
                    inset: 0;
                    background: color-mix(in srgb, var(--bg) 85%, transparent);
                    backdrop-filter: blur(8px);
                    -webkit-backdrop-filter: blur(8px);
                    display: none;
                    flex-direction: column;
                    align-items: center;
                    justify-content: center;
                    z-index: 10000;
                    opacity: 0;
                    transition: opacity 0.3s;
                    /* Room for the text at 360px, clear of notch and home
                       indicator (env() is 0 on desktop). */
                    padding: calc(1rem + env(safe-area-inset-top, 0px))
                             calc(1rem + env(safe-area-inset-right, 0px))
                             calc(1rem + env(safe-area-inset-bottom, 0px))
                             calc(1rem + env(safe-area-inset-left, 0px));
                    text-align: center;
                    overflow-wrap: anywhere;
                }
                .spinner {
                    position: relative;
                    width: 64px;
                    height: 64px;
                    margin-bottom: 1.5rem;
                }
                .ring {
                    position: absolute;
                    inset: 0;
                    border: 3px solid transparent;
                    border-radius: 50%;
                }
                .ring.outer {
                    border-top-color: var(--accent);
                    animation: spin 1.2s linear infinite;
                }
                .ring.inner {
                    inset: 8px;
                    border-top-color: var(--accent-warm);
                    animation: spin 0.9s linear infinite reverse;
                }
                @keyframes spin {
                    to { transform: rotate(360deg); }
                }
                .title {
                    font-family: 'Outfit', sans-serif;
                    font-weight: 700;
                    color: var(--text);
                    font-size: 1.1rem;
                }
                .sub {
                    margin-top: 0.3rem;
                    color: var(--text-dim);
                    font-size: 0.85rem;
                }
            </style>
            <div class="overlay">
                <div class="spinner">
                    <div class="ring outer"></div>
                    <div class="ring inner"></div>
                </div>
                <div class="title">${escapeHtmlSacLoader(title)}</div>
                ${subtitle ? `<div class="sub">${escapeHtmlSacLoader(subtitle)}</div>` : ""}
            </div>
        `;
    }
}

function escapeHtmlSacLoader(s) {
    return String(s).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]));
}

customElements.define("sac-loader", SacLoader);
})();
