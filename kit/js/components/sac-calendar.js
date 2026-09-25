/**
 * <sac-calendar value="2026-08-15"></sac-calendar>
 * <sac-calendar value="2026-08-15" min="2026-08-01" max="2026-12-31" week-start="0"></sac-calendar>
 *
 * An embeddable month calendar: a paged header (‹ month, ‹‹ year, ‹‹‹ decade
 * — a birth date 50 years back is five clicks, not six hundred), weekday row,
 * and a fixed 6×7 day grid that never changes height — leading and trailing
 * days of the neighbor months fill the frame, dimmed but clickable. The
 * displayed month is internal state, decoupled from the selection: paging
 * never touches `value`, and adopting a value jumps the view to its month.
 *
 * Dates cross the API as ISO strings ("yyyy-mm-dd") — never Date objects.
 * All math runs on local calendar dates, so there is no UTC off-by-one and
 * 2026-02-31 is rejected as the non-date it is. Month and weekday names come
 * from Intl in the browser's locale — no locale data is shipped, and no
 * time zones exist here: the suite speaks pure local calendar dates.
 *
 * Attributes:
 *   value      — ISO selected date, reflected. Read tolerantly (whitespace
 *                trimmed, single-digit month/day zero-padded) and written
 *                back NORMALIZED, so attribute and property never disagree.
 *                Setting it programmatically updates in place and fires
 *                NOTHING — the caller already knows. An unparseable or
 *                impossible date is ignored and the attribute is healed back
 *                to the current selection. Empty / absent = no selection.
 *   min, max   — ISO bounds, inclusive. Days outside render disabled: the
 *                keyboard walk still lands on them (a walk that teleports is
 *                worse than one that pauses), but click and Enter/Space do
 *                nothing there. Unparseable bounds count as absent.
 *   week-start — "1" (default, Monday) or "0" (Sunday). First column of the
 *                grid and the Home/End week edges follow it.
 *
 * Properties:
 *   value — get/set, normalized ISO or "". Readable before connect.
 *
 * Methods:
 *   focus(options) — focuses the tabbable day cell.
 *
 * Events:
 *   sac:change — detail { value }, bubbles + composed. Fired on USER
 *           selection only (click, Enter/Space), and only when the date
 *           actually changes — re-selecting the selected day stays quiet.
 *
 * CSS custom properties:
 *   --calendar-width — width of the whole calendar. Default 280px (320px
 *                      under (pointer: coarse), see below). Never wider
 *                      than its container: the day cells shrink instead.
 *
 * Keyboard (grid pattern, roving tabindex — one day cell in the tab order):
 *   Arrows          — ±1 day (left/right), ±7 days (up/down)
 *   PageUp/PageDown — ±1 month, with Shift ±1 year (day clamps: Jan 31 pages
 *                     to Feb 28/29, a leap day steps to Feb 28)
 *   Home/End        — start / end of the focused week
 *   Enter/Space     — select the focused day
 *   The walk crosses month boundaries and the view follows the focus; the
 *   grid is built once and retargeted in place, never rebuilt.
 *
 * Notes:
 *   - Today wears a small accent dot; the selected day wears the 2px accent
 *     outline. Selecting a dimmed neighbor-month day navigates AND selects.
 *   - ARIA: role="grid", weekday columnheaders, day cells role="gridcell"
 *     with aria-selected and the full date (via Intl) as the label; the
 *     month label is aria-live="polite" so paging announces itself.
 *   - Requires sac-icon (lib/icons.js + components/sac-icon.js) for the
 *     header chevrons.
 *
 * Compact/touch:
 *   The calendar caps itself at 100% of its container (max-width), so it
 *   never overflows a 360px phone or a narrow panel — the 7 columns shrink.
 *   Under (pointer: coarse) the default width grows to 320px so a day cell
 *   is 44 x 44px (7 x 44 + 6 x 2 gap), and the header wraps: the month label
 *   takes a line of its own and the six paging buttons get 44px targets
 *   below it (seven 44px items would leave the label no room). Nothing is
 *   hover-only — the hover tint is decoration.
 */
