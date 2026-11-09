/**
 * <sac-loader>
 *
 * Full-screen blocking overlay with two concentric spinning rings
 * (accent + accent-warm). Used for heavy processing.
 *
 * Methods:
 *   show(title, subtitle)  — displays overlay (called again while shown: new
 *                            text, nothing else changes)
 *   hide()                 — fades out over 300ms
 *
 * Blocking means every input, not only the mouse (2.36):
 *   - While shown, whatever the overlay covers turns inert — the page around
 *     the loader (the siblings up its ancestor chain, within the box the
 *     fixed overlay fills: the viewport, or an ancestor with a transform /
 *     filter / containment) — so Tab, a screen reader or a stray Enter
 *     cannot reach the app behind it. Layers that sit above the overlay stay
 *     live: a dialog, a toast, a window brought forward (z-index over the
 *     overlay's 10000), exactly what the mouse can still reach. Elements
 *     that were inert already are left alone; hide() gives back exactly what
 *     show() took.
 *   - Focus: the element that had it (it is inert now, so it loses it) gets
 *     it back on hide() — when it is still there and nobody has put focus
 *     somewhere else meanwhile (a dialog answered over the loader).
 *   - Screen readers: role="status" — the title (and subtitle) is announced
 *     when the loader shows and whenever show() changes it; the rings are
 *     decoration.
 *   - Reduced motion: the rings stand still (as <sac-spinner>'s), the fade
 *     stays.
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

    /** The overlay's z-index: what stands above it is not covered. */
    const OVERLAY_Z = 10000;

    /** The focused element itself, down through every open shadow root. */
    const deepActive = () => {
        let a = document.activeElement;
        while (a && a.shadowRoot && a.shadowRoot.activeElement) a = a.shadowRoot.activeElement;
        return a;
    };

    /** The next node up as rendered: slot first, then parent, then host. */
    const up = (n) => n.assignedSlot || n.parentNode || n.host || null;

    /** `node` sits inside `box` as rendered (slots followed, shadow roots
     *  left through their host). */
    const within = (node, box) => {
        for (let n = node; n; n = up(n)) if (n === box) return true;
        return false;
    };

class SacLoader extends HTMLElement {
    constructor() {
        super();
        this.attachShadow({ mode: "open" });
        this._shown = false;
        this._inerted = [];        // what show() made inert — and only that
        this._restoreFocus = null;
        this._hideTimer = null;
    }

    connectedCallback() {
        if (!this.shadowRoot.firstChild) this.render();
        if (window.sac && sac.lang && !this._offLang) this._offLang = sac.lang.onChange(() => this._relabel());
    }
    disconnectedCallback() {
        if (this._offLang) { this._offLang(); this._offLang = null; }
        // Removed while shown: give the page back.
        if (this._shown) { this._shown = false; this._unblock(); }
        clearTimeout(this._hideTimer);
    }

    show(title, subtitle = "") {
        // No title given: the kit's own "Loading..." — relabelled on a
        // language switch; a caller's title is the caller's.
        this._autoTitle = title == null;
        if (this._autoTitle) title = t("loader.loading", "Loading...");
        if (!this.shadowRoot.firstChild) this.render();
        this._setText(title, subtitle);
        const overlay = this.shadowRoot.querySelector(".overlay");
        // A hide() still fading out must not take this show down with it.
        clearTimeout(this._hideTimer);
        overlay.style.display = "flex";
        if (!this._shown) {
            this._shown = true;
            this._block();
        }
        // A timeout, not requestAnimationFrame: a background tab paints
        // no frames, so the fade-in would sit at opacity 0 — an overlay
        // that is displayed but invisible.
        setTimeout(() => { if (this._shown) overlay.style.opacity = "1"; }, 0);
    }

    hide() {
        const overlay = this.shadowRoot.querySelector(".overlay");
        if (!overlay) return;
        if (this._shown) {
            this._shown = false;
            this._unblock();
        }
        // Cleared, so the same title shown again is announced again.
        const status = this.shadowRoot.querySelector(".status");
        if (status) status.textContent = "";
        overlay.style.opacity = "0";
        clearTimeout(this._hideTimer);
        this._hideTimer = setTimeout(() => { if (!this._shown) overlay.style.display = "none"; }, 300);
    }

    /** Language switch: swap the default title in place (overlay state kept). */
    _relabel() {
        if (!this._autoTitle) return;
        const sub = this.shadowRoot.querySelector(".sub");
        this._setText(t("loader.loading", "Loading..."), sub ? sub.textContent : "", !this._shown);
    }

    /** Title and subtitle: the visible pair, and the status line a screen
     *  reader announces (while shown — quiet = the visible text only). */
    _setText(title, subtitle, quiet = false) {
        const titleEl = this.shadowRoot.querySelector(".title");
        const subEl = this.shadowRoot.querySelector(".sub");
        const status = this.shadowRoot.querySelector(".status");
        if (titleEl) titleEl.textContent = title;
        if (subEl) { subEl.textContent = subtitle || ""; subEl.hidden = !subtitle; }
        if (status && !quiet) status.textContent = subtitle ? `${title} ${subtitle}` : String(title);
    }

