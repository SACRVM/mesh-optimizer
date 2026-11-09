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
 * warn→--accent-warm, success→--ok. The kind is never the tint alone: a
 * leading icon names it by shape (the sac-toast set — error, info, warn,
 * success), and the icon's colour carries the kind, as in sac-toast.
 *
 * Announcements: error and warn are role="alert" (assertive), info and
 * success role="status" (polite). The live text is set a frame after it is
 * cleared, so showing the SAME message again — show() twice, or the
 * attributes set again — is read again. (The visible text is a twin that
 * never blinks; the live copy is screen-reader-only.)
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

    disconnectedCallback() {
        cancelAnimationFrame(this._raf);
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
        this._sync();             // the same message again is still news
    }

    hide() {
        this.removeAttribute("open");
    }

    _kind() {
        const k = this.getAttribute("kind");
        return SacStatusBanner.ICONS[k] ? k : "error";
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
                    display: flex;
                    align-items: flex-start;
                    gap: 8px;
                    padding: 10px 12px;
                    border-radius: var(--radius-l);
                    font-size: 13px;
                    line-height: 1.4;
                    border: 1px solid transparent;
                    overflow-wrap: anywhere;
                }
                .text { flex: 1 1 auto; min-width: 0; }
                /* The kind's shape; its colour is the kind's ink, as in
                   sac-toast (icon colour carries the kind). */
                .icon {
                    --icon-size: 16px;
                    flex: none;
                    /* One line of 13px × 1.4 is ~18px: centre the glyph on it. */
                    margin-top: 1px;
                    color: var(--kind-ink);
                }
                .sr {
                    position: absolute;
                    width: 1px;
                    height: 1px;
                    margin: -1px;
                    padding: 0;
                    overflow: hidden;
                    clip: rect(0 0 0 0);
                    white-space: nowrap;
                    border: 0;
                }

                :host([kind="error"]) .banner,
                :host(:not([kind])) .banner {
                    --kind-ink: var(--danger-text);
                    background: color-mix(in srgb, var(--danger) 10%, transparent);
                    border-color: color-mix(in srgb, var(--danger) 40%, transparent);
                    color: color-mix(in oklab, var(--danger) 60%, var(--fg));
                }

                :host([kind="info"]) .banner {
                    --kind-ink: var(--accent-text);
                    background: color-mix(in srgb, var(--accent) 10%, transparent);
                    border-color: color-mix(in srgb, var(--accent) 40%, transparent);
                    color: color-mix(in oklab, var(--accent) 70%, var(--fg));
                }

                :host([kind="warn"]) .banner {
                    --kind-ink: var(--accent-warm-text);
                    background: color-mix(in srgb, var(--accent-warm) 10%, transparent);
                    border-color: color-mix(in srgb, var(--accent-warm) 40%, transparent);
                    color: color-mix(in oklab, var(--accent-warm) 65%, var(--fg));
                }

                :host([kind="success"]) .banner {
                    --kind-ink: var(--ok-text);
                    background: color-mix(in srgb, var(--ok) 10%, transparent);
                    border-color: color-mix(in srgb, var(--ok) 40%, transparent);
                    color: color-mix(in oklab, var(--ok) 60%, var(--fg));
                }
            </style>
            <div class="banner" part="banner">
                <sac-icon class="icon" aria-hidden="true"></sac-icon>
                <div class="text" id="msg" aria-hidden="true"></div>
                <div class="sr" id="live"></div>
            </div>
        `;
    }

    _sync() {
        const el = this.shadowRoot.getElementById("msg");
        const live = this.shadowRoot.getElementById("live");
        if (!el || !live) return;
        const message = this.getAttribute("message") || "";
        const kind = this._kind();
        el.textContent = message;
        this.shadowRoot.querySelector(".icon").setAttribute("name", SacStatusBanner.ICONS[kind]);
        // Urgency rides in the semantics, not only in the colour.
        const role = (kind === "error" || kind === "warn") ? "alert" : "status";
        if (live.getAttribute("role") !== role) live.setAttribute("role", role);
        // Clear, then set a frame later: a change the reader is told about
        // even when the words are the same as last time.
        cancelAnimationFrame(this._raf);
        live.textContent = "";
        if (!this.hasAttribute("open") || !message) return;
        this._raf = requestAnimationFrame(() => { live.textContent = message; });
    }
}

/** kind → sac.icons name (the sac-toast set). */
SacStatusBanner.ICONS = {
    error:   "error",
    info:    "info",
    warn:    "warn",
    success: "success",
};

customElements.define("sac-status-banner", SacStatusBanner);
