/**
 * <sac-avatar name="Ada Lovelace"></sac-avatar>
 * <sac-avatar name="Ada Lovelace" src="ada.png"></sac-avatar>
 * <sac-avatar name="Build Bot" label="BB" style="--avatar-size: 48px"></sac-avatar>
 *
 * A round identity badge — initials-by-default, image-when-available.
 * Composes with `--avatar-size` alone: stack several at different sizes, or
 * lay a row of them out with plain flex/grid gap. (A dedicated `.avatar-stack`
 * overlap pattern is not part of this component — the style guide may add
 * that as a CSS recipe later.)
 *
 * Sizing:
 *   --avatar-size — diameter, default 32px. Font scales with it
 *                   (calc(var(--avatar-size, 32px) * 0.4), weight 600).
 *
 * Color (deterministic, no raw colors):
 *   The `name` string is hashed (djb2-style) to pick one of the kit's ten
 *   --palette-* slots. Background is that slot at 25% via color-mix(), text
 *   is the full slot color — same "one token, tint + fill" pattern as
 *   <sac-chip>. Same name always lands on the same slot; no name at all
 *   falls back to --accent-tint / --accent instead of a palette slot.
 *
 * Attributes:
 *   name  — subject's display name. Source of the computed initials, the
 *           color hash and (absent a `label` override) the accessible name.
 *   src   — image URL. Rendered over the initials layer; on load error the
 *           component falls back to initials automatically. The <img> node
 *           only lives in the shadow DOM while a src is set — an avatar
 *           without a photo is just its initials span. The node itself (and
 *           its load/error handlers) persists across src changes.
 *   label — verbatim override for the initials text (e.g. "BB"). Also wins
 *           as the accessible name when `name` is empty.
 *
 * Initials (no `label`): first character of each of the first two
 * whitespace-separated words of `name`, uppercased. A single word uses its
 * own first two characters instead.
 *
 * Accessibility: host is role="img", aria-label mirrors name (or label when
 * name is empty). Inner layers are aria-hidden — the host is the one
 * accessible node.
 */
class SacAvatar extends HTMLElement {
    static get observedAttributes() { return ["name", "src", "label"]; }

    constructor() {
        super();
        this.attachShadow({ mode: "open" });
    }

    connectedCallback() {
        this.setAttribute("role", "img");
        if (!this.shadowRoot.firstChild) this._render();
        else this._refresh();
    }

    attributeChangedCallback() {
        if (this.shadowRoot.firstChild) this._refresh();
    }

    /* ------------------------------------------------------------- render */

    _render() {
        this.shadowRoot.innerHTML = `
            <style>
                :host {
                    display: inline-flex;
                    align-items: center;
                    justify-content: center;
                    position: relative;
                    overflow: hidden;
                    flex: none;
                    vertical-align: middle;
                    width: var(--avatar-size, 32px);
                    height: var(--avatar-size, 32px);
                    border-radius: 50%;
                    background: var(--avatar-bg);
                    color: var(--avatar-fg);
                    font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
                    font-size: calc(var(--avatar-size, 32px) * 0.4);
                    font-weight: 600;
                    line-height: 1;
                    letter-spacing: 0.01em;
                    user-select: none;
                }
                .initials {
                    position: absolute;
                    inset: 0;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    white-space: nowrap;
                    /* The initials are always caps — no descenders — but the
                       line box still reserves descent space, so centering the
                       box parks the letters above the circle's optical middle.
                       Trim the box to the cap height and center the glyphs
                       themselves. (Quietly ignored where unsupported.) */
                    text-box: trim-both cap alphabetic;
                }
                img {
                    position: absolute;
                    inset: 0;
                    width: 100%;
                    height: 100%;
                    display: block;
                    object-fit: cover;
                    border-radius: 50%;
                    opacity: 0;
                    transition: opacity 150ms var(--ease-smooth);
                }
                img.loaded { opacity: 1; }

                @media (prefers-reduced-motion: reduce) {
                    img { transition: none; }
                }
            </style>
            <span class="initials" id="initials" aria-hidden="true"></span>
        `;

        this._initialsEl = this.shadowRoot.getElementById("initials");

        // Created once (listeners bound once), but only APPENDED while a src
        // is set — no src-less <img> lingering in the inspector.
        this._imgEl = document.createElement("img");
        this._imgEl.alt = "";
        this._imgEl.setAttribute("aria-hidden", "true");

        this._imgEl.addEventListener("load", () => {
            // Guards a stale async load that resolves after src was cleared.
            if (this._imgEl.getAttribute("src")) this._imgEl.classList.add("loaded");
        });
        this._imgEl.addEventListener("error", () => {
            this._imgEl.classList.remove("loaded");
        });

        this._refresh();
    }

    /* --------------------------------------------------------- refresh(es) */

    _refresh() {
        const name = this.getAttribute("name") || "";
        const hasLabel = this.hasAttribute("label");
        const label = hasLabel ? this.getAttribute("label") : null;

        this._initialsEl.textContent = hasLabel ? label : SacAvatar._computeInitials(name);

        const src = this.getAttribute("src");
        if (src) {
            this._imgEl.alt = name;
            if (this._imgEl.getAttribute("src") !== src) {
                this._imgEl.classList.remove("loaded");   // hide until the new src loads
                this._imgEl.setAttribute("src", src);
            }
            if (!this._imgEl.isConnected) this.shadowRoot.appendChild(this._imgEl);
        } else {
            this._imgEl.remove();
            this._imgEl.classList.remove("loaded");
            this._imgEl.removeAttribute("src");
            this._imgEl.alt = "";
        }

        this._applyColor(name);

        const accessibleName = name.trim() || (hasLabel ? String(label).trim() : "");
        if (accessibleName) this.setAttribute("aria-label", accessibleName);
        else this.removeAttribute("aria-label");
    }

    _applyColor(name) {
        if (!name) {
            this.style.setProperty("--avatar-fg", "var(--accent)");
            this.style.setProperty("--avatar-bg", "var(--accent-tint)");
            return;
        }
        const slot = SacAvatar.PALETTE[SacAvatar._hash(name) % SacAvatar.PALETTE.length];
        const token = `var(--palette-${slot})`;
        this.style.setProperty("--avatar-fg", token);
        this.style.setProperty("--avatar-bg", `color-mix(in srgb, ${token} 25%, transparent)`);
    }

    /* ---------------------------------------------------------- utilities */

    static _computeInitials(name) {
        const trimmed = name.trim();
        if (!trimmed) return "";
        const words = trimmed.split(/\s+/);
        if (words.length >= 2) {
            return (words[0].charAt(0) + words[1].charAt(0)).toUpperCase();
        }
        return trimmed.slice(0, 2).toUpperCase();
    }

    /** djb2-style string hash, always non-negative. */
    static _hash(str) {
        let h = 5381;
        for (let i = 0; i < str.length; i++) {
            h = ((h * 33) ^ str.charCodeAt(i)) | 0;
        }
        return h >>> 0;
    }
}

/** The ten data-palette slot names from ui.css, in declaration order. */
SacAvatar.PALETTE = [
    "blue", "orange", "red", "green", "purple",
    "pink", "yellow", "teal", "gray", "indigo",
];

customElements.define("sac-avatar", SacAvatar);