    /** The element whose box the fixed overlay fills: the nearest ancestor
     *  (as rendered) that is a containing block for fixed descendants — a
     *  transform, perspective, filter, backdrop-filter, containment or
     *  container query — else null: the viewport. */
    _coverBox() {
        for (let n = up(this); n; n = up(n)) {
            if (n.nodeType !== 1 || n === document.body || n === document.documentElement) continue;
            const cs = getComputedStyle(n);
            const backdrop = cs.backdropFilter || cs.webkitBackdropFilter || "none";
            if (cs.transform !== "none" || cs.perspective !== "none" || cs.filter !== "none"
                || backdrop !== "none"
                || /paint|layout|strict|content/.test(cs.contain || "")
                || (cs.containerType && cs.containerType !== "normal")
                || /transform|perspective|filter/.test(cs.willChange || "")) return n;
        }
        return null;
    }

    /** Everything the overlay covers turns inert (see the header): the
     *  siblings up the loader's ancestor chain, up to the box it fills.
     *  Already-inert elements and layers above the overlay are skipped. */
    _block() {
        const active = deepActive();
        this._restoreFocus = active && active !== document.body && active !== document.documentElement
            ? active : null;
        const box = this._coverBox();
        // Up the tree — out of a shadow root through its host, as a loader
        // inside a component still covers the page — to <body>.
        let node = this;
        while (node && node !== document.body && node !== document.documentElement) {
            const parent = node.parentNode;
            if (!parent || parent.nodeType === 9) break;
            for (const sib of parent.children) {
                if (sib === node || sib.inert || /^(SCRIPT|STYLE|LINK|TEMPLATE)$/.test(sib.tagName)) continue;
                if ((parseInt(getComputedStyle(sib).zIndex, 10) || 0) > OVERLAY_Z) continue;
                sib.inert = true;
                this._inerted.push(sib);
            }
            // The overlay ends at this box: nothing above it is covered.
            if (box && within(box, parent)) break;
            node = parent.nodeType === 11 ? parent.host : parent;
        }
        // An engine that keeps focus on an element turned inert would still
        // type into it: let go of it explicitly.
        const a = this._restoreFocus;
        if (a && this._inerted.some((el) => within(a, el)) && typeof a.blur === "function") a.blur();
    }

    /** Give back exactly what _block() took, then the focus. */
    _unblock() {
        this._inerted.forEach((el) => { el.inert = false; });
        this._inerted = [];
        const back = this._restoreFocus;
        this._restoreFocus = null;
        if (!back || !back.isConnected || typeof back.focus !== "function") return;
        // Somebody put focus elsewhere meanwhile (a dialog over the loader
        // handed it on): theirs stays.
        const now = deepActive();
        if (now && now !== document.body && now !== document.documentElement) return;
        back.focus({ preventScroll: true });
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
                    z-index: ${OVERLAY_Z};
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
                .sub[hidden] { display: none; }
                /* The status line a screen reader announces — always
                   rendered (a live region speaks on a change, not on
                   content it appeared with), never seen. */
                .status {
                    position: absolute;
                    width: 1px;
                    height: 1px;
                    margin: -1px;
                    padding: 0;
                    overflow: hidden;
                    clip-path: inset(50%);
                    white-space: nowrap;
                    border: 0;
                }
                /* Reduced motion: the rings stand still — two arcs, top and
                   bottom, the mark without the spin (as <sac-spinner>). The
                   fade is opacity only and stays, shortened. */
                @media (prefers-reduced-motion: reduce) {
                    .ring { animation: none; }
                    .ring.inner { transform: rotate(180deg); }
                    .overlay { transition-duration: 0.2s; }
                }
                /* Reduced transparency / more contrast: the overlay carries
                   the text, so it turns solid (nothing shining through) and
                   drops the blur. It fills the viewport — no edge to draw. */
                @media (prefers-reduced-transparency: reduce) {
                    .overlay { background: var(--glass-solid); backdrop-filter: none; -webkit-backdrop-filter: none; }
                }
                @media (prefers-contrast: more) {
                    .overlay { background: var(--glass-solid); backdrop-filter: none; -webkit-backdrop-filter: none; }
                }
            </style>
            <div class="overlay" part="overlay">
                <div class="spinner" aria-hidden="true">
                    <div class="ring outer"></div>
                    <div class="ring inner"></div>
                </div>
                <div class="title" aria-hidden="true">${escapeHtmlSacLoader(title)}</div>
                <div class="sub" aria-hidden="true"${subtitle ? "" : " hidden"}>${escapeHtmlSacLoader(subtitle)}</div>
            </div>
            <div class="status" role="status" aria-live="polite"></div>
        `;
    }
}

function escapeHtmlSacLoader(s) {
    return String(s).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]));
}

customElements.define("sac-loader", SacLoader);
})();
