/**
 * <sac-slider label="Depth" min="0" max="100" step="1" value="50" suffix="px">
 * <sac-slider label="Quality" min="0" max="2" step="1" value="1" labels="Low,Medium,High">
 * <sac-slider label="Smoothing" min="0.01" max="4" step="0.01" value="1" ends="Crisp,Smooth">
 *
 * Range slider with live value display. ALL attributes are observed.
 *
 * IMPORTANT implementation constraint: attribute changes update the shadow
 * DOM IN PLACE — never re-render it. Re-rendering replaces the <input>
 * mid-drag, which kills the browser's internal thumb drag after the first
 * tick (a classic web-component bug; avoided here).
 *
 * Attributes:
 *   label, min, max, step, value, suffix,
 *   labels   — comma-separated texts mapped by integer value (discrete steps).
 *   ends     — "Low end,High end": two captions under the track's ends, for a
 *              continuous range whose extremes need words ("Crisp,Smooth").
 *              The readout still shows the number. Translate it like `label`
 *              (the app sets the attribute again on a language switch).
 *   disabled — presence = inert + dimmed, fires nothing.
 *
 * Properties:
 *   value    — get/set, reflects the attribute (string).
 *   disabled — get/set, reflects the attribute.
 *
 * Accessibility: the range input is named by the `label` text
 * (aria-labelledby; without a label, the host's own aria-label is copied
 * onto it), and aria-valuetext carries what the readout shows ("40px",
 * "Medium"), kept in step on every change. Keyboard focus draws the kit's
 * focus ring (2px --accent, offset 2px) round the thumb, in WebKit/Blink and
 * Firefox alike; a pointer drag shows none.
 *
 * Compact/touch: a native range input, so pointer/touch dragging is the
 * browser's own. Under (pointer: coarse) the input is a 44px-tall hit strip
 * (the 4px track is drawn inside it), the thumb grows to 20px, and
 * touch-action: pan-y lets a vertical swipe over the slider scroll the page
 * while a sideways drag moves the thumb.
 *
 * Events (bubble, NOT composed — like native input/change; detail { value }):
 *   sac:input  — fired on drag (live); detail.value = string.
 *   sac:change — fired on release;     detail.value = string.
 */
class SacSlider extends HTMLElement {
    static get observedAttributes() { return ["label", "min", "max", "step", "value", "suffix", "labels", "ends", "disabled"]; }

    constructor() {
        super();
        this.attachShadow({ mode: "open" });
    }

    connectedCallback() {
        if (!this.shadowRoot.firstChild) {
            this.render();
            this.attach();
        }
    }

    attributeChangedCallback(name) {
        if (!this.shadowRoot.firstChild) return;
        if (name === "value") this._syncValue();
        else if (name === "disabled") this._syncDisabled();
        else this._syncStructure();
    }

    get value() { return this.getAttribute("value") || ""; }
    set value(v) { this.setAttribute("value", String(v)); }

    get disabled() { return this.hasAttribute("disabled"); }
    set disabled(v) { if (v) this.setAttribute("disabled", ""); else this.removeAttribute("disabled"); }

    /** The native range input carries disabled — it then fires nothing on its
     *  own; the host CSS dims it. */
    _syncDisabled() {
        const input = this.shadowRoot.querySelector("input");
        if (input) input.disabled = this.disabled;
    }

    _labels() {
        return (this.getAttribute("labels") || "").split(",").map(s => s.trim()).filter(Boolean);
    }

    _display(value) {
        const labels = this._labels();
        const suffix = this.getAttribute("suffix") || "";
        return labels.length ? (labels[parseInt(value, 10)] || value) : `${value}${suffix}`;
    }

    /** Update input.value + readout in place — safe during a drag. The
     *  readout's text is also the value a screen reader hears. */
    _syncValue() {
        const input = this.shadowRoot.querySelector("input");
        const val = this.shadowRoot.querySelector(".val");
        if (!input) return;
        const value = this.getAttribute("value") ?? input.value;
        if (input.value !== value) input.value = value;
        const shown = this._display(input.value);
        if (val) val.textContent = shown;
        input.setAttribute("aria-valuetext", shown);
    }

    /** Update label/min/max/step in place, then refresh the readout. */
    _syncStructure() {
        const input = this.shadowRoot.querySelector("input");
        const label = this.shadowRoot.querySelector(".label");
        if (!input) return;
        input.min  = this.getAttribute("min")  || "0";
        input.max  = this.getAttribute("max")  || "100";
        input.step = this.getAttribute("step") || "1";
        if (label) label.textContent = this.getAttribute("label") || "";
        this._syncName();
        this._syncEnds();
        this._syncValue();
    }

    /** The input's accessible name: the visible label (same shadow root, so
     *  aria-labelledby reaches it); without one, the host's aria-label. */
    _syncName() {
        const input = this.shadowRoot.querySelector("input");
        if (!input) return;
        if (this.getAttribute("label")) {
            input.setAttribute("aria-labelledby", "label");
            input.removeAttribute("aria-label");
        } else {
            input.removeAttribute("aria-labelledby");
            const own = this.getAttribute("aria-label");
            if (own) input.setAttribute("aria-label", own);
            else input.removeAttribute("aria-label");
        }
    }

    /** The two end captions, in place; the row is hidden without `ends`. */
    _syncEnds() {
        const row = this.shadowRoot.querySelector(".ends");
        if (!row) return;
        const raw = this.getAttribute("ends");
        const parts = raw ? raw.split(",").map(s => s.trim()) : [];
        row.hidden = !parts.some(Boolean);
        row.children[0].textContent = parts[0] || "";
        row.children[1].textContent = parts[1] || "";
    }

