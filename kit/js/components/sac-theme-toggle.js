/**
 * <sac-theme-toggle>
 *
 * Self-contained three-way pill switch for the page theme: Dark / Light /
 * Auto. Reads/writes localStorage and flips document.documentElement's
 * data-theme itself — drop one instance anywhere (typically the sac-nav
 * "context" slot) and it themes the whole page. Buttons are shadow-internal;
 * nothing here is slotted.
 *
 * Semantics:
 *   dark  — removes data-theme from <html> (the kit's default ground).
 *   light — <html data-theme="light">.
 *   auto  — <html data-theme="auto"> (caller/CSS decides what "auto" means).
 *
 * Persistence: localStorage key "sac-theme" holds "light" or "auto"; any
 * other value — including no key at all — means dark, and choosing "dark"
 * is stored by removing the key rather than writing it.
 *
 * On connect: reads the stored theme, applies it, and highlights the
 * matching button.
 *
 * Properties:
 *   theme — get/set "dark" | "light" | "auto". Setting applies + persists
 *           + re-highlights the pill; it does not dispatch the change
 *           event (that's reserved for user clicks, same split as
 *           sac-slider's attribute-vs-interaction event model).
 *
 * Compact/touch: under (pointer: coarse) each of the three buttons gets an
 * invisible hit halo to 44px tall (the pill keeps its size, so it still fits
 * the nav ribbon); under (hover: none) no hover tint sticks after a tap.
 * INSIDE A <sac-nav> on compact (ui.css §15) the ~145px pill would
 * push the app's own toolbar into the "…" menu, so it collapses to ONE
 * round button (36px, 44px on touch) that cycles dark → light → auto; its
 * icon shows the current theme and its label says it ("Theme: Dark").
 *
 * Attributes:
 *   collapse — "never" keeps the pill even in a phone ribbon. Absent = the
 *              nav collapse above. A toggle placed in page content (a
 *              settings page) never collapses — it has the room.
 *   in-nav   — set BY THE COMPONENT when it sits inside a <sac-nav>.
 *
 * Events:
 *   sac:change — fired on user click only (never on a programmatic .theme set);
 *                detail = { value: theme }, bubbles (not composed).
 */
