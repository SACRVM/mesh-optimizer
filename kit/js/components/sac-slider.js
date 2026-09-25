/**
 * <sac-slider label="Depth" min="0" max="100" step="1" value="50" suffix="px">
 * <sac-slider label="Quality" min="0" max="2" step="1" value="1" labels="Low,Medium,High">
 *
 * Range slider with live value display. ALL seven attributes are observed.
 *
 * IMPORTANT implementation constraint: attribute changes update the shadow
 * DOM IN PLACE — never re-render it. Re-rendering replaces the <input>
 * mid-drag, which kills the browser's internal thumb drag after the first
 * tick (a classic web-component bug; avoided here).
 *
 * Attributes:
 *   label, min, max, step, value, suffix,
 *   labels   — comma-separated texts mapped by integer value (discrete steps).
 *   disabled — presence = inert + dimmed, fires nothing.
 *
 * Properties:
 *   value    — get/set, reflects the attribute (string).
 *   disabled — get/set, reflects the attribute.
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
    static get observedAttributes() { return ["label", "min", "max", "step", "value", "suffix", "labels", "disabled"]; }

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

    /** Update input.value + readout in place — safe during a drag. */
    _syncValue() {
        const input = this.shadowRoot.querySelector("input");
        const val = this.shadowRoot.querySelector(".val");
        if (!input) return;
        const value = this.getAttribute("value") ?? input.value;
        if (input.value !== value) input.value = value;
        if (val) val.textContent = this._display(input.value);
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
        this._syncValue();
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
                }
                input[type="range"]::-moz-range-thumb {
                    width: 14px; height: 14px;
                    border-radius: 50%;
                    background: var(--accent);
                    cursor: pointer;
                    border: none;
                }
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
            </style>
            <div class="row">
                <span class="label">${label}</span>
                <span class="val">${this._display(value)}</span>
            </div>
            <input type="range" min="${min}" max="${max}" step="${step}" value="${value}" ${this.disabled ? "disabled" : ""}/>
        `;
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
