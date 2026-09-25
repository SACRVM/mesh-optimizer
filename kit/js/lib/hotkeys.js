/**
 * SACRVM APPKIT — global hotkey registry.
 *
 * One document-level keydown listener for the whole app, attached lazily on
 * the first register() (a page that never registers a hotkey pays nothing).
 * Every kit component and every app feature that wants a keyboard shortcut
 * goes through here, so the bindings are (a) in one place, (b) listable —
 * <sac-command-palette> and any "keyboard shortcuts" help screen read
 * sac.hotkeys.list() instead of maintaining their own copy of the truth.
 *
 * Usage:
 *   const off = sac.hotkeys.register("mod+k", () => sac.palette.toggle(),
 *                                    { description: "Command palette" });
 *   off();                                   // unregister
 *
 *   sac.hotkeys.register("escape", () => panel.close(), { description: "Close panel" });
 *   sac.hotkeys.register("/", () => search.focus(), { description: "Search" });
 *
 * Combo grammar:
 *   "<modifier>+…+<key>" — modifiers in any order, case-insensitive:
 *     ctrl (control) · alt (option) · shift · meta (cmd, command, super, win)
 *     mod — ctrl on Windows/Linux, meta on macOS. Use this for app shortcuts;
 *           it is the reason "mod+k" is one binding and not two.
 *   The key is matched against event.key lowercased, so "k", "escape", "1",
 *   "f3", "arrowup". Friendly aliases: esc, del, ins, return, space, up,
 *   down, left, right, plus.
 *   Matching is EXACT: "ctrl+k" does not fire while shift is also held.
 *
 * Typing guard:
 *   Combos WITHOUT ctrl/alt/meta (plain keys and shift-only combos) are
 *   ignored while the user is typing in an <input>, <textarea>, <select> or
 *   a contenteditable — including ones inside Shadow DOM (the check walks
 *   event.composedPath()[0], not event.target). Pass { allowInInput: true }
 *   for a binding that must fire anyway. Combos WITH ctrl/alt/meta fire by
 *   default — nobody types Ctrl-K into a text field — unless the binding
 *   passes { skipInInput: true }: for a combo that ALSO has a text-editing
 *   meaning (mod+a select-all, mod+z undo, mod+c/x/v), so the canvas keeps
 *   its shortcut and every input on the page keeps its own.
 *
 * Activation guard:
 *   A plain "enter" or "space" binding does not fire while focus is on
 *   something those keys already activate — a button, a link, a checkbox,
 *   a [role=button] / menuitem / tab / option … Enter on a focused button
 *   presses the button, not the page's "play". { allowInInput: true } opts
 *   out here too.
 *
 * API:
 *   register(combo, handler, { description, group, allowInInput, skipInInput })
 *              → unregister function (idempotent, safe to call twice).
 *              `group` is an optional heading ("Tools", "Edit", "View") —
 *              it only sorts the binding in listings such as
 *              <sac-shortcut-sheet>; matching ignores it.
 *              On match: preventDefault(), then handler(event).
 *              Registering the same combo twice does NOT clobber: the newest
 *              registration wins and unregistering it restores the previous
 *              one (a stack per combo). That is what makes a modal's
 *              temporary "escape" binding safe.
 *   list()     → [{ combo, display, description, group }] — the ACTIVE binding of
 *              every registered combo (shadowed ones are not listed twice).
 *   format(combo) → display string for a combo, platform-aware:
 *              "ctrl+shift+x" → "Ctrl+Shift+X" (Windows/Linux) / "⌃⇧X" (macOS).
 *
 * A handler that throws is caught and logged — one broken shortcut must not
 * take the document listener down with it.
 */