(function () {

    /** Kit i18n: sac.t when globals.js is loaded, the English fallback when
     *  the component runs standalone. */
    const t = (key, fallback) =>
        (window.sac && window.sac.t) ? window.sac.t(key, fallback) : fallback;

class SacThemeToggle extends HTMLElement {
    constructor() {
        super();
        this.attachShadow({ mode: "open" });
        this._theme = "dark";
    }

    connectedCallback() {
        if (!this.shadowRoot.firstChild) this._render();
        this.toggleAttribute("in-nav", !!this.closest("sac-nav"));
        const stored = localStorage.getItem("sac-theme");
        const theme = stored === "light" || stored === "auto" ? stored : "dark";
        this._apply(theme);
        this._theme = theme;
        this._highlight(theme);
        if (window.sac && sac.lang && !this._offLang) this._offLang = sac.lang.onChange(() => this._relabel());
    }

    disconnectedCallback() {
        if (this._offLang) { this._offLang(); this._offLang = null; }
    }

    /** Language switch: pill texts + the cycle button's label, in place. */
    _relabel() {
        const names = { dark: "Dark", light: "Light", auto: "Auto" };
        this.shadowRoot.querySelectorAll(".pill button").forEach((btn) => {
            const th = btn.dataset.theme;
            btn.textContent = t("theme-toggle." + th, names[th]);
        });
        this._highlight(this._theme);
    }

    get theme() { return this._theme; }
    set theme(v) {
        const theme = v === "light" || v === "auto" ? v : "dark";
        this._apply(theme);
        this._persist(theme);
        this._theme = theme;
        this._highlight(theme);
    }

    _apply(theme) {
        const root = document.documentElement;
        if (theme === "light") root.setAttribute("data-theme", "light");
        else if (theme === "auto") root.setAttribute("data-theme", "auto");
        else root.removeAttribute("data-theme");
    }

    _persist(theme) {
        if (theme === "dark") localStorage.removeItem("sac-theme");
        else localStorage.setItem("sac-theme", theme);
    }

    /** Update the active button in place — no re-render. */
    _highlight(theme) {
        const cycle = this.shadowRoot.querySelector(".cycle");
        if (cycle) {
            cycle.dataset.current = theme;
            const label = `${t("theme-toggle.label", "Theme")}: ${
                t("theme-toggle." + theme, theme[0].toUpperCase() + theme.slice(1))}`;
            cycle.setAttribute("aria-label", label);
            cycle.title = label;
        }
        this.shadowRoot.querySelectorAll(".pill button").forEach((btn) => {
            const active = btn.dataset.theme === theme;
            btn.classList.toggle("active", active);
            btn.setAttribute("aria-pressed", String(active));
        });
    }

    _select(theme) {
        this._apply(theme);
        this._persist(theme);
        this._theme = theme;
        this._highlight(theme);
        // Value control (the picked theme). Only _select() — a user click —
        // dispatches; the `theme` setter (used by apps.js to SYNC the toggle)
        // stays silent, or that sync would loop. Bubbles, not composed.
        this.dispatchEvent(new CustomEvent("sac:change", {
            detail: { value: theme },
            bubbles: true,
            composed: false,
        }));
    }

    _render() {
        // Kit strings land in TEXT positions of the template below.
        const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;");
        const L = {
            dark:  esc(t("theme-toggle.dark",  "Dark")),
            light: esc(t("theme-toggle.light", "Light")),
            auto:  esc(t("theme-toggle.auto",  "Auto")),
        };
        this.shadowRoot.innerHTML = `
            <style>
                :host { display: inline-flex; }
                .pill {
                    display: inline-flex;
                    gap: 4px;
                    background: var(--field);
                    /* Same hairline as sac-segmented-control: keeps the track
                       visible on light ground so the inset active segment
                       reads as inset, not shorter. */
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
                button.active {
                    background: var(--accent-fill);
                    color: var(--on-accent);
                }
                /* Touch: the pill keeps its look (it sits in the 50px nav
                   ribbon); each button gets an invisible halo to 44px —
                   min(): only a short axis grows, so neighbours do not
                   overlap sideways. */
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

                /* The phone-ribbon form: one round button that cycles. The
                   .nav-icon-btn recipe, written out (ui.css does not pierce
                   a shadow root). Only the icon of the current theme shows. */
                .cycle {
                    display: none;
                    width: 36px;
                    height: 36px;
                    padding: 0;
                    align-items: center;
                    justify-content: center;
                    border-radius: 50%;
                    color: var(--text-muted);
                }
                .cycle svg { width: 20px; height: 20px; display: none; }
                .cycle[data-current="dark"]  .i-dark,
                .cycle[data-current="light"] .i-light,
                .cycle[data-current="auto"]  .i-auto { display: block; }
                .cycle:hover { background: var(--hover); color: var(--text); }
                button:focus-visible {
                    outline: 2px solid var(--accent);
                    outline-offset: 2px;
                }
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
            <div class="pill">
                <button type="button" data-theme="dark">${L.dark}</button>
                <button type="button" data-theme="light">${L.light}</button>
                <button type="button" data-theme="auto">${L.auto}</button>
            </div>
            <button type="button" class="cycle">
                <svg class="i-dark" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
                <svg class="i-light" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/></svg>
                <svg class="i-auto" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 3v18a9 9 0 0 0 0-18z" fill="currentColor"/></svg>
            </button>
        `;
        this.shadowRoot.querySelectorAll(".pill button").forEach((btn) => {
            btn.addEventListener("click", () => this._select(btn.dataset.theme));
        });
        const order = ["dark", "light", "auto"];
        this.shadowRoot.querySelector(".cycle").addEventListener("click", () =>
            this._select(order[(order.indexOf(this._theme) + 1) % order.length]));
    }
}

customElements.define("sac-theme-toggle", SacThemeToggle);
})();
