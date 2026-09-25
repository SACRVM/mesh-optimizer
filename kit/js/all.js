/**
 * SACRVM APPKIT — convenience autoloader.
 *
 * Usage:
 *   <script src="kit/js/all.js"></script>
 *
 * One tag, everything loads in order. Cherry-picking individual scripts
 * (see the "Script load order" section of the style guide's Helpers page)
 * stays the recommended production path — this file is for quick starts
 * and demos.
 *
 * Vendor libs (marked, purify) and the ES-module help-loader are NOT
 * included — pull those in yourself when a view needs markdown help.
 * Components define themselves as they arrive; loading order only matters
 * because later scripts may reference sac.* globals set up by earlier ones.
 *
 * Readiness: these scripts are injected, and injected scripts do not hold up
 * DOMContentLoaded — so page code that calls sac.* must NOT boot from that
 * event. Wait for "sac:ready" on document (fired once, after the last file
 * settles), and take the flag into account in case you missed it:
 *
 *   const boot = () => { sac.apps.register(...); sac.apps.init(); };
 *   if (window.sacReady) boot();
 *   else document.addEventListener("sac:ready", boot, { once: true });
 *
 * Cherry-picked <script defer> tags have no such caveat: the parser holds
 * DOMContentLoaded for them.
 */
(function () {
    const base = document.currentScript.src.replace(/all\.js(\?.*)?$/, "");

    const files = [
        // lib — globals first, then the rest in dependency order
        "lib/globals.js",
        "i18n/de.js",      // the kit's own strings in German (sac.lang)
        "lib/icons.js",
        "lib/router.js",
        "lib/scope.js",
        "lib/dialog.js",
        "lib/about.js",   // sac.about — the shared About window (a peer of sac.dialog)
        "lib/pan-zoom.js",
        "lib/apps.js",
        "lib/hotkeys.js",
        "lib/sortable.js", // drag-reorder — filmstrip + layer list use it
        "lib/color.js",
        "lib/fs.js",      // storage capability — apps.js hands it to apps
        "lib/identity.js",// who is at this desktop (rides on the fs backend)
        "lib/files.js",   // the user's files — open / save (context.files)
        "lib/app.js",     // the app-side toolkit (apps.js is the host side)

        // components — any order, except where a comment says otherwise
        "components/sac-icon.js",
        "components/sac-nav.js",
        "components/sac-sidebar.js",
        "components/sac-footer.js",
        "components/sac-window.js",
        "components/sac-dialog.js",
        "components/sac-split.js",
        "components/sac-section.js",
        "components/sac-toggle.js",
        "components/sac-slider.js",
        "components/sac-stepper.js",
        "components/sac-segmented-control.js",

        // color suite — sac-color-picker MUST precede sac-color-field,
        // which builds a picker inside its popover.
        "components/sac-color-picker.js",
        "components/sac-color-field.js",
        "components/sac-swatch-grid.js",

        // date suite — sac-calendar MUST precede sac-date-field,
        // which builds a calendar inside its popover.
        "components/sac-calendar.js",
        "components/sac-date-field.js",

        "components/sac-collapsible.js",
        "components/sac-drop-zone.js",
        "components/sac-file-browser.js",
        "components/sac-status-banner.js",
        "components/sac-loader.js",
        "components/sac-log.js",
        "components/sac-hud.js",
        "components/sac-chip.js",
        "components/sac-chip-input.js",
        "components/sac-avatar.js",
        "components/sac-copy-button.js",
        "components/sac-scene-graph.js",
        "components/sac-toast.js",
        "components/sac-tabs.js",
        "components/sac-tooltip.js",
        "components/sac-menu.js",
        "components/sac-command-palette.js",
        "components/sac-progress.js",
        "components/sac-spinner.js",
        "components/sac-theme-toggle.js",
        "components/sac-lang-toggle.js",
        "components/sac-launcher.js",

        // pixel workbench — sac-toolbox after sac-tooltip (it attaches
        // kit tooltips when it builds its buttons).
        "components/sac-pixel-canvas.js",
        "components/sac-toolbox.js",
        "components/sac-filmstrip.js",
        "components/sac-layer-list.js",
        "components/sac-shortcut-sheet.js",
    ];

    let pending = files.length;

    for (const file of files) {
        const s = document.createElement("script");
        s.src = base + file;
        s.async = false; // dynamically inserted classic scripts + async=false = insertion order
        // Injected scripts do NOT hold up DOMContentLoaded, so code that
        // needs sac.* cannot simply listen for that event — wait for
        // "sac:ready" instead (see the doc block above).
        const settle = () => {
            if (--pending) return;
            window.sacReady = true;
            document.dispatchEvent(new CustomEvent("sac:ready", { bubbles: true }));
        };
        s.onload = settle;
        // A file that 404s must not pass silently as "loaded" — the boot then
        // proceeds and fails downstream (a missing lib leaves sac.* undefined).
        // Still count it toward readiness so one bad file cannot hang the whole
        // page, but say so, loudly, with the path.
        s.onerror = () => {
            console.error(`[sac] failed to load ${file} — sac.* may be incomplete`);
            settle();
        };
        document.head.appendChild(s);
    }
})();