    render() {
        const label  = this.getAttribute("label")  || "";
        const min    = this.getAttribute("min")    || "0";
        const max    = this.getAttribute("max")    || "100";
        const step   = this.getAttribute("step")   || "1";
        const value  = this.getAttribute("value")  || min;

        this.shadowRoot.innerHTML = `
            <style>
                :host { display: block; }
                .row {
                    display: flex;
                    justify-content: space-between;
                    font-size: 0.8rem;
                    color: color-mix(in srgb, var(--fg) 78%, var(--bg));
                    margin-bottom: 0.3rem;
                }
                .val { color: var(--accent); font-weight: 600; }
                input[type="range"] {
                    width: 100%;
                    -webkit-appearance: none;
                    appearance: none;
                    height: 4px;
                    background: color-mix(in srgb, var(--fg) 10%, transparent);
                    border-radius: var(--radius-s);
                    outline: none;
                    margin: 0;
                }
                input[type="range"]::-webkit-slider-thumb {
                    -webkit-appearance: none;
                    width: 14px; height: 14px;
                    border-radius: 50%;
                    background: var(--accent);
                    cursor: pointer;
                    transition: transform 0.2s var(--ease-smooth);
                }
                input[type="range"]::-moz-range-thumb {
                    width: 14px; height: 14px;
                    border-radius: 50%;
                    background: var(--accent);
                    cursor: pointer;
                    border: none;
                    transition: transform 0.2s var(--ease-smooth);
                }
                /* Press: the thumb swells the moment it is grabbed and stays
                   so for the drag. One rule per engine — a selector list that
                   mixes -webkit- and -moz- pseudo-elements is dropped whole. */
                input[type="range"]:active:not(:disabled)::-webkit-slider-thumb {
                    transform: scale(1.1);
                    transition-duration: 0.1s;
                }
                input[type="range"]:active:not(:disabled)::-moz-range-thumb {
                    transform: scale(1.1);
                    transition-duration: 0.1s;
                }
                /* Keyboard focus: the kit's ring (2px --accent) round the
                   thumb — the input itself keeps outline: none. One rule per
                   engine, as above. */
                input[type="range"]:focus-visible::-webkit-slider-thumb {
                    outline: 2px solid var(--accent);
                    outline-offset: 2px;
                }
                input[type="range"]:focus-visible::-moz-range-thumb {
                    outline: 2px solid var(--accent);
                    outline-offset: 2px;
                }
                .ends {
                    display: flex;
                    justify-content: space-between;
                    gap: 0.5rem;
                    margin-top: 0.25rem;
                    font-size: 0.7rem;
                    color: var(--text-muted);
                }
                .ends[hidden] { display: none; }
                :host([disabled]) { opacity: .5; }
                :host([disabled]) input[type="range"] { cursor: not-allowed; }

                /* Touch: the input itself becomes a 44px-tall hit strip with
                   the 4px track drawn inside it, and the thumb grows to 20px
                   — a 14px dot is not something a finger can find. pan-y: a
                   sideways drag moves the thumb, a vertical one still scrolls
                   the page (a slider in a long sidebar must not trap it). */
                @media (pointer: coarse) {
                    input[type="range"] {
                        height: 44px;
                        background: transparent;
                        touch-action: pan-y;
                    }
                    input[type="range"]::-webkit-slider-runnable-track {
                        height: 4px;
                        background: color-mix(in srgb, var(--fg) 10%, transparent);
                        border-radius: var(--radius-s);
                    }
                    input[type="range"]::-moz-range-track {
                        height: 4px;
                        background: color-mix(in srgb, var(--fg) 10%, transparent);
                        border-radius: var(--radius-s);
                    }
                    input[type="range"]::-webkit-slider-thumb {
                        width: 20px; height: 20px;
                        margin-top: -8px;        /* centre on the 4px track */
                    }
                    input[type="range"]::-moz-range-thumb { width: 20px; height: 20px; }
                    .row { margin-bottom: 0; }
                }
                @media (prefers-reduced-motion: reduce) {
                    input[type="range"]::-webkit-slider-thumb { transition: none; }
                    input[type="range"]::-moz-range-thumb { transition: none; }
                }
            </style>
            <div class="row">
                <span class="label" id="label"></span>
                <span class="val" aria-hidden="true"></span>
            </div>
            <input type="range" min="${min}" max="${max}" step="${step}" value="${value}" ${this.disabled ? "disabled" : ""}/>
            <div class="ends" part="ends" hidden><span></span><span></span></div>
        `;
        // Texts by textContent: a label is app data, never markup.
        this.shadowRoot.querySelector(".label").textContent = label;
        const shown = this._display(value);
        this.shadowRoot.querySelector(".val").textContent = shown;
        this.shadowRoot.querySelector("input").setAttribute("aria-valuetext", shown);
        this._syncName();
        this._syncEnds();
    }

    attach() {
        const input = this.shadowRoot.querySelector("input");
        // Value control: sac:input (live) + sac:change (commit), detail { value },
        // bubbles but NOT composed — same shape and shadow behavior as native.
        const fire = (type, value) => this.dispatchEvent(new CustomEvent(type, {
            detail: { value },
            bubbles: true,
            composed: false
        }));
        input.addEventListener("input", (e) => {
            e.stopPropagation();               // swallow the native input event
            this.setAttribute("value", input.value);   // → _syncValue, in place
            fire("sac:input", input.value);
        });
        input.addEventListener("change", (e) => {
            e.stopPropagation();
            this.setAttribute("value", input.value);
            fire("sac:change", input.value);
        });
    }
}

customElements.define("sac-slider", SacSlider);
