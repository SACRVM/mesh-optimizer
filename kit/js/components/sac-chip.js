/**
 * <sac-chip label="work" color="blue" [removable] [selected] [clickable]>
 *
 * A coloured pill. The colour is a
 * palette SLOT NAME ("blue", "orange", …) that resolves to
 * var(--palette-<slot>). Background is a tinted color-mix, so one token per
 * slot serves fill, tint and border in both light and dark themes — and
 * persisted data can store the slot name instead of a hex, which lets a
 * re-theme shift the palette without rewriting stored records.
 *
 * Attributes:
 *   label      — display text.
 *   color      — palette slot. Defaults to "gray" if unknown.
 *   removable  — shows an × button. Click emits 'sac:remove'.
 *   selected   — filter-strip "active" state; brighter ring + saturated bg.
 *   clickable  — pointer cursor + hover affordance (filter-strip mode).
 *   disabled   — inert + dimmed; the × emits nothing.
 *
 * Properties:
 *   disabled   — get/set, reflects the attribute.
 *
 * Events:
 *   sac:remove — e.detail = { label } (only when [removable] is set),
 *                 bubbles + composed.
 *
 * Compact/touch: under (pointer: coarse) the × grows to 24px with a 44 x 44
 * invisible hit halo (leaning right, away from the label), and a [clickable]
 * chip gets a host halo to 44px tall — the pill itself keeps its look. Under
 * (hover: none) the × is always shown at near-full strength and a tapped
 * chip does not keep its hover wash. Give chips ~10px gap on touch so the
 * halos do not overlap (sac-chip-input does).
 */
