/**
 * SACRVM APPKIT — context menus: long-press = right-click, kit-wide, and
 * sac.contextMenu for a surface's own menu.
 *
 * We are an app, not a website. A surface opens ITS menu; the browser's
 * never shows there (text fields keep theirs — paste, spelling — and so
 * does anything inside [data-native-menu]).
 *
 * LONG-PRESS = RIGHT-CLICK (always on, nothing to call)
 *   Wherever a right-click does something, a touch / pen long-press does
 *   the same: after 500ms without moving (>10px is a scroll, and a drag
 *   moves) the kit dispatches a `contextmenu` event at the finger on what
 *   it is pressing — so every `contextmenu` listener, the kit's and an
 *   app's own (`menu.openAt(e)`), answers a long-press too. Where the
 *   browser fires its own contextmenu on a long-press (Chrome on Android
 *   and Windows), that one is used and nothing fires twice. When a listener
 *   took the event (preventDefault), the click that follows the lift is
 *   eaten. Text fields keep the browser's own long-press (selection,
 *   paste). Opt out for a subtree with [data-no-long-press] — a canvas you
 *   paint on with a still finger. Tiles being arranged ([data-arranging])
 *   are out too: a press is a drag there.
 *
 * sac.contextMenu — a surface's menu
 *
 *   const cm = sac.contextMenu(listEl, {
 *       targets: "[data-id]",                  // what a menu is for (descendants)
 *       items: (row) => [                      // null / [] = no menu here
 *           { id: "open", label: "Open", icon: "folder" },
 *           "-",
 *           { id: "delete", label: "Delete", icon: "trash", danger: true },
 *       ],
 *       onSelect(item, row) { … },             // or each item's onClick(info)
 *       selection: sel,                        // optional sac.selection → "Select" first
 *   });
 *   cm.open(row, point?);  cm.close();  cm.destroy();
 *   sac.contextMenu.suppress();                // the browser's menu off app-wide
 *
 *   mouse     — right-click opens the target's menu at the pointer.
 *   touch/pen — a long-press does (see above).
 *   keyboard  — Shift+F10 or the Menu key opens it at the focused target
 *               (`keyTarget()` names it when focus sits on the surface
 *               itself, e.g. a listbox with aria-activedescendant; else
 *               the `selection`'s keyboard cursor row); the first item
 *               takes focus.
 *   A long-press is ALWAYS the menu. Where the list marks several rows,
 *   pass `selection`: the menu's first entry "Select" starts marking (and
 *   the selection's own long-press steps aside).
 *   The browser's menu never shows on the surface (text fields excepted).
 *   Inside [data-arranging] (tiles being arranged) no menu opens: a press
 *   is a drag there.
 *
 * Items: { id, label, labelKey, icon, checked, type, danger, disabled,
 * onClick(info) } or "-" for a separator. `labelKey` translates via
 * sac.t(labelKey, label). `checked` (true / false) makes the entry a
 * state — a checkmark in its own column, not an icon; `type: "radio"` for
 * one-of-a-group (the size of a tile), else a checkbox (for assistive tech:
 * menuitemradio / menuitemcheckbox + aria-checked). Columns are reserved:
 * once one entry is checkable, every entry has the check column; once one
 * has an icon, every entry has the icon column — the labels never jump.
 * Choosing one calls onSelect(item, target, index) when given, else
 * item.onClick({ id, target, menu, checked }). Opening dispatches sac:context-open
 * on the target (bubbles, composed) — a press waiting to become a drag
 * (sac.sortable, sac.tiles.sortable) lets go.
 *
 * The menu is one <sac-menu> per surface, appended to <body>: its panel is
 * in the top layer, so no overflow or transform of the surface clips it.
 */
