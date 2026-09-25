/**
 * <sac-copy-button value="npx serve ."></sac-copy-button>
 * <sac-copy-button for="#install-cmd" label="Copy command"></sac-copy-button>
 *
 * A small ghost icon button that copies text to the clipboard. Matches the
 * kit's ghost-button feel: transparent background, --text-dim icon, hover
 * --hover background + --text icon, 6px radius, ~26px square.
 *
 * What gets copied:
 *   - `value`, if set — copied verbatim.
 *   - otherwise the textContent of the element matched by `for` (a
 *     document-level CSS selector, e.g. "#install-cmd"), trimmed.
 *
 * Attributes:
 *   value — literal text to copy. Takes priority over `for`.
 *   for   — document.querySelector selector for the source of the text.
 *   label — accessible name, default "Copy". Sets aria-label + title,
 *           synced in place on change.
 *
 * Events:
 *   sac:copy — detail { text }, bubbles + composed. Fired only on a
 *              successful clipboard write.
 *
 * Behavior:
 *   Click copies via navigator.clipboard.writeText(). On success the icon
 *   swaps in place to "check" (--ok) for ~1.4s, then reverts to "copy"; a
 *   rapid re-click cancels the pending revert and restarts it. On failure
 *   (API rejected or unavailable) the icon swaps to "error" (--danger)
 *   briefly and the failure is logged via console.warn — sac:copy does not
 *   fire.
 *
 * The button is a native <button> in the shadow root, so focus and keyboard
 * activation come for free. Host is display: inline-flex.
 *
 * Compact/touch: under (pointer: coarse) the button keeps its 26px look and
 * gets an invisible 44 x 44 hit halo — the same rule as ui.css's .icon-btn,
 * whose twin this is. Under (hover: none) no hover wash sticks after a tap;
 * the check/error icon swap is the feedback. Copy needs a secure context
 * (https or localhost) on phones too.
 */
(function () {

    /** Kit i18n: sac.t when globals.js is loaded, the English fallback when
     *  the component runs standalone. */
    const t = (key, fallback) =>
        (window.sac && window.sac.t) ? window.sac.t(key, fallback) : fallback;

class SacCopyButton extends HTMLElement {
    static get observedAttributes() { return ["value", "for", "label"]; }

    constructor() {
        super();
        this.attachShadow({ mode: "open" });
        this._stateTimer = null;
        this._onClick = this._onClick.bind(this);
    }

    connectedCallback() {
        if (!this.shadowRoot.firstChild) this._render();
        else this._syncLabel();
        // Runtime language switch: the default label follows in place.
        if (window.sac && sac.lang && !this._offLang) this._offLang = sac.lang.onChange(() => this._relabel());
    }

    disconnectedCallback() {
        clearTimeout(this._stateTimer);
        if (this._offLang) { this._offLang(); this._offLang = null; }
    }

    /** Kit strings in the current language (an app label stays as given). */
    _relabel() {
        this._syncLabel();
    }

    attributeChangedCallback(name) {
        if (!this.shadowRoot.firstChild) return;   // pre-upgrade attribute
        if (name === "label") this._syncLabel();
        // value/for carry no visual state — read fresh at click time.
    }

    /* ------------------------------------------------------------- render */

    _render() {
        this.shadowRoot.innerHTML = `
            <style>
                :host {
                    display: inline-flex;
                    font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
                }
                /* The .icon-btn recipe from ui.css — shared via the
                   --icon-btn-* tokens, since the class can't reach in here. */
                button {
                    --icon-size: var(--icon-btn-icon);
                    display: inline-flex;
                    align-items: center;
                    justify-content: center;
                    width: var(--icon-btn-size);
                    height: var(--icon-btn-size);
                    padding: 0;
                    border: none;
                    border-radius: var(--radius-m);
                    background: transparent;
                    color: var(--text-dim);
                    cursor: pointer;
                    transition: color 120ms var(--ease-smooth), background 120ms var(--ease-smooth);
                }
                button:hover:not(:disabled) {
                    background: var(--hover);
                    color: var(--text);
                }
                button:focus-visible {
                    outline: 2px solid var(--accent);
                    outline-offset: 1px;
                }
                button.ok   { color: var(--ok-text); }
                button.err  { color: var(--danger-text); }
                button.ok:hover:not(:disabled),
                button.err:hover:not(:disabled) {
                    background: var(--hover);
                }
                sac-icon {
                    opacity: 1;
                    transition: opacity 100ms var(--ease-smooth);
                }

                /* Touch — the twin of ui.css's coarse .icon-btn rule: the
                   26px look stays, an invisible halo takes the hit area to
                   44px. Keep the two in step. */
                @media (pointer: coarse) {
                    button { position: relative; }
                    button::after {
                        content: "";
                        position: absolute;
                        inset: calc((var(--icon-btn-size) - 44px) / 2);
                    }
                }
                /* A tap leaves :hover stuck — no wash after the copy. */
                @media (hover: none) {
                    button:hover:not(:disabled) { background: transparent; color: var(--text-dim); }
                    button.ok:hover:not(:disabled)  { background: transparent; color: var(--ok-text); }
                    button.err:hover:not(:disabled) { background: transparent; color: var(--danger-text); }
                }
                @media (prefers-reduced-motion: reduce) {
                    button, sac-icon { transition: none; }
                }
            </style>
            <button type="button" id="btn">
                <sac-icon name="copy" id="icon"></sac-icon>
            </button>
        `;

        this._btn = this.shadowRoot.getElementById("btn");
        this._icon = this.shadowRoot.getElementById("icon");
        this._btn.addEventListener("click", this._onClick);

        this._syncLabel();
    }

    _syncLabel() {
        if (!this._btn) return;
        const label = this.getAttribute("label") || t("copy-button.copy", "Copy");
        this._btn.setAttribute("aria-label", label);
        this._btn.title = label;
    }

    /* --------------------------------------------------------------- copy */

    _resolveText() {
        const value = this.getAttribute("value");
        if (value != null) return value;
        const sel = this.getAttribute("for");
        if (sel) {
            const el = document.querySelector(sel);
            if (el) return (el.textContent || "").trim();
        }
        return "";
    }

    async _onClick() {
        const text = this._resolveText();
        if (!text) return;

        let ok = false;
        try {
            if (!navigator.clipboard || !navigator.clipboard.writeText) {
                throw new Error("Clipboard API unavailable");
            }
            await navigator.clipboard.writeText(text);
            ok = true;
        } catch (err) {
            console.warn("sac-copy-button: copy failed", err);
            ok = false;
        }

        clearTimeout(this._stateTimer);
        this._btn.classList.remove("ok", "err");
        this._btn.classList.add(ok ? "ok" : "err");
        this._icon.setAttribute("name", ok ? "check" : "error");

        if (ok) {
            this.dispatchEvent(new CustomEvent("sac:copy", {
                detail: { text },
                bubbles: true,
                composed: true,
            }));
        }

        const duration = ok ? 1400 : 1200;
        this._stateTimer = setTimeout(() => {
            this._btn.classList.remove("ok", "err");
            this._icon.setAttribute("name", "copy");
            this._stateTimer = null;
        }, duration);
    }
}

customElements.define("sac-copy-button", SacCopyButton);
})();