(function () {

    const stacks = new Map();     // canonical combo → [entry, …]; last = active
    let listening = false;

    /** Pressing a modifier alone is never a hotkey. */
    const MODIFIER_KEYS = new Set(["control", "alt", "shift", "meta", "os"]);

    /** Author-friendly spellings → the event.key value they mean. */
    const KEY_ALIASES = {
        esc:      "escape",
        del:      "delete",
        ins:      "insert",
        return:   "enter",
        space:    " ",
        spacebar: " ",
        up:       "arrowup",
        down:     "arrowdown",
        left:     "arrowleft",
        right:    "arrowright",
        plus:     "+",
    };

    /** Display spellings, per platform. */
    const KEY_LABELS = {
        " ":          "Space",
        escape:       "Esc",
        enter:        "Enter",
        arrowup:      "↑",
        arrowdown:    "↓",
        arrowleft:    "←",
        arrowright:   "→",
        backspace:    "⌫",
        delete:       "Del",
        tab:          "Tab",
        pageup:       "PgUp",
        pagedown:     "PgDn",
    };

    /**
     * navigator.platform is deprecated but remains the only hint every engine
     * ships; userAgentData is preferred where it exists. Both are read
     * defensively — a missing navigator must not break the module.
     */
    const MAC = (function () {
        try {
            const nav = window.navigator || {};
            const p = (nav.userAgentData && nav.userAgentData.platform) ||
                      nav.platform || nav.userAgent || "";
            return /mac|iphone|ipad|ipod/i.test(p);
        } catch (e) {
            return false;
        }
    })();

    /** Canonical string: modifiers in fixed order, then the key. */
    function canonical(mods, key) {
        const parts = [];
        if (mods.ctrl)  parts.push("ctrl");
        if (mods.alt)   parts.push("alt");
        if (mods.shift) parts.push("shift");
        if (mods.meta)  parts.push("meta");
        parts.push(key);
        return parts.join("+");
    }

    /** "Shift+Ctrl+K" → "ctrl+shift+k"; unparsable → null. */
    function parse(combo) {
        if (typeof combo !== "string") return null;
        const mods = { ctrl: false, alt: false, shift: false, meta: false };
        let key = null;

        // Split on "+" but keep a literal "+" as a key ("ctrl++" / "ctrl+plus").
        const raw = combo.toLowerCase().split("+");
        for (let i = 0; i < raw.length; i++) {
            const part = raw[i].trim();
            if (part === "") {
                // Empty slot = the separator itself was the key ("ctrl++").
                if (i > 0 && i === raw.length - 2) key = "+";
                continue;
            }
            switch (part) {
                case "mod":     if (MAC) mods.meta = true; else mods.ctrl = true; break;
                case "ctrl":
                case "control": mods.ctrl = true;  break;
                case "alt":
                case "option":  mods.alt = true;   break;
                case "shift":   mods.shift = true; break;
                case "meta":
                case "cmd":
                case "command":
                case "super":
                case "win":     mods.meta = true;  break;
                default:
                    key = Object.prototype.hasOwnProperty.call(KEY_ALIASES, part)
                        ? KEY_ALIASES[part] : part;
            }
        }
        return key ? canonical(mods, key) : null;
    }

    /** The canonical combo a keydown event represents (null for bare modifiers). */
    function eventCombo(e) {
        let key = typeof e.key === "string" ? e.key.toLowerCase() : "";
        if (!key || MODIFIER_KEYS.has(key)) return null;
        if (key === "spacebar") key = " ";       // legacy engines
        return canonical(
            { ctrl: e.ctrlKey, alt: e.altKey, shift: e.shiftKey, meta: e.metaKey },
            key
        );
    }

    /** Human-readable form of an already-canonical combo. */
    function display(canon) {
        const segments = canon.split("+");
        // A trailing empty segment means the KEY is a literal "+" ("ctrl++").
        const last = segments[segments.length - 1] === "" ? "+" : segments[segments.length - 1];
        const mods = segments.slice(0, segments.length - 1).filter(Boolean);

        const out = mods.map(m => {
            if (m === "ctrl")  return MAC ? "⌃" : "Ctrl";
            if (m === "alt")   return MAC ? "⌥" : "Alt";
            if (m === "shift") return MAC ? "⇧" : "Shift";
            if (m === "meta")  return MAC ? "⌘" : "Win";
            return m;
        });

        let label = Object.prototype.hasOwnProperty.call(KEY_LABELS, last)
            ? KEY_LABELS[last]
            : (last.length === 1 ? last.toUpperCase() : last.charAt(0).toUpperCase() + last.slice(1));
        out.push(label);
        // macOS spells chords as glyph runs (⌘K), everything else joins with +.
        return MAC ? out.join("") : out.join("+");
    }

    /** Is the event coming out of a text-entry context? Shadow-DOM aware. */
    function isTypingTarget(e) {
        const path = typeof e.composedPath === "function" ? e.composedPath() : null;
        const el = (path && path[0]) || e.target;
        if (!el || el.nodeType !== 1) return false;
        if (el.isContentEditable) return true;
        const tag = (el.localName || "").toLowerCase();
        if (tag === "textarea" || tag === "select") return true;
        if (tag !== "input") return false;
        // Buttons and checkboxes are inputs too, but nobody types into them.
        const type = (el.getAttribute("type") || "text").toLowerCase();
        return !["button", "submit", "reset", "checkbox", "radio", "range", "color", "file"].includes(type);
    }

    /** Is focus on something Enter / Space already activates? */
    const ACTIVATING_ROLES = new Set(["button", "link", "menuitem", "menuitemcheckbox",
        "menuitemradio", "tab", "option", "checkbox", "radio", "switch", "treeitem"]);
    function isActivationTarget(e) {
        const path = typeof e.composedPath === "function" ? e.composedPath() : null;
        const el = (path && path[0]) || e.target;
        if (!el || el.nodeType !== 1) return false;
        const tag = (el.localName || "").toLowerCase();
        if (tag === "button" || tag === "summary" || tag === "select") return true;
        if (tag === "a" && el.hasAttribute("href")) return true;
        if (tag === "input") {
            const type = (el.getAttribute("type") || "text").toLowerCase();
            if (["button", "submit", "reset", "checkbox", "radio", "file", "color"].includes(type)) return true;
        }
        return ACTIVATING_ROLES.has((el.getAttribute("role") || "").toLowerCase());
    }

    function onKeydown(e) {
        // Something upstream already handled this key (a component's own
        // keyboard trap, an autocomplete). Don't fire on top of it.
        if (e.defaultPrevented) return;

        const combo = eventCombo(e);
        if (!combo) return;
        const stack = stacks.get(combo);
        if (!stack || stack.length === 0) return;

        const entry = stack[stack.length - 1];   // newest registration wins
        const hasModifier = e.ctrlKey || e.altKey || e.metaKey;
        if (!entry.allowInInput) {
            if (isTypingTarget(e) && (!hasModifier || entry.skipInInput)) return;
            if (!hasModifier && (combo === "enter" || combo === " ") && isActivationTarget(e)) return;
        }

        e.preventDefault();
        try {
            entry.handler(e);
        } catch (err) {
            console.error(`[sac.hotkeys] handler for "${combo}" threw:`, err);
        }
    }

    function attach() {
        if (listening) return;
        // Bubble phase on purpose: a component that handles a key itself and
        // calls preventDefault (a dialog's Escape trap, a menu's arrows) wins
        // over a global binding, instead of racing it.
        document.addEventListener("keydown", onKeydown);
        listening = true;
    }

    const api = {
        register(combo, handler, options) {
            const opts = options || {};
            const canon = parse(combo);
            if (!canon) {
                console.error(`[sac.hotkeys] register: cannot parse combo "${combo}"`);
                return function () {};
            }
            if (typeof handler !== "function") {
                console.error(`[sac.hotkeys] register: handler for "${combo}" is not a function`);
                return function () {};
            }
            attach();

            const entry = {
                handler,
                description:  opts.description ? String(opts.description) : "",
                group:        opts.group ? String(opts.group) : "",
                allowInInput: !!opts.allowInInput,
                skipInInput:  !!opts.skipInInput,
            };
            const stack = stacks.get(canon) || [];
            stack.push(entry);
            stacks.set(canon, stack);

            let spent = false;
            return function unregister() {
                if (spent) return;               // idempotent
                spent = true;
                const s = stacks.get(canon);
                if (!s) return;
                const i = s.indexOf(entry);
                if (i !== -1) s.splice(i, 1);    // the one below it becomes active again
                if (s.length === 0) stacks.delete(canon);
            };
        },

        list() {
            const out = [];
            stacks.forEach((stack, combo) => {
                const top = stack[stack.length - 1];
                if (top) out.push({ combo, display: display(combo), description: top.description, group: top.group });
            });
            return out;
        },

        format(combo) {
            const canon = parse(combo);
            return canon ? display(canon) : String(combo);
        },

        /** True on macOS — exposed so UI can spell "⌘" instead of "Ctrl". */
        isMac() { return MAC; },
    };

    if (!window.sac) console.warn("[sac.hotkeys] globals.js must load first — hotkeys unavailable.");
    else if (!sac.hotkeys) sac.hotkeys = api;
})();
