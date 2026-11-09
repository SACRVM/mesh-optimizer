/**
 * SACRVM APPKIT — global namespace.
 * Load FIRST (classic deferred script). Populated incrementally by the other
 * lib scripts: icons.js, router.js, scope.js, dialog.js, pan-zoom.js,
 * apps.js, hotkeys.js, color.js, fs.js, identity.js, files.js.
 *
 * Consumers (and mods) use window.sac to interact with the system without
 * rebuilding a component (e.g. sac.icons.register, sac.router.navigate).
 */
(function () {
    if (window.sac) return; // idempotent

    // Per-language string tables: { de: { "window.close": "Schließen" } }.
    const TABLES = Object.create(null);
    window.sac = {
        router:   null, // populated by router.js
        icons:    null, // populated by icons.js
        scope:    null, // populated by scope.js (optional)
        dialog:   null, // populated by dialog.js
        toast:    null, // installed by sac-toast.js
        hotkeys:  null, // populated by hotkeys.js
        color:    null, // populated by color.js (shared color math)
        fs:       null, // populated by fs.js (per-app storage behind context.fs)
        identity: null, // populated by identity.js (who is at this desktop)
        files:    null, // populated by files.js (the user's files — open / save)
        apps:     null, // populated by apps.js (app registry, windows, deep links)
        commands: null, // installed by sac-command-palette.js (app command registry)
        palette:  null, // installed by sac-command-palette.js (the connected instance)
        motion:   null, // populated by motion.js (springs for gesture releases)

        /**
         * i18n — every UI string the kit (and any app) shows, per language.
         *
         *   sac.t(key, fallback)          the string in the CURRENT language;
         *                                 the inline English fallback when no
         *                                 table has the key — zero setup.
         *   sac.i18n.add(lang, table)     merge a flat { key: string } table
         *                                 for one language. The kit ships
         *                                 kit/js/i18n/de.js; an app adds its
         *                                 own keys (namespaced: "atelier.save")
         *                                 for every language it speaks.
         *
         * Legacy: a flat key table assigned straight onto sac.i18n
         * (Object.assign(sac.i18n, {…})) is still honoured, for every
         * language, after the current language's table.
         * Key list: style guide → Helpers → sac.lang / sac.t.
         */
        i18n: Object.create(null),
        t(key, fallback) {
            const lang = this.lang ? this.lang.get() : "en";
            const table = TABLES[lang];
            if (table && table[key] !== undefined) return table[key];
            const v = this.i18n[key];
            return v === undefined ? fallback : v;
        },

        /**
         * lang — ONE language for the whole page, switchable at runtime,
         * owned by the host exactly like the theme. Apps read it
         * (context.lang) and re-render on change; kit components do that
         * themselves.
         *
         *   get()          the current code ("en", "de", …)
         *   mode()         "auto" (follows the system) or the chosen code
         *   set(code)      "auto" or a code; persisted (localStorage
         *                  "sac-lang"), mirrored onto <html lang>, announced
         *   set(code, { persist: false })
         *                  this page only: the stored choice stays as it is
         *                  and another tab's switch is not followed — a
         *                  single-language site on an origin it shares with
         *                  other kit pages
         *   onChange(cb)   cb(code) on every change, incl. other tabs;
         *                  returns an unsubscribe
         *   available()    codes that have a table, "en" first
         *   name(code)     the language's own name ("Deutsch") via Intl
         *   locale()       a full locale for Intl date / number output: the
         *                  browser's own entry for this language when it has
         *                  one ("de-AT"), else the code
         *
         * Default ("auto"): the system language as far as a page can see it.
         * No web API exposes the OS language, so this is the first entry of
         * navigator.languages the kit has a table for — else English.
         *
         * Event: sac:lang on document, detail { lang }.
         */
        lang: null,
        /* Event naming — one convention across every component:
         *
         *   • Every custom event is `sac:`-prefixed. The event name never
         *     repeats the component name (the event's `target` already says
         *     which element fired) — so it is `sac:change`, not
         *     `sac:color-change`; `sac:resize`, not `sac:split-change`.
         *
         *   • A DATA-VALUE control (toggle, slider, stepper, segmented-control,
         *     color-picker/-field, calendar, date-field, chip-input, swatch-grid,
         *     theme-toggle) fires `sac:change` on user commit — plus `sac:input`
         *     for live/intermediate updates (slider). detail ALWAYS carries
         *     `value` (it may carry more, e.g. swatch-grid adds `swatch`).
         *     These mirror native change/input: they BUBBLE but are NOT
         *     composed (they stay inside the consumer's tree), and a
         *     PROGRAMMATIC `.value`/`.checked`/`.theme` set fires nothing —
         *     only real interaction does.
         *
         *   • An ACTION / lifecycle / UI-state event keeps a descriptive verb
         *     (`sac:select`, `sac:copy`, `sac:open`, `sac:close`, `sac:minimize`,
         *     `sac:remove`, `sac:toggle`, `sac:resize`, `sac:files`, …) and
         *     bubbles + composed, so suite-level coordination (command palette,
         *     toasts, host injection) can hear it across shadow boundaries.
         */

        /* There is deliberately NO toolbar or sidebar projection here. An
         * app is complete: it draws its own chrome — toolbar (the .toolbar
         * recipe) and rail (<sac-sidebar> with the `items` property) — in
         * its own markup. A host injects context INTO the app
         * (context.host: jump-home, suite navigation, toolbar controls —
         * the way identity already works); it never offers the app a hull to
         * project fragments into. Actions the command palette should reach
         * are registered on sac.commands. */
    };

    /* ------------------------------------------------------ language -- */

    const KEY = "sac-lang";
    const listeners = new Set();
    const norm = (code) => String(code || "").trim().toLowerCase().split(/[-_]/)[0];

    Object.defineProperty(window.sac.i18n, "add", {
        enumerable: false,
        value(lang, table) {
            const code = norm(lang);
            if (!code || !table || typeof table !== "object") return;
            TABLES[code] = Object.assign(TABLES[code] || Object.create(null), table);
            // A new table can change what "auto" resolves to (a German
            // system, the German table just arrived): follow it. Strings in
            // an already-current language are picked up by whoever renders
            // next — announce() fires only on a real language change.
            if (typeof announce === "function") announce();
        },
    });

    // The explicit choice: localStorage, with an in-memory copy for when
    // storage refuses (private mode) — the switch still holds for this page.
    let chosen;
    let pinned = false;   // set(code, { persist: false }) — ignore other tabs
    function choice() {
        if (chosen !== undefined) return chosen;
        try { chosen = norm(localStorage.getItem(KEY)); } catch (err) { chosen = ""; }
        return chosen;
    }

    /** The system language, as far as the browser tells a page. */
    function detect() {
        const prefs = (navigator.languages && navigator.languages.length)
            ? navigator.languages : [navigator.language || "en"];
        for (const p of prefs) {
            const code = norm(p);
            if (code === "en" || TABLES[code]) return code;
        }
        return "en";
    }

    const current = () => choice() || detect();

    let last = null;
    function announce() {
        const now = current();
        document.documentElement.lang = now;
        if (now === last) return;
        last = now;
        for (const cb of listeners) {
            try { cb(now); }
            catch (err) { console.error("[sac.lang] a listener threw:", err); }
        }
        document.dispatchEvent(new CustomEvent("sac:lang", { detail: { lang: now }, bubbles: true }));
    }

    window.sac.lang = {
        get: current,
        mode() { return choice() || "auto"; },
        set(code, opts) {
            chosen = code === "auto" ? "" : norm(code);
            // persist: false — this page only, the stored choice untouched
            // (a single-language site on an origin other kit pages share).
            pinned = !!opts && opts.persist === false;
            if (!pinned) {
                try {
                    if (chosen) localStorage.setItem(KEY, chosen);
                    else localStorage.removeItem(KEY);
                } catch (err) { /* the in-memory choice still applies */ }
            }
            announce();
        },
        onChange(cb) {
            if (typeof cb !== "function") return () => {};
            listeners.add(cb);
            return () => listeners.delete(cb);
        },
        available() {
            return ["en", ...Object.keys(TABLES).filter((c) => c !== "en").sort()];
        },
        name(code) {
            const c = norm(code);
            try {
                const n = new Intl.DisplayNames([c], { type: "language" }).of(c);
                return n ? n.charAt(0).toLocaleUpperCase(c) + n.slice(1) : c.toUpperCase();
            } catch (err) { return c.toUpperCase(); }
        },
        locale() {
            const c = current();
            const prefs = navigator.languages || [navigator.language || ""];
            return prefs.find((p) => norm(p) === c) || c;
        },
    };

    // Another tab switched: follow it.
    window.addEventListener("storage", (e) => {
        if (e.key !== KEY || pinned) return;
        chosen = undefined;
        announce();
    });
    last = current();
    document.documentElement.lang = last;

    /* ----------------------------------------------------- regional -- */

    /**
     * regional — the page-wide date, time and number FORMAT, separate from the
     * language: an English UI with German dates is a normal wish. No web API
     * exposes the OS regional format (anti-fingerprinting — Intl follows the
     * browser's UI language), so this is an explicit app / host setting.
     * Fields without their own `format` / `hour-cycle` attribute follow it,
     * and so does every <sac-number-field> and <sac-stepper>.
     * Not persisted by the kit: the app (or the host) owns the user setting
     * and calls set() on load.
     *
     * Until a key is set, it FOLLOWS THE LANGUAGE (sac.lang), live: German
     * → date "dmy.", number "1.234,5"; every other language → "iso",
     * "1,234.5". The hour cycle stays "h23" either way. A standalone app
     * that never calls set() so reads "25.09.2026" and "1.234,5" in German.
     * set() pins a key (per key: set({ hourCycle: "h12" }) leaves date and
     * number following the language); "auto" un-pins it again.
     *
     *   get()          { date, hourCycle, number } — the EFFECTIVE format.
     *                  date: "iso" | "dmy." | "dmy/" | "mdy/"; hourCycle:
     *                  "h23" | "h12"; number: "1,234.5" | "1.234,5" |
     *                  "1 234,5" | "1'234.5" (the identifier IS the pattern:
     *                  group, then decimal separator). Default: by language
     *                  (above).
     *   set(partial)   merge, e.g. set({ date: "dmy.", number: "1.234,5" });
     *                  "auto" for a key returns it to the language default;
     *                  unknown values are ignored
     *   onChange(cb)   cb({ date, hourCycle, number }); returns an unsubscribe
     *   separators()   { decimal, group } of the current number format (the
     *                  "1 234,5" group is a no-break space, U+00A0)
     *   formatNumber(n, opts)  n → text in the current number format. opts:
     *                  decimals (exact fraction digits), minFractionDigits,
     *                  maxFractionDigits (default 0 / 20 = as many as the
     *                  number needs), group (default true). Not finite → "".
     *   parseNumber(text)  text → number, NaN for empty text or garbage.
     *                  Tolerant: either separator is understood (see below).
     *   formatDate(iso, opts)  "2026-09-25" → "25.09.2026" under "dmy.". ""
     *                  for empty or not a real date. opts.format overrides the
     *                  page format (a field's own `format` attribute).
     *   parseDate(text, opts)  typed text → "yyyy-mm-dd", "" for empty text,
     *                  null for garbage or an impossible date (2026-02-31).
     *                  A trailing time (space or T, seconds, Z / offset)
     *                  is dropped, as in a date-only spreadsheet column.
     *                  Tolerant like <sac-date-field>: an ISO date always
     *                  works; otherwise day / month / year in the format's
     *                  order, any of . / - between, single digits, a two-digit
     *                  year (00–68 → 20xx, 69–99 → 19xx). Under "iso" a
     *                  dotted day.month.year ("25.09.2026", "25.9.26") is
     *                  read too — dots always mean that order. opts.format.
     *   formatTime(hhmm, opts)  "14:30" → "14:30" under h23, "02:30 PM" under
     *                  h12 (AM / PM translated). "" for empty or garbage.
     *                  opts.hourCycle overrides the page hour cycle.
     *   parseTime(text)  typed or pasted text → "HH:MM" (24-hour), "" for
     *                  empty, null for garbage. Reads both cycles whatever
     *                  the setting: "9:5", "14.30", "14:30:00" (seconds
     *                  dropped), "2:30 pm", "2 PM", "12 AM" → "00:00", and
     *                  the translated AM / PM.
     *
     * Event: sac:regional on document, detail { date, hourCycle, number }.
     */
    const DATE_FORMATS = ["iso", "dmy.", "dmy/", "mdy/"];
    const HOUR_CYCLES = ["h23", "h12"];
    const NUMBER_FORMATS = {
        "1,234.5": { decimal: ".", group: "," },
        "1.234,5": { decimal: ",", group: "." },
        "1 234,5": { decimal: ",", group: " " },
        "1'234.5": { decimal: ".", group: "'" },
    };
    // The language defaults, for the languages with a convention the kit
    // knows; every other language gets REGIONAL_BASE.
    const REGIONAL_BASE = { date: "iso", hourCycle: "h23", number: "1,234.5" };
    const REGIONAL_BY_LANG = { de: { date: "dmy.", number: "1.234,5" } };
    // What set() pinned, per key; null = follow the language.
    const pinnedRegional = { date: null, hourCycle: null, number: null };
    /** The effective format: pinned keys, else the current language's default. */
    function effectiveRegional() {
        const byLang = REGIONAL_BY_LANG[window.sac.lang.get()] || {};
        const out = {};
        for (const k of ["date", "hourCycle", "number"]) {
            out[k] = pinnedRegional[k] || byLang[k] || REGIONAL_BASE[k];
        }
        return out;
    }
    const regional = effectiveRegional();
    const regionalListeners = new Set();

    /**
     * Tolerant number parse. Spaces (any kind) and apostrophes are always
     * grouping. Of "." and ",": both present → the LAST one is the decimal
     * separator; one of them repeated → grouping; a single one → the
     * format's decimal separator is decimal, the format's group separator is
     * grouping only in a real thousands position ("1,234" under "1,234.5"),
     * anything else is read as a decimal ("1,5" → 1.5 whatever the format).
     * Grouping must sit in thousands positions, or the text is garbage (NaN).
     */
    function parseNumber(text, fmt) {
        let s = String(text == null ? "" : text).trim().replace(/−/g, "-");
        let sign = "";
        if (s[0] === "-" || s[0] === "+") { sign = s[0] === "-" ? "-" : ""; s = s.slice(1).trim(); }
        if (!/^[\d.,\s'’]+$/.test(s) || !/\d/.test(s)) return NaN;
        const sep = NUMBER_FORMATS[fmt] || NUMBER_FORMATS["1,234.5"];
        const dots = s.split(".").length - 1;
        const commas = s.split(",").length - 1;
        const soft = /[\s'’]/.test(s);                // space / apostrophe grouping
        let decimal = "", group = "";
        if (soft) {
            if (dots + commas > 1) return NaN;             // then "." or "," can only be the decimal
            decimal = dots ? "." : commas ? "," : "";
            group = "soft";
        } else if (dots && commas) {
            decimal = s.lastIndexOf(".") > s.lastIndexOf(",") ? "." : ",";
            group = decimal === "." ? "," : ".";
        } else if (dots + commas > 1) {
            group = dots ? "." : ",";                      // "1.234.567"
        } else if (dots + commas === 1) {
            const c = dots ? "." : ",";
            if (c !== sep.decimal && c === sep.group && /^\d{1,3}[.,]\d{3}$/.test(s)) group = c;
            else decimal = c;
        }
        const [intPart, frac = "", extra] = decimal ? s.split(decimal) : [s];
        if (extra !== undefined || !/^\d*$/.test(frac)) return NaN;
        const groups = group ? intPart.split(group === "soft" ? /[\s'’]/ : group) : [intPart];
        if (groups.length > 1 && !groups.every((g, i) => (i === 0 ? /^\d{1,3}$/ : /^\d{3}$/).test(g))) return NaN;
        const digits = groups.join("");
        if (!/^\d*$/.test(digits) || (!digits && !frac)) return NaN;
        return Number(`${sign}${digits || "0"}.${frac || "0"}`);
    }

    /** Intl does the digits (shortest round-trip, correct rounding); the
     *  current format's separators are swapped in afterwards. */
    function formatNumber(n, opts, fmt) {
        const num = typeof n === "string" ? Number(n) : n;
        if (typeof num !== "number" || !Number.isFinite(num)) return "";
        const o = opts || {};
        const clamp = (v, d) => {
            const i = Math.round(Number(v));
            return Number.isFinite(i) ? Math.max(0, Math.min(20, i)) : d;
        };
        let min = clamp(o.minFractionDigits, 0);
        let max = clamp(o.maxFractionDigits, 20);
        if (o.decimals != null && o.decimals !== "") min = max = clamp(o.decimals, 0);
        if (max < min) max = min;
        const text = new Intl.NumberFormat("en-US", {
            minimumFractionDigits: min,
            maximumFractionDigits: max,
            useGrouping: o.group !== false,
        }).format(num);
        const sep = NUMBER_FORMATS[fmt] || NUMBER_FORMATS["1,234.5"];
        return text.replace(/[.,]/g, (c) => (c === "." ? sep.decimal : sep.group));
    }

    const pad2 = (n) => String(n).padStart(2, "0");
    const tr = (key, fallback) => (window.sac && window.sac.t) ? window.sac.t(key, fallback) : fallback;

    /** y / m / d → padded ISO if it is a REAL local calendar date, else
     *  null. Local Date math only — the ISO-string Date constructor parses
     *  as UTC and shifts days. */
    function isoDate(y, mo, d) {
        const dt = new Date(y, mo - 1, d);
        dt.setFullYear(y);                                  // years 0–99 are not 19xx
        if (y < 1 || dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== d) return null;
        return `${String(y).padStart(4, "0")}-${pad2(mo)}-${pad2(d)}`;
    }

    function parseDate(text, fmt) {
        if (text == null) return null;
        const s = String(text).trim();
        if (s === "") return "";
        // A trailing time ("2026-09-25 14:30", "…T14:30:00.000Z",
        // "25.09.2026 2:30 PM") is how spreadsheets and JSON hand over a
        // date: it must be a real time, and it is dropped, as Excel does in
        // a date-only column.
        const time = (t) => t === undefined ||
            !!parseTime(t.replace(/\s*(?:Z|[+-]\d{2}:?\d{2})$/i, ""));
        let m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:(?:T|\s+)(.+))?$/.exec(s);
        if (m) return time(m[4]) ? isoDate(+m[1], +m[2], +m[3]) : null;
        // ISO still reads a dotted day.month.year: dots mean that order in
        // every convention, so "25.09.2026" is never ambiguous.
        m = fmt === "iso"
            ? /^(\d{1,2})\s*\.\s*(\d{1,2})\s*\.\s*(\d{4}|\d{2})(?:\s+(.+))?$/.exec(s)
            : /^(\d{1,2})\s*[./-]\s*(\d{1,2})\s*[./-]\s*(\d{4}|\d{2})(?:\s+(.+))?$/.exec(s);
        if (!m || !time(m[4])) return null;
        let y = +m[3];
        if (m[3].length === 2) y += y <= 68 ? 2000 : 1900;
        const [d, mo] = fmt === "mdy/" ? [+m[2], +m[1]] : [+m[1], +m[2]];
        return isoDate(y, mo, d);
    }

    function formatDate(iso, fmt) {
        const norm = parseDate(iso, "iso");
        if (!norm) return "";
        const [y, m, d] = norm.split("-");
        switch (fmt) {
            case "dmy.": return `${d}.${m}.${y}`;
            case "dmy/": return `${d}/${m}/${y}`;
            case "mdy/": return `${m}/${d}/${y}`;
            default:     return norm;
        }
    }

    /** A trailing AM / PM marker (English or the current translation) →
     *  { period: "am" | "pm" | "", rest }. */
    function splitPeriod(s) {
        const low = s.toLowerCase();
        const marks = [];
        for (const [p, words] of [["am", [tr("time-field.am", "AM"), "am", "a.m.", "a"]],
                                  ["pm", [tr("time-field.pm", "PM"), "pm", "p.m.", "p"]]]) {
            for (const w of words) if (w) marks.push([p, String(w).toLowerCase()]);
        }
        marks.sort((a, b) => b[1].length - a[1].length);    // "a.m." before "a"
        for (const [p, w] of marks) {
            if (low.endsWith(w) && /[\d\s]$/.test(low.slice(0, -w.length))) {
                return { period: p, rest: s.slice(0, -w.length).trim() };
            }
        }
        return { period: "", rest: s };
    }

    function parseTime(text) {
        if (text == null) return null;
        const t = String(text).trim();
        if (t === "") return "";
        const { period, rest } = splitPeriod(t);
        const m = /^(\d{1,2})(?:\s*[:.]\s*(\d{1,2})(?:\s*[:.]\s*\d{1,2}(?:[.,]\d+)?)?)?$/.exec(rest);
        if (!m || (m[2] === undefined && !period)) return null;   // a bare "14" is not a time
        let h = +m[1];
        const mi = m[2] === undefined ? 0 : +m[2];
        if (mi > 59) return null;
        if (period) {
            if (h < 1 || h > 12) return null;
            h = (h % 12) + (period === "pm" ? 12 : 0);
        } else if (h > 23) return null;
        return `${pad2(h)}:${pad2(mi)}`;
    }

    function formatTime(hhmm, cycle) {
        const m = /^\s*(\d{1,2})\s*:\s*(\d{1,2})\s*$/.exec(String(hhmm == null ? "" : hhmm));
        if (!m || +m[1] > 23 || +m[2] > 59) return "";
        const h = +m[1], mi = pad2(+m[2]);
        if (cycle !== "h12") return `${pad2(h)}:${mi}`;
        const label = h < 12 ? tr("time-field.am", "AM") : tr("time-field.pm", "PM");
        return `${pad2(h % 12 || 12)}:${mi} ${label}`;
    }

    /** opts[key] if it is a known value, else the page-wide one. */
    const pick = (opts, key, known, fallback) =>
        (opts && known.includes(opts[key])) ? opts[key] : fallback;

    /** Re-derive the effective format; announce it when it moved. */
    function syncRegional() {
        const next = effectiveRegional();
        if (next.date === regional.date && next.hourCycle === regional.hourCycle && next.number === regional.number) return;
        Object.assign(regional, next);
        const now = window.sac.regional.get();
        for (const cb of regionalListeners) {
            try { cb(now); }
            catch (err) { console.error("[sac.regional] a listener threw:", err); }
        }
        document.dispatchEvent(new CustomEvent("sac:regional", { detail: now, bubbles: true }));
    }

    window.sac.regional = {
        get() { return { date: regional.date, hourCycle: regional.hourCycle, number: regional.number }; },
        set(partial) {
            const p = partial || {};
            const known = {
                date: (v) => DATE_FORMATS.includes(v),
                hourCycle: (v) => HOUR_CYCLES.includes(v),
                number: (v) => Object.prototype.hasOwnProperty.call(NUMBER_FORMATS, v),
            };
            for (const k of Object.keys(known)) {
                if (p[k] === "auto") pinnedRegional[k] = null;          // back to the language default
                else if (known[k](p[k])) pinnedRegional[k] = p[k];
            }
            syncRegional();
        },
        onChange(cb) {
            if (typeof cb !== "function") return () => {};
            regionalListeners.add(cb);
            return () => regionalListeners.delete(cb);
        },
        separators() {
            const sep = NUMBER_FORMATS[regional.number];
            return { decimal: sep.decimal, group: sep.group };
        },
        formatNumber(n, opts) { return formatNumber(n, opts, regional.number); },
        parseNumber(text) { return parseNumber(text, regional.number); },
        formatDate(iso, opts) { return formatDate(iso, pick(opts, "format", DATE_FORMATS, regional.date)); },
        parseDate(text, opts) { return parseDate(text, pick(opts, "format", DATE_FORMATS, regional.date)); },
        formatTime(hhmm, opts) { return formatTime(hhmm, pick(opts, "hourCycle", HOUR_CYCLES, regional.hourCycle)); },
        parseTime(text) { return parseTime(text); },
    };

    // Unpinned keys follow the language — including "auto" resolving anew
    // when a table arrives (de.js loads after this file).
    window.sac.lang.onChange(syncRegional);

    // Press states (:active) answer a finger on iOS Safari only where a
    // touchstart listener exists — this empty one makes every control in
    // the page show its press feedback the moment it is touched.
    document.addEventListener("touchstart", () => {}, { passive: true });
})();
