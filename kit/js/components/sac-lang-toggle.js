/**
 * <sac-lang-toggle>
 *
 * The page's language switch — the twin of <sac-theme-toggle>, and the same
 * ownership: ONE value for the whole page (sac.lang), so on a desktop the
 * HOST shows it; a standalone app puts it in its own nav. Drop one instance
 * anywhere (typically the sac-nav "context" slot) and every kit component
 * and every app listening to context.lang switches with it.
 *
 * A pill: Auto · EN · DE · … — one button per language that has a table
 * (sac.lang.available()), each titled with the language's own name
 * ("Deutsch"). "Auto" follows the system language as far as the browser
 * shows it (sac.lang: the first match in navigator.languages, else English).
 *
 * Compact/touch: exactly like the theme toggle — each button gets a 44px hit
 * halo under (pointer: coarse); INSIDE A <sac-nav> on compact the pill
 * collapses to ONE round button that cycles auto → en → de → … and shows
 * the current code (a globe while on auto); its label names the language.
 *
 * Attributes:
 *   collapse — "never" keeps the pill even in a phone ribbon.
 *   in-nav   — set BY THE COMPONENT when it sits inside a <sac-nav>.
 *
 * Properties:
 *   value — get/set "auto" | a language code. Setting applies (sac.lang.set)
 *           and fires nothing — the change event is for user clicks.
 *
 * Events:
 *   sac:change — user click only; detail = { value } ("auto" or a code),
 *                bubbles (not composed).
 */
(function () {
    const TAG = "sac-lang-toggle";
    if (customElements.get(TAG)) return;

    const t = (key, fallback) =>
        (window.sac && window.sac.t) ? window.sac.t(key, fallback) : fallback;
    const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");

    class SacLangToggle extends HTMLElement {
        constructor() {
            super();
            this.attachShadow({ mode: "open" });
        }

        connectedCallback() {
            this.toggleAttribute("in-nav", !!this.closest("sac-nav"));
            this._render();
            // Re-render on every switch: the labels are in the new language,
            // and a table that arrived meanwhile adds its button.
            if (window.sac && sac.lang && !this._off) this._off = sac.lang.onChange(() => this._render());
        }

        disconnectedCallback() {
            if (this._off) { this._off(); this._off = null; }
        }

        get value() { return window.sac && sac.lang ? sac.lang.mode() : "auto"; }
        set value(v) { if (window.sac && sac.lang) sac.lang.set(v); this._render(); }

        _options() {
            const langs = window.sac && sac.lang ? sac.lang.available() : ["en"];
            return ["auto", ...langs];
        }

        _label(code) {
            if (code === "auto") return t("lang-toggle.auto", "Auto");
            return code.toUpperCase();
        }

        _title(code) {
            if (code === "auto") {
                const now = window.sac && sac.lang ? sac.lang.get() : "en";
                return `${t("lang-toggle.auto-title", "Follow the system")} (${sac.lang ? sac.lang.name(now) : now})`;
            }
            return window.sac && sac.lang ? sac.lang.name(code) : code;
        }

        _select(code) {
            if (window.sac && sac.lang) sac.lang.set(code);
            this._render();
            this.dispatchEvent(new CustomEvent("sac:change", {
                detail: { value: code }, bubbles: true, composed: false,
            }));
        }

        _render() {
            const mode = this.value;
            const opts = this._options();
            const label = `${t("lang-toggle.label", "Language")}: ${this._title(mode)}`;
            this.shadowRoot.innerHTML = `
                <style>
                    :host { display: inline-flex; }
                    .pill {
                        display: inline-flex;
                        gap: 4px;
                        background: var(--field);
                        border: 1px solid var(--border);
                        border-radius: var(--radius-m);
                        padding: 2px;
                    }
                    button {
                        appearance: none;
                        border: none;
                        background: none;
                        cursor: pointer;
                        font: inherit;
                        font-size: 0.72rem;
                        font-weight: 600;
                        padding: 4px 10px;
                        border-radius: var(--radius-s);
                        color: var(--text-muted);
                        transition: color 0.15s var(--ease-smooth), background 0.15s var(--ease-smooth);
                    }
                    button:hover { color: var(--text); }
                    button.active { background: var(--accent-fill); color: var(--on-accent); }
                    button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
                    @media (pointer: coarse) {
                        button { position: relative; }
                        button::after {
                            content: "";
                            position: absolute;
                            inset: min(0px, calc((100% - 44px) / 2));
                        }
                    }
                    @media (hover: none) {
                        button:hover { color: var(--text-muted); }
                        button.active:hover { color: var(--on-accent); }
                    }
                    /* Phone-ribbon form: one round button that cycles. */
                    .cycle {
                        display: none;
                        width: 36px;
                        height: 36px;
                        padding: 0;
                        align-items: center;
                        justify-content: center;
                        border-radius: 50%;
                        color: var(--text-muted);
                        font-size: 0.7rem;
                        letter-spacing: 0.02em;
                    }
                    .cycle svg { width: 20px; height: 20px; }
                    .cycle:hover { background: var(--hover); color: var(--text); }
                    @media (max-width: 768px), (max-height: 480px) and (pointer: coarse) {
                        :host([in-nav]:not([collapse="never"])) .pill { display: none; }
                        :host([in-nav]:not([collapse="never"])) .cycle { display: inline-flex; }
                    }
                    @media (pointer: coarse) {
                        .cycle { width: 44px; height: 44px; }
                        .cycle::after { content: none; }
                    }
                    @media (hover: none) {
                        .cycle:hover { background: none; color: var(--text-muted); }
                    }
                    @media (prefers-reduced-motion: reduce) {
                        button { transition: none; }
                    }
                </style>
                <div class="pill" role="group" aria-label="${esc(t("lang-toggle.label", "Language"))}">
                    ${opts.map((c) => `<button type="button" data-lang="${esc(c)}"
                        class="${c === mode ? "active" : ""}" aria-pressed="${c === mode}"
                        title="${esc(this._title(c))}">${esc(this._label(c))}</button>`).join("")}
                </div>
                <button type="button" class="cycle" title="${esc(label)}" aria-label="${esc(label)}">${
                    mode === "auto"
                        ? `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>`
                        : esc(mode.toUpperCase())
                }</button>
            `;
            this.shadowRoot.querySelectorAll(".pill button").forEach((btn) =>
                btn.addEventListener("click", () => this._select(btn.dataset.lang)));
            this.shadowRoot.querySelector(".cycle").addEventListener("click", () =>
                this._select(opts[(opts.indexOf(mode) + 1) % opts.length]));
        }
    }

    customElements.define(TAG, SacLangToggle);
})();
