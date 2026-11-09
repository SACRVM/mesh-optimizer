/**
 * sac.dialog — promise-based dialog helpers.
 *
 * Thin wrappers around <sac-dialog>. Construct the element, wait for the
 * user's response, remove the element, resolve with the chosen action.
 *
 *   const answer = await sac.dialog.confirm({
 *       title:   "Delete this item?",
 *       message: "This item will be permanently deleted.",
 *       buttons: [
 *           { action: "cancel", label: "Cancel", kind: "default" },
 *           { action: "delete", label: "Delete", kind: "destructive", armAfterMs: 2000 },
 *       ],
 *   });
 *
 *   await sac.dialog.info({
 *       title:   "About",
 *       message: ["First paragraph.", "Second paragraph."],   // or one string
 *       label:   "Got it",                                    // default: sac.t("dialog.ok", "OK")
 *   });
 *
 *   const name = await sac.dialog.prompt({
 *       title:       "Rename",
 *       label:       "New name",
 *       value:       "lease.pdf",           // pre-filled; "lease" is selected
 *       placeholder: "File name",
 *       validate:    (v) => v.trim() ? null : "A name is required",
 *   });                                     // → the entered string, or null
 *
 * `message` is one string or an array of strings — each becomes its own
 * paragraph, always via textContent (callers may pass user-sourced text).
 *
 * confirm() resolves with the clicked button's `action` string, or `null` if
 * the dialog was dismissed via Escape / backdrop / swipe / programmatic close.
 * Callers treat `null` the same as "cancel." info() is the one-button case —
 * announce, not ask — so its resolution carries no information.
 *
 * The edit guard of <sac-dialog> applies to all three: once a field in the
 * body has been edited (a prompt's text typed in), a backdrop tap or a
 * swipe-down no longer dismisses — Escape and Cancel still do.
 *
 * prompt() is confirm() with one text field: { title, message?, label?,
 * value?, placeholder?, validate?, select?, buttons? }. It resolves with the
 * field's text when the PRIMARY button (kind "primary", else the last one)
 * runs, and `null` on any other button, Escape, or the backdrop / a
 * swipe-down while the field is untouched (typed in, those two leave the
 * prompt open — a stray tap never throws the text away). Enter in the
 * field presses the primary button. `validate(value)` returns an error
 * string or null; while it returns a string the primary button is disabled
 * and the error shows under the field (from the first keystroke on — an
 * untouched empty field stays quiet, a pre-filled invalid value says why at
 * once). It re-runs on a language switch, so an error built with sac.t()
 * follows it. `select` is what is selected on open: "stem" (default — the
 * text up to its last dot, what a rename wants: "lease" of "lease.pdf"),
 * "all", or "end" (caret after the text). The default buttons are Cancel +
 * OK with labelKeys ("dialog.cancel", "dialog.ok"), so an open prompt
 * follows a language switch; pass `buttons` in the confirm() shape to name
 * them yourself.
 */