(function () {

    /** Kit i18n: sac.t when globals.js is loaded, the English fallback when
     *  the component runs standalone. */
    const t = (key, fallback) =>
        (window.sac && window.sac.t) ? window.sac.t(key, fallback) : fallback;

class SacChip extends HTMLElement {
    static get observedAttributes() { return ["label", "color", "removable", "selected", "clickable", "disabled"]; }

    constructor() {
        super();
        this.attachShadow({ mode: "open" });
    }

    get disabled() { return this.hasAttribute("disabled"); }
    set disabled(v) { if (v) this.setAttribute("disabled", ""); else this.removeAttribute("disabled"); }

    connectedCallback() {
        if (!this.shadowRoot.firstChild) this._render();
        else this._refresh();
        // Runtime language switch: relabel the × in place.
        if (window.sac && sac.lang && !this._offLang) this._offLang = sac.lang.onChange(() => this._relabel());
    }

    disconnectedCallback() {
        if (this._offLang) { this._offLang(); this._offLang = null; }
    }

    /** The remove button's tooltip + aria-label in the current language. */
    _relabel() {
        const x = this.shadowRoot.querySelector(".x");
        if (!x) return;
        const text = t("chip.remove", "Remove");
        x.title = text;
        x.setAttribute("aria-label", text);
    }

    attributeChangedCallback() {
        if (this.shadowRoot.firstChild) this._refresh();
    }

    _render() {
        // Remove button: tooltip and aria-label share one translation.
        const esc = (s) => String(s).replace(/"/g, "&quot;");
        const L = { remove: esc(t("chip.remove", "Remove")) };
        this.shadowRoot.innerHTML = `
            <style>
                :host {
                    --chip-color: var(--palette-gray);
                    display: inline-flex;
                    align-items: center;
                    gap: 4px;
                    padding: 3px 9px;
                    border-radius: 999px;
                    font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
                    font-size: 11px;
                    font-weight: 600;
                    letter-spacing: 0.01em;
                    line-height: 1;
                    background: color-mix(in srgb, var(--chip-color) 18%, transparent);
                    color: var(--chip-color);
                    border: 1px solid color-mix(in srgb, var(--chip-color) 35%, transparent);
                    user-select: none;
                    transition: background 120ms, border-color 120ms, transform 80ms;
                }
                :host([disabled]) { opacity: .5; pointer-events: none; }
                :host([clickable]) { cursor: pointer; }
                :host([clickable]:hover) {
                    background: color-mix(in srgb, var(--chip-color) 30%, transparent);
                    border-color: color-mix(in srgb, var(--chip-color) 55%, transparent);
                }
                :host([selected]) {
                    /* Translucent wash, not a solid fill — the ink follows
                       the theme, not the fill. */
                    background: color-mix(in srgb, var(--chip-color) 40%, transparent);
                    border-color: var(--chip-color);
                    color: var(--text);
                    box-shadow: 0 0 0 1px color-mix(in srgb, var(--chip-color) 60%, transparent);
                }
                .label { white-space: nowrap; }
                .x {
                    display: none;
                    align-items: center;
                    justify-content: center;
                    width: 14px;
                    height: 14px;
                    border-radius: 50%;
                    background: transparent;
                    border: none;
                    color: inherit;
                    cursor: pointer;
                    padding: 0;
                    margin-left: 2px;
                    margin-right: -3px;
                    opacity: 0.6;
                    transition: opacity 100ms, background 100ms;
                    font: inherit;
                }
                :host([removable]) .x { display: inline-flex; }
                .x:hover {
                    opacity: 1;
                    background: color-mix(in srgb, var(--chip-color) 40%, transparent);
                }
                .x svg { width: 10px; height: 10px; }

                /* Touch: the × is a 14px target — far too small for a finger.
                   It grows to 24px and an invisible halo takes the hit area to
                   44 x 44. The halo leans RIGHT (6px into the label, 14px past
                   the chip's edge): the label side of a clickable chip is its
                   own target, the right side is only a gap. z-index lifts the
                   × over the clickable host's own halo below. */
                @media (pointer: coarse) {
                    :host([removable]) { padding-right: 4px; }
                    .x {
                        position: relative;
                        z-index: 1;
                        width: 24px;
                        height: 24px;
                        margin-right: 0;
                    }
                    .x svg { width: 12px; height: 12px; }
                    .x::after {
                        content: "";
                        position: absolute;
                        inset: -10px -14px -10px -6px;
                    }
                    /* A clickable chip is ~20px tall: a halo on the host takes
                       it to 44px without changing the pill. min() — only the
                       axis that is short grows. */
                    :host([clickable]) { position: relative; }
                    :host([clickable])::after {
                        content: "";
                        position: absolute;
                        inset: min(0px, calc((100% - 44px) / 2));
                    }
                }
                /* No hover on touch: a tapped chip must not keep the hover
                   wash until the next tap elsewhere. The × is always fully
                   visible there (opacity 0.6 is its resting look, not a hover
                   reveal, so it stays reachable). */
                @media (hover: none) {
                    :host([clickable]:hover:not([selected])) {
                        background: color-mix(in srgb, var(--chip-color) 18%, transparent);
                        border-color: color-mix(in srgb, var(--chip-color) 35%, transparent);
                    }
                    .x { opacity: 0.85; }
                }
            </style>
            <span class="label"></span>
            <button type="button" class="x" title="${L.remove}" aria-label="${L.remove}">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round">
                    <line x1="18" y1="6" x2="6" y2="18"/>
                    <line x1="6" y1="6" x2="18" y2="18"/>
                </svg>
            </button>
        `;
        this.shadowRoot.querySelector(".x").addEventListener("click", (e) => {
            e.stopPropagation();
            if (this.disabled) return;
            this.dispatchEvent(new CustomEvent("sac:remove", {
                detail: { label: this.getAttribute("label") || "" },
                bubbles: true, composed: true,
            }));
        });
        this._refresh();
    }

    _refresh() {
        const label = this.getAttribute("label") || "";
        const color = this.getAttribute("color") || "gray";
        const labelEl = this.shadowRoot.querySelector(".label");
        if (labelEl) labelEl.textContent = label;
        this.style.setProperty("--chip-color", `var(--palette-${color}, var(--palette-gray))`);
    }
}

customElements.define("sac-chip", SacChip);
})();
