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
        set(code) {
            chosen = code === "auto" ? "" : norm(code);
            try {
                if (chosen) localStorage.setItem(KEY, chosen);
                else localStorage.removeItem(KEY);
            } catch (err) { /* the in-memory choice still applies */ }
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
        if (e.key !== KEY) return;
        chosen = undefined;
        announce();
    });
    last = current();
    document.documentElement.lang = last;
})();