(function () {
    if (!window.sac) { console.warn("[sac.dialog] globals.js must load first — dialog unavailable."); return; }

    /** A <sac-dialog> with title, buttons and message paragraphs. */
    function build({ title, message, buttons }) {
        const dlg = document.createElement("sac-dialog");
        if (title) dlg.setAttribute("title", title);
        dlg.buttons = Array.isArray(buttons) ? buttons : [];

        if (message) {
            // textContent — never innerHTML. Callers may pass
            // user-sourced strings. An array is one <p> per entry.
            for (const part of Array.isArray(message) ? message : [message]) {
                const p = document.createElement("p");
                p.textContent = part;
                dlg.appendChild(p);
            }
        }
        return dlg;
    }

    /** Open it, wait for the answer, remove it, resolve with the action.
     *  onOpen runs right after open() — a prompt focuses its field there. */
    function show(dlg, onOpen) {
        return new Promise((resolve) => {
            dlg.addEventListener("sac:action", (e) => {
                // The exit plays first (the sheet slides down, the dialog
                // fades); sac:closed says it is over.
                dlg.addEventListener("sac:closed", () => {
                    dlg.remove();
                    resolve(e.detail.action);
                }, { once: true });
            }, { once: true });

            document.body.appendChild(dlg);
            // Let the element register before opening, so the open
            // animation starts from its closed state. A timeout, not
            // requestAnimationFrame: a background tab paints no frames,
            // and a dialog that never opens would hang its promise.
            setTimeout(() => { dlg.open(); if (onOpen) onOpen(); }, 0);
        });
    }

    let promptSeq = 0;

    sac.dialog = {
        confirm({ title, message, buttons }) {
            return show(build({ title, message, buttons }));
        },

        /**
         * The one-button modal: an About panel, a licence notice, a "what
         * happened" explainer. Announce, not ask — so no action plumbing,
         * just "read, dismiss".
         */
        info({ title, message, label }) {
            return this.confirm({
                title,
                message,
                // The kit's own "OK" carries its key, so an open info
                // dialog follows a language switch; a caller's label is theirs.
                buttons: [label
                    ? { action: "ok", label, kind: "primary" }
                    : { action: "ok", label: "OK", labelKey: "dialog.ok", kind: "primary" }],
            });
        },

        /** One text field: resolves with the entered string, or null. */
        prompt({ title, message, label, value = "", placeholder, validate, select = "stem", buttons } = {}) {
            const specs = Array.isArray(buttons) && buttons.length ? buttons : [
                { action: "cancel", label: "Cancel", labelKey: "dialog.cancel" },
                { action: "ok",     label: "OK",     labelKey: "dialog.ok", kind: "primary" },
            ];
            const primary = (specs.find((b) => b.kind === "primary") || specs[specs.length - 1]).action;
            const dlg = build({ title, message, buttons: specs });

            // Light DOM, slotted into the dialog body — the global form
            // baseline (ui.css §7) styles the label and the field.
            const id = `sac-prompt-${++promptSeq}`;
            const input = document.createElement("input");
            input.type = "text";
            input.id = id;
            input.value = value == null ? "" : String(value);
            if (placeholder) input.placeholder = placeholder;
            input.autocomplete = "off";
            input.spellcheck = false;
            input.setAttribute("enterkeyhint", "done");
            if (label) {
                const lab = document.createElement("label");
                lab.htmlFor = id;
                lab.textContent = label;
                if (message) lab.style.marginTop = "12px";
                dlg.appendChild(lab);
            } else {
                if (title) input.setAttribute("aria-label", title);
                if (message) input.style.marginTop = "12px";
            }
            dlg.appendChild(input);

            const error = document.createElement("div");
            error.id = id + "-error";
            error.setAttribute("aria-live", "polite");
            error.style.marginTop = "6px";
            error.style.fontSize = "0.8rem";
            error.style.color = "var(--danger-text)";
            error.hidden = true;
            input.setAttribute("aria-describedby", error.id);
            dlg.appendChild(error);

            // An untouched empty field stays quiet; a pre-filled one explains
            // itself at once. The primary is disabled either way.
            let dirty = input.value !== "";
            const check = () => {
                let msg = null;
                if (typeof validate === "function") {
                    try { msg = validate(input.value) || null; }
                    catch (err) { console.error("[sac.dialog] prompt validate threw:", err); }
                }
                const bad = msg != null;
                dlg.setDisabled(primary, bad);
                const shown = bad && dirty;
                error.textContent = shown ? String(msg) : "";
                error.hidden = !shown;
                input.style.borderColor = shown ? "var(--danger)" : "";
                if (shown) input.setAttribute("aria-invalid", "true");
                else input.removeAttribute("aria-invalid");
                return !bad;
            };
            input.addEventListener("input", () => { dirty = true; check(); });
            input.addEventListener("keydown", (e) => {
                if (e.key !== "Enter" || e.isComposing) return;
                e.preventDefault();
                dirty = true;
                if (check()) dlg.trigger(primary);
            });
            // The primary never closes over an invalid value — not via a
            // click, not via trigger() from code. Dismissals ask too
            // (action null) and always pass: the edit guard already keeps
            // a typed text from a stray backdrop tap or swipe.
            dlg.beforeAction = (action) => action !== primary || check();

            // An error built with sac.t() follows a language switch.
            const offLang = (sac.lang && sac.lang.onChange) ? sac.lang.onChange(() => check()) : null;

            return show(dlg, () => {
                check();
                input.focus();
                const v = input.value;
                const dot = v.lastIndexOf(".");
                if (select === "all") input.select();
                else if (select === "end") input.setSelectionRange(v.length, v.length);
                else input.setSelectionRange(0, dot > 0 ? dot : v.length);
            }).then((action) => {
                if (offLang) offLang();
                return action === primary ? input.value : null;
            });
        },
    };
})();
