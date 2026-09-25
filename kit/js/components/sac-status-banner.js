/**
 * <sac-status-banner>  —  Inline, non-modal status message.
 *
 * Sits where you place it in the DOM (typically at the top of a form panel),
 * stays hidden until something happens, shows a tinted strip with a short
 * message. No modal overlay, no auto-dismiss — callers decide when to clear.
 * This is the missing half of a form system: the input styling says what a
 * field IS, the banner says what went WRONG (or right).
 *
 * Usage:
 *   <sac-status-banner id="form-status"></sac-status-banner>
 *   ...
 *   formStatus.show("Name is required.", "error");
 *   formStatus.show("Key saved.", "success");
 *   formStatus.hide();
 *
 * Attributes (declarative equivalent of the JS API):
 *   kind     — "error" (default) | "info" | "warn" | "success"
 *   message  — the text to display
 *   open     — presence makes the banner visible
 *
 * All four kinds map to semantic seeds: error→--danger, info→--accent,
 * warn→--accent-warm, success→--ok.
 *
 * Compact/touch: in flow and full width, so it follows its container; long
 * unbroken strings (paths, URLs, error codes) wrap rather than pushing the
 * page sideways at 360px. Nothing to tap — it has no controls.
 */
class SacStatusBanner extends HTMLElement {
    static get observedAttributes() { return ["kind", "message", "open"]; }

    constructor() {
        super();
        this.attachShadow({ mode: "open" });
    }

    connectedCallback() {
        if (!this.shadowRoot.firstChild) this._render();
        this._sync();
    }

    attributeChangedCallback() {
        if (this.shadowRoot.firstChild) this._sync();
    }

    // Imperative API. Most callers use these rather than fiddling with
    // attributes — it reads more naturally at the call site.
    show(message, kind = "error") {
        if (message != null) this.setAttribute("message", String(message));
        this.setAttribute("kind", kind);
        this.setAttribute("open", "");
    }

    hide() {
        this.removeAttribute("open");
    }

    _render() {
        this.shadowRoot.innerHTML = `
            <style>
                :host {
                    display: none;
                    margin: 0 0 14px;
                    font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
                }
                :host([open]) { display: block; }

                .banner {
                    padding: 10px 12px;
                    border-radius: var(--radius-l);
                    font-size: 13px;
                    line-height: 1.4;
                    border: 1px solid transparent;
                    overflow-wrap: anywhere;
                }

                :host([kind="error"]) .banner,
                :host(:not([kind])) .banner {
                    background: color-mix(in srgb, var(--danger) 10%, transparent);
                    border-color: color-mix(in srgb, var(--danger) 40%, transparent);
                    color: color-mix(in oklab, var(--danger) 60%, var(--fg));
                }

                :host([kind="info"]) .banner {
                    background: color-mix(in srgb, var(--accent) 10%, transparent);
                    border-color: color-mix(in srgb, var(--accent) 40%, transparent);
                    color: color-mix(in oklab, var(--accent) 70%, var(--fg));
                }

                :host([kind="warn"]) .banner {
                    background: color-mix(in srgb, var(--accent-warm) 10%, transparent);
                    border-color: color-mix(in srgb, var(--accent-warm) 40%, transparent);
                    color: color-mix(in oklab, var(--accent-warm) 65%, var(--fg));
                }

                :host([kind="success"]) .banner {
                    background: color-mix(in srgb, var(--ok) 10%, transparent);
                    border-color: color-mix(in srgb, var(--ok) 40%, transparent);
                    color: color-mix(in oklab, var(--ok) 60%, var(--fg));
                }
            </style>
            <div class="banner" role="alert" id="msg"></div>
        `;
    }

    _sync() {
        const el = this.shadowRoot.getElementById("msg");
        if (el) el.textContent = this.getAttribute("message") || "";
    }
}

customElements.define("sac-status-banner", SacStatusBanner);