(function () {

    /** Kit i18n: sac.t when globals.js is loaded, the English fallback when
     *  the component runs standalone. */
    const t = (key, fallback) =>
        (window.sac && window.sac.t) ? window.sac.t(key, fallback) : fallback;

    /* ------------------------------------------------------- date helpers */
    /* Plain { y, m, d } records (m is 1-based), Date objects only as local
       throwaway calculators — never as state, never parsed from strings. */

    /** Local Date for y/m/d via setFullYear, so years < 100 stay literal. */
    function makeDate(y, m, d) {
        const date = new Date(2000, 0, 1);
        date.setFullYear(y, m - 1, d);
        return date;
    }

    /** Tolerant ISO parse → { y, m, d } or null. Rejects impossible dates. */
    function parseISO(raw) {
        if (typeof raw !== "string") return null;
        const match = raw.trim().match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
        if (!match) return null;
        const y = Number(match[1]);
        const m = Number(match[2]);
        const d = Number(match[3]);
        // Date arithmetic rolls overflow forward (Feb 31 → Mar 3); a date
        // that comes back changed was never a date.
        const date = makeDate(y, m, d);
        if (date.getFullYear() !== y || date.getMonth() !== m - 1 || date.getDate() !== d) {
            return null;
        }
        return { y, m, d };
    }

    /** { y, m, d } → normalized zero-padded ISO. */
    function isoOf(d) {
        const p = (n, w) => String(n).padStart(w, "0");
        return `${p(d.y, 4)}-${p(d.m, 2)}-${p(d.d, 2)}`;
    }

    /** Comparable integer — 2026-08-15 → 20260815. */
    function keyOf(d) {
        return d.y * 10000 + d.m * 100 + d.d;
    }

    function daysInMonth(y, m) {
        return makeDate(y, m + 1, 0).getDate();
    }

    function addDays(d, delta) {
        const date = makeDate(d.y, d.m, d.d + delta);
        return { y: date.getFullYear(), m: date.getMonth() + 1, d: date.getDate() };
    }

    /** ±months with the day clamped, so Jan 31 pages to Feb 28/29. */
    function addMonths(d, delta) {
        const idx = (d.m - 1) + delta;
        const y = d.y + Math.floor(idx / 12);
        const m = ((idx % 12) + 12) % 12 + 1;
        return { y, m, d: Math.min(d.d, daysInMonth(y, m)) };
    }

    /** ±years with the day clamped, so Feb 29 steps to Feb 28. */
    function addYears(d, delta) {
        const y = d.y + delta;
        return { y, m: d.m, d: Math.min(d.d, daysInMonth(y, d.m)) };
    }

    function today() {
        const now = new Date();
        return { y: now.getFullYear(), m: now.getMonth() + 1, d: now.getDate() };
    }

    class SacCalendar extends HTMLElement {
        static get observedAttributes() { return ["value", "min", "max", "week-start"]; }

        constructor() {
            super();
            this.attachShadow({ mode: "open" });
            this._sel        = null;    // selected { y, m, d } or null
            this._active     = null;    // the roving-tabindex day; its month IS the view
            this._activeCell = null;
            this._ready      = false;   // connected at least once
            this._reflecting = false;   // our own setAttribute("value") is in flight
        }

        connectedCallback() {
            if (!this.shadowRoot.firstChild) {
                this._render();
                this._attach();
            }
            // Adopt the attribute (which may have been set before upgrade);
            // no selection → the view opens on today. Silent either way.
            this._adopt(this.getAttribute("value"));
            if (!this._active) this._active = today();
            this._ready = true;
            this._reflect();
            this._syncAll();
        }

        attributeChangedCallback(name) {
            if (!this._ready) return;          // connectedCallback does the first adopt
            if (name === "value") {
                if (this._reflecting) return;  // our own normalization, not an author's set
                this._adopt(this.getAttribute("value"));
                this._reflect();               // normalize — or heal an unparseable set
            }
            this._syncAll();
        }

        /* ------------------------------------------------------------- API */

        get value() {
            if (this._ready) return this._sel ? isoOf(this._sel) : "";
            // Before the first connect there is no state yet — answer from the
            // attribute so a script can read .value straight after createElement.
            const d = parseISO(this.getAttribute("value"));
            return d ? isoOf(d) : "";
        }

        set value(v) {
            this.setAttribute("value", v == null ? "" : String(v));
        }

        focus(options) {
            if (this._activeCell) this._activeCell.focus(options);
            else super.focus(options);
        }

        /* ----------------------------------------------------------- state */

        /** Empty clears; a valid date selects and shows its month; junk is a no-op. */
        _adopt(raw) {
            if (raw == null || String(raw).trim() === "") {
                this._sel = null;              // no selection; the view stays put
                return;
            }
            const d = parseISO(raw);
            if (d) {
                this._sel = d;
                this._active = d;              // adopting a value shows its month
            }
        }

        /** Write the state back to the attribute. Silent — never fires. */
        _reflect() {
            this._reflecting = true;
            if (!this._sel) {
                if (this.hasAttribute("value")) this.removeAttribute("value");
            } else {
                const iso = isoOf(this._sel);
                if (this.getAttribute("value") !== iso) this.setAttribute("value", iso);
            }
            this._reflecting = false;
        }

        _weekStart() {
            return this.getAttribute("week-start") === "0" ? 0 : 1;
        }

        /** 0–6 offset of a date inside its displayed week. */
        _weekOffset(d) {
            return (makeDate(d.y, d.m, d.d).getDay() - this._weekStart() + 7) % 7;
        }

        /** Intl formatter in the BROWSER's locale — date output is always
         *  browser-specific by kit rule (undefined = the browser decides;
         *  never a hand-rolled format, never a declared page lang that lies
         *  about the reader). */
        _fmt(opts) {
            return new Intl.DateTimeFormat(undefined, opts);
        }

        /* ------------------------------------------------------------ sync */

        _syncAll() {
            this._syncWeekdays();
            this._syncGrid();
        }

        _syncWeekdays() {
            const ws = this._weekStart();
            const narrow = this._fmt({ weekday: "narrow" });
            const long   = this._fmt({ weekday: "long" });
            for (let i = 0; i < 7; i++) {
                // 2023-01-01 was a Sunday, so day (1 + wd) of that month has
                // weekday wd — a cheap name lookup with zero locale data.
                const date = new Date(2023, 0, 1 + ((ws + i) % 7));
                this._wds[i].textContent = narrow.format(date);
                this._wds[i].setAttribute("aria-label", long.format(date));
            }
        }

        /**
         * Retarget all 42 cells onto the month of `_active`, IN PLACE. The
         * cells are built once in _render and never replaced — this only
         * rewrites text, dataset and state attributes.
         */
        _syncGrid() {
            const vy = this._active.y;
            const vm = this._active.m;
            this._label.textContent =
                this._fmt({ month: "long", year: "numeric" }).format(makeDate(vy, vm, 1));

            const lead  = (makeDate(vy, vm, 1).getDay() - this._weekStart() + 7) % 7;
            const min   = parseISO(this.getAttribute("min"));
            const max   = parseISO(this.getAttribute("max"));
            const minKey = min ? keyOf(min) : -Infinity;
            const maxKey = max ? keyOf(max) : Infinity;
            const selKey    = this._sel ? keyOf(this._sel) : NaN;
            const activeKey = keyOf(this._active);
            const todayKey  = keyOf(today());
            const dayFmt = this._fmt({ day: "numeric", month: "long", year: "numeric" });

            let cur = addDays({ y: vy, m: vm, d: 1 }, -lead);
            this._activeCell = null;
            for (let i = 0; i < 42; i++) {
                const cell = this._cells[i];
                const k = keyOf(cur);
                cell.textContent  = String(cur.d);
                cell.dataset.iso  = isoOf(cur);
                cell.setAttribute("aria-label", dayFmt.format(makeDate(cur.y, cur.m, cur.d)));
                cell.classList.toggle("other", cur.m !== vm || cur.y !== vy);
                cell.classList.toggle("today", k === todayKey);
                cell.setAttribute("aria-selected", k === selKey ? "true" : "false");
                if (k < minKey || k > maxKey) cell.setAttribute("aria-disabled", "true");
                else cell.removeAttribute("aria-disabled");
                // Roving tabindex: exactly one day cell is in the tab order.
                const isActive = k === activeKey;
                cell.tabIndex = isActive ? 0 : -1;
                if (isActive) this._activeCell = cell;
                cur = addDays(cur, 1);
            }
        }

        /* ------------------------------------------------------- interaction */

        /** The keyboard walk: view follows the focus across month boundaries. */
        _moveActive(d) {
            this._active = d;
            this._syncGrid();
            if (this._activeCell) this._activeCell.focus();
        }

        /** Header paging: moves the view (and the tabbable cell), not the focus. */
        _shiftView(delta) {
            this._active = addMonths(this._active, delta);
            this._syncGrid();
        }

        /**
         * The user-change path — clicks and, via the cells being real
         * buttons, Enter/Space. Selecting a neighbor-month day retargets the
         * grid onto its month; if focus was in the grid it follows.
         */
        _onGridClick(e) {
            const cell = e.target.closest(".day");
            if (!cell || cell.getAttribute("aria-disabled") === "true") return;
            const d = parseISO(cell.dataset.iso);
            if (!d) return;
            const before = this._sel ? isoOf(this._sel) : "";
            this._sel = d;
            this._active = d;
            this._reflect();
            this._syncGrid();
            const focused = this.shadowRoot.activeElement;
            if (focused && focused.classList.contains("day") && this._activeCell) {
                this._activeCell.focus();
            }
            const now = isoOf(d);
            if (now === before) return;
            this.dispatchEvent(new CustomEvent("sac:change", {
                detail:   { value: now },
                bubbles:  true,
                composed: false,   // native change semantics (value control)
            }));
        }

        _onGridKey(e) {
            let d = this._active;
            switch (e.key) {
                case "ArrowLeft":  d = addDays(d, -1); break;
                case "ArrowRight": d = addDays(d,  1); break;
                case "ArrowUp":    d = addDays(d, -7); break;
                case "ArrowDown":  d = addDays(d,  7); break;
                case "PageUp":     d = e.shiftKey ? addYears(d, -1) : addMonths(d, -1); break;
                case "PageDown":   d = e.shiftKey ? addYears(d,  1) : addMonths(d,  1); break;
                case "Home":       d = addDays(d, -this._weekOffset(d)); break;
                case "End":        d = addDays(d, 6 - this._weekOffset(d)); break;
                // Enter/Space fall through to the buttons' native click.
                default: return;
            }
            e.preventDefault();
            this._moveActive(d);
        }

        _attach() {
            const $ = (id) => this.shadowRoot.getElementById(id);
            this._label = $("label");
            this._grid  = $("grid");
            this._wds   = Array.from(this.shadowRoot.querySelectorAll(".wd"));
            this._cells = Array.from(this.shadowRoot.querySelectorAll(".day"));
            $("prev-dec").addEventListener("click", () => this._shiftView(-120));
            $("prev-year").addEventListener("click", () => this._shiftView(-12));
            $("prev").addEventListener("click", () => this._shiftView(-1));
            $("next").addEventListener("click", () => this._shiftView(1));
            $("next-year").addEventListener("click", () => this._shiftView(12));
            $("next-dec").addEventListener("click", () => this._shiftView(120));
            this._grid.addEventListener("click",   (e) => this._onGridClick(e));
            this._grid.addEventListener("keydown", (e) => this._onGridKey(e));
        }

        /* ---------------------------------------------------------- render */

        _render() {
            // Header strings: tooltip and aria-label share one translation.
            const esc = (s) => String(s).replace(/"/g, "&quot;");
            const L = {
                prevDec:  esc(t("calendar.prev-decade", "Back 10 years")),
                prevYear: esc(t("calendar.prev-year",   "Previous year")),
                prevMon:  esc(t("calendar.prev-month",  "Previous month")),
                nextMon:  esc(t("calendar.next-month",  "Next month")),
                nextYear: esc(t("calendar.next-year",   "Next year")),
                nextDec:  esc(t("calendar.next-decade", "Forward 10 years")),
            };
            const cells = '<button type="button" class="day" role="gridcell" tabindex="-1"></button>'.repeat(7);
            const weeks = Array.from({ length: 6 },
                () => `<div class="row" role="row">${cells}</div>`).join("");
            const heads = '<span class="wd" role="columnheader"></span>'.repeat(7);

            this.shadowRoot.innerHTML = `
                <style>
                    :host {
                        --calendar-width: 280px;
                        display: inline-block;
                        width: var(--calendar-width);
                        max-width: 100%;          /* the cells shrink before the page scrolls */
                        box-sizing: border-box;
                        font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
                        color: var(--text);
                        -webkit-user-select: none;
                        user-select: none;
                    }
                    /* Touch: 320px = seven 44px day columns + six 2px gaps.
                       An app's own --calendar-width still wins (it is set on
                       the element, outranking this :host default). */
                    @media (pointer: coarse) {
                        :host { --calendar-width: 320px; }
                    }

                    /* --- header ------------------------------------------ */
                    /* Six nav buttons + the label share the width: compact
                       buttons keep the full month name un-ellipsized at the
                       280px default. */
                    .head {
                        display: flex;
                        align-items: center;
                        gap: 2px;
                        margin-bottom: 6px;
                    }
                    .label {
                        flex: 1;
                        min-width: 0;
                        text-align: center;
                        font-size: 0.85rem;
                        font-weight: 600;
                        white-space: nowrap;
                        overflow: hidden;
                        text-overflow: ellipsis;
                    }
                    .nav {
                        flex: none;
                        display: inline-flex;
                        align-items: center;
                        justify-content: center;
                        width: 22px;
                        height: 26px;
                        padding: 0;
                        color: var(--text-muted);
                        background: none;
                        border: none;
                        border-radius: var(--radius-m);
                        cursor: pointer;
                        transition: background 0.15s var(--ease-smooth),
                                    color 0.15s var(--ease-smooth);
                    }
                    .nav:hover {
                        color: var(--text);
                        background: var(--hover);
                    }
                    .nav:focus-visible {
                        outline: 2px solid var(--accent);
                        outline-offset: 1px;
                    }
                    .nav sac-icon { --icon-size: 15px; }

                    /* --- grid -------------------------------------------- */
                    .grid {
                        display: flex;
                        flex-direction: column;
                        gap: 2px;
                    }
                    .row {
                        display: grid;
                        grid-template-columns: repeat(7, 1fr);
                        gap: 2px;
                    }
                    .wd {
                        padding: 4px 0;
                        font-size: 0.68rem;
                        font-weight: 600;
                        color: var(--text-dim);
                        text-align: center;
                        text-transform: uppercase;
                        letter-spacing: 0.04em;
                    }

                    /* --- day cells --------------------------------------- */
                    .day {
                        position: relative;
                        height: 32px;
                        min-width: 0;
                        padding: 0;
                        font-family: inherit;
                        font-size: 0.8rem;
                        font-weight: 500;
                        color: var(--text);
                        background: none;
                        border: none;
                        border-radius: var(--radius-m);
                        cursor: pointer;
                        transition: background 0.15s var(--ease-smooth),
                                    color 0.15s var(--ease-smooth);
                    }
                    .day:not([aria-disabled="true"]):hover { background: var(--hover); }
                    .day.other { color: var(--text-dim); }
                    /* Today: a dot, not a border — it survives selection and
                       hover without fighting either. */
                    .day.today::after {
                        content: "";
                        position: absolute;
                        left: 50%;
                        bottom: 3px;
                        width: 4px;
                        height: 4px;
                        border-radius: 50%;
                        transform: translateX(-50%);
                        background: var(--accent);
                    }
                    /* Selected: the allowed 2px accent RING (outline), tinted
                       so the state survives when the focus ring takes over. */
                    .day[aria-selected="true"] {
                        color: var(--accent);
                        font-weight: 600;
                        background: var(--accent-tint);
                        outline: 2px solid var(--accent);
                        outline-offset: -2px;
                    }
                    /* After the selected rule: on a focused selected day the
                       ring steps outward and the tint keeps saying selected. */
                    .day:focus-visible {
                        outline: 2px solid var(--accent);
                        outline-offset: 1px;
                    }
                    .day[aria-disabled="true"] {
                        color: var(--text-dim);
                        opacity: 0.45;
                        cursor: default;
                    }

                    /* Touch: 44px day cells and paging buttons. The label gets
                       its own line above the buttons — seven 44px items in one
                       row would squeeze "September 2026" to an ellipsis — and
                       the buttons split into a back group and a forward group. */
                    @media (pointer: coarse) {
                        .head {
                            flex-wrap: wrap;
                            row-gap: 0;
                        }
                        .label {
                            order: -1;
                            flex-basis: 100%;
                            padding: 4px 0 2px;
                        }
                        /* 44px each, but allowed to shrink: six fixed 44px
                           buttons wrap 5 + 1 in a calendar under 264px. */
                        .nav { width: 44px; height: 44px; flex: 0 1 44px; min-width: 32px; }
                        #next { margin-left: auto; }
                        .day { height: 44px; font-size: 0.9rem; }
                    }

                    @media (prefers-reduced-motion: reduce) {
                        .nav, .day { transition: none; }
                    }
                </style>
                <div class="head">
                    <button type="button" class="nav" id="prev-dec" aria-label="${L.prevDec}" title="${L.prevDec}">
                        <sac-icon name="chevron-triple-left"></sac-icon>
                    </button>
                    <button type="button" class="nav" id="prev-year" aria-label="${L.prevYear}" title="${L.prevYear}">
                        <sac-icon name="chevron-double-left"></sac-icon>
                    </button>
                    <button type="button" class="nav" id="prev" aria-label="${L.prevMon}" title="${L.prevMon}">
                        <sac-icon name="chevron-left"></sac-icon>
                    </button>
                    <div class="label" id="label" aria-live="polite"></div>
                    <button type="button" class="nav" id="next" aria-label="${L.nextMon}" title="${L.nextMon}">
                        <sac-icon name="chevron-right"></sac-icon>
                    </button>
                    <button type="button" class="nav" id="next-year" aria-label="${L.nextYear}" title="${L.nextYear}">
                        <sac-icon name="chevron-double-right"></sac-icon>
                    </button>
                    <button type="button" class="nav" id="next-dec" aria-label="${L.nextDec}" title="${L.nextDec}">
                        <sac-icon name="chevron-triple-right"></sac-icon>
                    </button>
                </div>
                <div class="grid" id="grid" role="grid" aria-labelledby="label">
                    <div class="row" role="row">${heads}</div>
                    ${weeks}
                </div>
            `;
        }
    }

    customElements.define("sac-calendar", SacCalendar);
})();