(function () {
    if (!window.sac) { console.warn("[sac.contextMenu] globals.js must load first — contextMenu unavailable."); return; }

    const LONG_PRESS_MS = 500;
    const PRESS_SLOP = 10;
    const NATIVE = "input, textarea, select, [contenteditable]:not([contenteditable='false']), [data-native-menu]";
    const t = (k, fb) => (sac.t ? sac.t(k, fb) : fb);

    /** The element a composed path starts in — through shadow roots. */
    const origin = (e) => (typeof e.composedPath === "function" && e.composedPath()[0]) || e.target;
    const inside = (e, sel) => {
        const o = origin(e);
        return !!(o && o.nodeType === 1 && o.closest && o.closest(sel));
    };
    const keepsNative = (e) => inside(e, NATIVE);

    /* ---------------------------------------- long-press = right-click --- */

    if (!window.__sacLongPress) {
        window.__sacLongPress = true;
        let press = null;            // { id, x, y, target, timer, native }
        let synthAt = 0;             // when the kit last fired one

        const end = () => { if (press) { clearTimeout(press.timer); press = null; } };

        document.addEventListener("pointerdown", (e) => {
            end();
            if (e.pointerType !== "touch" && e.pointerType !== "pen") return;
            if (!e.isPrimary || keepsNative(e) || inside(e, "[data-no-long-press], [data-arranging]")) return;
            const target = origin(e);
            const p = { id: e.pointerId, x: e.clientX, y: e.clientY, sx: e.screenX, sy: e.screenY, target };
            p.timer = setTimeout(() => {
                if (press !== p) return;
                press = null;
                synthAt = Date.now();
                const ev = new MouseEvent("contextmenu", {
                    bubbles: true, cancelable: true, composed: true, view: window,
                    clientX: p.x, clientY: p.y, screenX: p.sx, screenY: p.sy, button: 2, buttons: 0,
                });
                p.target.dispatchEvent(ev);
                if (ev.defaultPrevented) {
                    // Taken: the lift is not a click on what lies under it.
                    // Only THIS press's click — a browser that sends none
                    // (iOS) must not lose the next tap (a menu item) to it.
                    const eat = (c) => { c.stopPropagation(); c.preventDefault(); drop(); };
                    const drop = () => {
                        window.removeEventListener("click", eat, true);
                        window.removeEventListener("pointerdown", drop, true);
                    };
                    window.addEventListener("click", eat, true);
                    window.addEventListener("pointerdown", drop, true);
                    setTimeout(drop, 800);
                }
            }, LONG_PRESS_MS);
            press = p;
        }, true);
        document.addEventListener("pointermove", (e) => {
            if (press && e.pointerId === press.id && Math.hypot(e.clientX - press.x, e.clientY - press.y) > PRESS_SLOP) end();
        }, true);
        document.addEventListener("pointerup", end, true);
        document.addEventListener("pointercancel", end, true);
        // The browser's own long-press contextmenu: if it comes first, ours
        // stands down; if ours came first, the late native one is dropped.
        window.addEventListener("contextmenu", (e) => {
            if (!e.isTrusted) return;
            if (press) { end(); return; }
            if (Date.now() - synthAt < 1000) { e.preventDefault(); e.stopImmediatePropagation(); }
        }, true);
    }

    /* ------------------------------------------------- sac.contextMenu --- */

    function contextMenu(el, opts = {}) {
        const {
            targets = "*",
            items = () => null,
            onSelect = null,
            selection = null,
            disabled = false,
            keyTarget = null,
        } = opts;
        const off = () => (typeof disabled === "function" ? disabled() : !!disabled);

        // A long-press on a markable list is the menu now; "Select" marks.
        if (selection && "longPress" in selection) selection.longPress = false;

        let menu = null;
        let current = null;      // { target, list } while open

        const targetFromPath = (path) => {
            for (const n of path) {
                if (n === el) return null;
                if (n.nodeType === 1 && n.matches && n.matches(targets)) return n;
            }
            return null;
        };
        // Arranging tiles (sac.tiles.sortable, the launcher's edit mode):
        // a press is a drag there, never a menu.
        const arranging = (target) => !!(target && target.closest && target.closest("[data-arranging]"));

        function ensureMenu() {
            if (menu) return menu;
            menu = document.createElement("sac-menu");
            menu.className = "sac-context-menu";
            // Out of the flow: an inline host at the end of <body> would add
            // a line box (21px) and make a viewport-tall page scroll. The
            // panel is a fixed popover, so positioning is unaffected.
            menu.style.cssText = "position:fixed;top:0;left:0";
            menu.addEventListener("sac:select", (e) => {
                e.stopPropagation();
                const c = current;
                current = null;
                if (!c) return;
                const i = Number(e.detail && e.detail.action);
                const item = c.list[i];
                if (!item || item === "-") return;
                // "Select" is ours: it runs even when the host has an onSelect.
                if (item._own || typeof onSelect !== "function") {
                    if (typeof item.onClick === "function") item.onClick({ id: item.id, target: c.target, menu: api, checked: item.checked });
                } else {
                    onSelect(item, c.target, i);
                }
            });
            document.body.appendChild(menu);
            return menu;
        }

        function build(target) {
            let list = items(target) || [];
            list = list.filter((it) => it === "-" || (it && typeof it === "object"));
            if (selection && typeof selection.has === "function" && typeof selection.toggle === "function"
                && !selection.has(target)) {
                const sel = { id: "select", label: t("contextmenu.select", "Select"), icon: "check", _own: true,
                              onClick: () => selection.toggle(target) };
                list = [sel, "-", ...list];
            }
            // No separator at either end, none doubled.
            return list.filter((it, i, a) => it !== "-" || (i > 0 && i < a.length - 1 && a[i - 1] !== "-"));
        }

        function open(target, point, viaKey) {
            if (!target || off() || arranging(target)) return false;
            const list = build(target);
            if (!list.some((it) => it !== "-")) return false;
            target.dispatchEvent(new CustomEvent("sac:context-open", { bubbles: true, composed: true }));
            const m = ensureMenu();
            m.replaceChildren();
            // Reserved columns (ui.css .sac-menu-check / .sac-menu-icon): every
            // label starts where the others do.
            const entries = list.filter((it) => it !== "-");
            const checkCol = entries.some((it) => typeof it.checked === "boolean");
            const iconCol = entries.some((it) => it.icon);
            const glyph = (name) => { const ic = document.createElement("sac-icon"); ic.setAttribute("name", name); return ic; };
            list.forEach((it, i) => {
                if (it === "-") { m.appendChild(document.createElement("hr")); return; }
                const b = document.createElement("button");
                b.type = "button";
                b.dataset.action = String(i);
                if (it.danger) b.setAttribute("data-danger", "");
                if (it.disabled) b.disabled = true;
                if (checkCol) {
                    const c = document.createElement("span");
                    c.className = "sac-menu-check";
                    if (typeof it.checked === "boolean") {
                        b.setAttribute("role", it.type === "radio" ? "menuitemradio" : "menuitemcheckbox");
                        b.setAttribute("aria-checked", String(it.checked));
                        if (it.checked) c.appendChild(glyph("check"));
                    }
                    b.appendChild(c);
                }
                if (iconCol) {
                    const s = document.createElement("span");
                    s.className = "sac-menu-icon";
                    if (it.icon) s.appendChild(glyph(it.icon));
                    b.appendChild(s);
                }
                const span = document.createElement("span");
                span.textContent = it.labelKey ? t(it.labelKey, it.label || "") : String(it.label == null ? "" : it.label);
                b.appendChild(span);
                m.appendChild(b);
            });
            current = { target, list };
            let p = point;
            if (!p) {
                const r = target.getBoundingClientRect();
                p = { clientX: r.left + Math.min(16, r.width / 2), clientY: r.top + Math.min(r.height / 2, 24) };
            }
            m.openAt(p);
            if (viaKey) {
                const first = m.querySelector("button[data-action]:not([disabled])");
                if (first) requestAnimationFrame(() => first.focus());
            }
            return true;
        }

        function onContext(e) {
            if (keepsNative(e)) return;
            e.preventDefault();          // never the browser's menu on the surface
            if (off()) return;
            const target = targetFromPath(e.composedPath());
            if (target) open(target, e, false);
        }

        function onKey(e) {
            if (!(e.key === "ContextMenu" || (e.key === "F10" && e.shiftKey))) return;
            if (keepsNative(e) || off()) return;
            let target = targetFromPath(e.composedPath());
            if (!target && typeof keyTarget === "function") target = keyTarget();
            if (!target && selection && selection.cursorRow && selection.cursorRow.matches(targets)) target = selection.cursorRow;
            if (!target) return;
            e.preventDefault();
            e.stopPropagation();
            open(target, null, true);
        }

        el.addEventListener("contextmenu", onContext);
        el.addEventListener("keydown", onKey);

        const api = {
            open: (target, point) => open(target, point || null, false),
            close() { if (menu) menu.close(); current = null; },
            get isOpen() { return !!(menu && menu.hasAttribute("open")); },
            destroy() {
                el.removeEventListener("contextmenu", onContext);
                el.removeEventListener("keydown", onKey);
                if (menu) { menu.remove(); menu = null; }
                if (selection && "longPress" in selection) selection.longPress = true;
            },
        };
        return api;
    }

    /** The browser's own menu off for a whole app (text fields and
     *  [data-native-menu] keep theirs). Returns an undo. */
    contextMenu.suppress = function (root = document) {
        const h = (e) => { if (!keepsNative(e)) e.preventDefault(); };
        root.addEventListener("contextmenu", h);
        return () => root.removeEventListener("contextmenu", h);
    };

    sac.contextMenu = contextMenu;
})();
