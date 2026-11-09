/**
 * SACRVM APPKIT — sac.selection: mark several rows of a plain list.
 *
 *   const sel = sac.selection.attach(listEl, {
 *       rows: ".item",                     // the markable rows (descendants)
 *       id: (row) => row.dataset.id,       // default — a row's stable id
 *       current: () => openId,             // optional — the row that is open
 *       icon: "sac-icon",                  // optional — swapped for "check" while marked
 *       disabled: () => !writable,         // optional — boolean or function
 *       onChange(ids) { paintHead(ids); }, // the marks changed
 *       keyboard: true,                    // optional — the file browser's keys
 *       onCursor(id, row) { open(id); },   // optional — an arrow moved the cursor
 *   });
 *   sel.marked;        // [ids] in row order
 *   sel.cursor;  sel.cursorRow;            // the keyboard cursor (id · its row)
 *   sel.clear();  sel.set(ids);  sel.toggle(id|row);  sel.has(id|row);
 *   sel.longPress = false;   // done for you by sac.contextMenu({ selection })
 *   sel.destroy();
 *
 * The gestures of <sac-file-browser>, for any list an app renders itself
 * (contacts, notes, todos):
 *   click            — the app's own (open the row); a plain click while
 *                      rows are marked clears the marks first.
 *   Ctrl/⌘+click     — toggles a mark. The first one also marks the open row
 *                      (`current`), like a file manager.
 *   Shift+click      — marks the range from the last clicked row (the anchor,
 *                      else the open row) in the visible order; with
 *                      Ctrl/⌘ the range is added to the marks.
 *   Ctrl/⌘+A         — with the list focused: marks every visible row.
 *   Esc              — clears the marks (and only then stops the key).
 *   touch / pen      — a 500ms long-press marks the row (moving >10px is a
 *                      scroll); while anything is marked a tap toggles. The
 *                      click and the context menu after a long-press are
 *                      eaten.
 * A mark gesture never reaches the app's click handler (it is stopped on
 * the way down); clicks on a button, link or field inside a row always do.
 *
 * Keyboard (`keyboard: true`) — with focus on the list or a row, never in a
 * field, editor or button inside it:
 *   ↑/↓ PgUp/PgDn Home/End — move the cursor through the visible rows (a row
 *                      whose id is null is skipped), clear the marks and
 *                      report it: onCursor(id, row) + sac:cursor { id } —
 *                      the app opens that row, as an arrow does in Mail or
 *                      Notes. The cursor is the open row (`current`) unless
 *                      an arrow moved past it before the app caught up.
 *                      Only the row's own scroller scrolls, only as far as
 *                      needed (scroll-padding keeps it clear of a sticky
 *                      header); the page never does.
 *   Shift+any of those — marks the range from the anchor (the open row when
 *                      nothing is marked) to the new cursor; moving back
 *                      shrinks it; with Ctrl/⌘ the range is added. Reports
 *                      no cursor: the app shows "3 selected" from onChange.
 *   Enter            — sac:activate { id } for the cursor row.
 *   Delete, ⌘+Backspace — sac:request-remove { ids, permanent: Shift held }:
 *                      the marked rows, else the cursor row. The app asks
 *                      and deletes.
 * A reader (`disabled`) moves the cursor; marking and Delete stay off. The
 * list gets tabindex="0" when it has none, so a click focuses it and the
 * keys work at once; rows with a tabindex take focus as the cursor moves.
 * Focus lost to a re-render (the open row repainted) comes back to the
 * cursor row. The app may move focus to its editor — the keys are then the
 * editor's.
 *
 * Only what the list shows stays marked: whenever its rows change (a
 * re-render, a search, a filter) marks of rows no longer shown are dropped,
 * so a bulk action never reaches what the user cannot see. Marks are kept
 * by id, so an app that re-renders its rows keeps them.
 *
 * What it sets: `marked` + aria-selected on marked rows, `marking` on the
 * list while anything is marked, data-sac-row on every row (ui.css: no text
 * selection, no touch callout, the marked tint). With `keyboard`,
 * data-sac-cursor on the cursor row while the open row doesn't show it —
 * while marking (the moving end of a Shift range), or once Shift moved it
 * off the open row (ui.css: a 1px --accent ring while the list has focus). With `icon`, that element
 * of a marked row shows "check" in --accent (its own name comes back after).
 * Fires sac:mark { ids } on the list (bubbles, composed) — like the file
 * browser's — and calls onChange(ids). The app keeps its own header ("3
 * selected") and does the bulk action itself.
 */
(function () {
    if (!window.sac) { console.warn("[sac.selection] globals.js must load first — selection unavailable."); return; }

    const LONG_PRESS_MS = 500;
    const PRESS_SLOP = 10;
    const PASS = "button, a[href], input, textarea, select, [contenteditable], sac-menu";

    function attach(list, opts = {}) {
        const {
            rows: rowSel = "[data-id]",
            id: idOf = (row) => row.dataset.id,
            current = null,
            icon = null,
            disabled = false,
            onChange = null,
            keyboard = false,
            onCursor = null,
        } = opts;

        const off = () => (typeof disabled === "function" ? disabled() : !!disabled);
        let marks = new Set();
        let anchor = null;
        let press = null;           // a touch / pen long-press in progress
        let eatClick = false;       // the click after a long-press
        let pointer = "mouse";      // the last pointer type
        let syncing = false;
        let longPress = true;       // off while a context menu owns the long-press
        let cursorId = null;        // the keyboard cursor (an id)
        let seenCurrent;            // current() when last read — a change is the app's own open
        let lastIdx = null;         // where the cursor was, should its row go
        let rangeBase = null;       // the marks a Shift range adds to, while it lasts
        let ownsFocus = false;      // focus is (or was, until a re-render took it) in the list

        list.setAttribute("data-sac-selection", "");
        const addedTabindex = keyboard && !list.hasAttribute("tabindex");
        if (addedTabindex) list.setAttribute("tabindex", "0");

        const shown = () => Array.from(list.querySelectorAll(rowSel)).filter((r) => r.getClientRects().length > 0);
        const rowOf = (target) => {
            const r = target && target.closest ? target.closest(rowSel) : null;
            return r && list.contains(r) ? r : null;
        };
        const key = (row) => { const v = idOf(row); return v == null ? null : String(v); };

        function paint() {
            syncing = true;
            for (const row of list.querySelectorAll(rowSel)) {
                row.setAttribute("data-sac-row", "");
                const on = marks.has(key(row));
                row.classList.toggle("marked", on);
                if (on) row.setAttribute("aria-selected", "true");
                else row.removeAttribute("aria-selected");
                const ic = icon ? row.querySelector(icon) : null;
                if (ic && ic.localName === "sac-icon") {
                    if (on && !ic.hasAttribute("data-sac-mark-icon")) {
                        ic.setAttribute("data-sac-mark-icon", ic.getAttribute("name") || "");
                        ic.setAttribute("name", "check");
                    } else if (!on && ic.hasAttribute("data-sac-mark-icon")) {
                        ic.setAttribute("name", ic.getAttribute("data-sac-mark-icon"));
                        ic.removeAttribute("data-sac-mark-icon");
                    }
                }
            }
            list.classList.toggle("marking", marks.size > 0);
            paintCursor();
            // The observer's records for our own writes are dropped.
            mo.takeRecords();
            syncing = false;
        }

        /** data-sac-cursor on the cursor row where the open row doesn't show it. */
        function paintCursor() {
            if (!keyboard) return;
            const k = cursorNow();
            const row = k != null && (marks.size > 0 || k !== openNow()) ? rowById(k) : null;
            for (const r of list.querySelectorAll("[data-sac-cursor]")) if (r !== row) r.removeAttribute("data-sac-cursor");
            if (row) row.setAttribute("data-sac-cursor", "");
        }

        /** The cursor: the app's open row whenever that changed, else where the keys left it. */
        function cursorNow() {
            if (typeof current === "function") {
                const c = current();
                const s = c == null ? null : String(c);
                if (s !== seenCurrent) { seenCurrent = s; if (s != null) cursorId = s; }
            }
            return cursorId;
        }
        const openNow = () => {
            if (typeof current !== "function") return cursorId;
            const c = current();
            return c == null ? null : String(c);
        };
        const rowById = (k) => (k == null ? null : shown().find((r) => key(r) === k) || null);

        /** The element that scrolls `el` — itself or the nearest ancestor (across shadow roots); null = the page. */
        function scrollerOf(el) {
            for (let n = el; n && n !== document.body && n !== document.documentElement;
                n = n.parentElement || (n.getRootNode && n.getRootNode().host) || null) {
                if (/(auto|scroll|overlay)/.test(getComputedStyle(n).overflowY) && n.scrollHeight > n.clientHeight) return n;
            }
            return null;
        }
        /** Scroll the row's own scroller just far enough; the page only when it is that scroller. */
        function reveal(row) {
            const sc = scrollerOf(row.parentElement);
            const r = row.getBoundingClientRect();
            let top = 0, bottom = window.innerHeight;
            if (sc) { const b = sc.getBoundingClientRect(); top = b.top + sc.clientTop; bottom = top + sc.clientHeight; }
            const cs = getComputedStyle(sc || document.documentElement);
            top += parseFloat(cs.scrollPaddingTop) || 0;
            bottom -= parseFloat(cs.scrollPaddingBottom) || 0;
            let dy = 0;
            if (r.top < top) dy = r.top - top;
            else if (r.bottom > bottom) dy = Math.min(r.bottom - bottom, r.top - top);
            if (!dy) return;
            if (sc) sc.scrollTop += dy; else window.scrollBy(0, dy);
        }
        function focusRow(row) {
            const t = row && row.hasAttribute("tabindex") ? row : list;
            if (document.activeElement !== t) t.focus({ preventScroll: true });
        }
        /** Rows per page: what the scroller shows, less one for context. */
        function page(row) {
            const sc = scrollerOf(list);
            const h = sc ? sc.clientHeight : window.innerHeight;
            return Math.max(1, Math.floor(h / (row.getBoundingClientRect().height || 1)) - 1);
        }

        function move(e, where) {
            const rows = shown().filter((r) => key(r) != null);
            const keys = rows.map(key);
            const n = rows.length;
            e.preventDefault();
            if (!n) return;
            const cur = cursorNow();
            const at = cur != null ? keys.indexOf(cur) : -1;
            if (at >= 0) lastIdx = at;
            let to;
            if (where === "first") to = 0;
            else if (where === "last") to = n - 1;
            else {
                const step = where === "page" || where === "-page" ? page(rows[Math.max(0, at)]) * (where === "page" ? 1 : -1) : where;
                // The cursor row went (deleted, filtered): step from where it was.
                const from = at >= 0 ? at : lastIdx != null ? lastIdx - (step > 0 ? 1 : 0) : -1;
                to = from + step;
            }
            to = Math.max(0, Math.min(n - 1, to));
            const k = keys[to];
            const row = rows[to];
            cursorId = k;
            lastIdx = to;
            reveal(row);
            focusRow(row);
            if (e.shiftKey && !off()) {
                if (!rangeBase) {
                    if (!marks.size || anchor == null || !keys.includes(anchor)) anchor = at >= 0 ? keys[at] : k;
                    rangeBase = e.ctrlKey || e.metaKey ? new Set(marks) : new Set();
                }
                let a = keys.indexOf(anchor);
                if (a < 0) a = to;
                marks = new Set(rangeBase);
                for (const x of keys.slice(Math.min(a, to), Math.max(a, to) + 1)) marks.add(x);
                changed();
                return;
            }
            rangeBase = null;
            anchor = k;
            if (marks.size) { marks.clear(); changed(); }
            if (k !== openNow()) {
                list.dispatchEvent(new CustomEvent("sac:cursor", { detail: { id: k }, bubbles: true, composed: true }));
                if (typeof onCursor === "function") onCursor(k, row);
            }
            paintCursor();
        }

        function changed() {
            paint();
            const ids = ordered();
            list.dispatchEvent(new CustomEvent("sac:mark", { detail: { ids }, bubbles: true, composed: true }));
            if (typeof onChange === "function") onChange(ids);
        }

        /** The marks in the list's visible order. */
        function ordered() {
            return shown().map(key).filter((k) => marks.has(k));
        }

        /** Keep only marks of rows the list shows; repaint a re-render. */
        function prune() {
            const visible = new Set(shown().map(key));
            let lost = false;
            for (const k of Array.from(marks)) if (!visible.has(k)) { marks.delete(k); lost = true; }
            if (lost) changed(); else paint();
            // A re-render took the focused row: back to the cursor row.
            if (keyboard && ownsFocus && (!document.activeElement || document.activeElement === document.body)) {
                focusRow(rowById(cursorId));
            }
        }

        function toggle(k) {
            if (marks.has(k)) marks.delete(k); else marks.add(k);
        }

        function onClickCapture(e) {
            if (eatClick) { eatClick = false; e.stopPropagation(); e.preventDefault(); return; }
            if (off()) return;
            const row = rowOf(e.target);
            if (!row) return;
            const inner = e.target.closest(PASS);
            if (inner && inner !== row && row.contains(inner)) return;
            const k = key(row);
            if (k == null) return;
            const mod = e.ctrlKey || e.metaKey;
            cursorId = k;
            rangeBase = null;
            if (e.shiftKey) {
                const ids = shown().map(key);
                const to = ids.indexOf(k);
                const cur = typeof current === "function" ? current() : null;
                let from = ids.indexOf(anchor != null ? anchor : cur != null ? String(cur) : k);
                if (from < 0) from = to;
                if (!mod) marks.clear();
                for (const x of ids.slice(Math.min(from, to), Math.max(from, to) + 1)) marks.add(x);
                stop(e);
                changed();
                return;
            }
            const touchToggle = marks.size > 0 && (pointer === "touch" || pointer === "pen");
            if (mod || touchToggle) {
                anchor = k;
                const cur = typeof current === "function" ? current() : null;
                if (mod && !marks.size && cur != null && String(cur) !== k) marks.add(String(cur));
                toggle(k);
                stop(e);
                changed();
                return;
            }
            // A plain click: the app's own. It lets go of the marks first.
            anchor = k;
            if (marks.size) { marks.clear(); changed(); }
        }

        function stop(e) {
            e.stopPropagation();
            e.preventDefault();
        }

        function onPointerDown(e) {
            pointer = e.pointerType || "mouse";
            eatClick = false;
            endPress();
            if (!longPress || off() || (e.pointerType !== "touch" && e.pointerType !== "pen")) return;
            const row = rowOf(e.target);
            if (!row || e.target.closest(PASS)) return;
            const k = key(row);
            if (k == null) return;
            press = {
                id: e.pointerId, x: e.clientX, y: e.clientY,
                timer: setTimeout(() => {
                    press = null;
                    eatClick = true;
                    anchor = k;
                    marks.add(k);
                    changed();
                }, LONG_PRESS_MS),
            };
        }
        function onPointerMove(e) {
            if (press && e.pointerId === press.id && Math.hypot(e.clientX - press.x, e.clientY - press.y) > PRESS_SLOP) endPress();
        }
        function endPress() {
            if (press) { clearTimeout(press.timer); press = null; }
        }
        function onContext(e) { if (eatClick || press) e.preventDefault(); }

        // The keys are the list's only with focus on the list or a row itself.
        const onSurface = (t) => t === list || (!!t && t.nodeType === 1 && t.matches(rowSel) && list.contains(t));

        function onKey(e) {
            if (e.key === "Escape" && marks.size) {
                e.stopPropagation();
                marks.clear();
                changed();
                return;
            }
            if (e.defaultPrevented || !onSurface(e.target)) return;
            const mod = e.ctrlKey || e.metaKey;
            if (mod && !e.altKey && !e.shiftKey && String(e.key).toLowerCase() === "a" && !off()) {
                e.preventDefault();
                marks = new Set(shown().map(key).filter((k) => k != null));
                changed();
                return;
            }
            if (!keyboard || e.altKey) return;
            const steps = { ArrowDown: 1, ArrowUp: -1, PageDown: "page", PageUp: "-page", Home: "first", End: "last" };
            if (e.key in steps) {
                if (mod && !e.shiftKey) return;     // Ctrl+arrow: not ours
                move(e, steps[e.key]);
                return;
            }
            if (e.key === "Enter" && !mod && !e.shiftKey) {
                const k = cursorNow();
                if (!rowById(k)) return;
                e.preventDefault();
                list.dispatchEvent(new CustomEvent("sac:activate", { detail: { id: k }, bubbles: true, composed: true }));
                return;
            }
            if (e.key === "Delete" || (e.key === "Backspace" && e.metaKey)) {
                if (off()) return;
                const k = cursorNow();
                const ids = marks.size ? ordered() : rowById(k) ? [k] : [];
                if (!ids.length) return;
                e.preventDefault();
                list.dispatchEvent(new CustomEvent("sac:request-remove", { detail: { ids, permanent: e.shiftKey }, bubbles: true, composed: true }));
            }
        }

        function onFocusIn() { ownsFocus = true; }
        function onFocusOut(e) {
            const t = e.target;
            if (e.relatedTarget) { if (!list.contains(e.relatedTarget)) ownsFocus = false; return; }
            // Focus went nowhere: a click on the page lets go, a re-render that took the row doesn't.
            queueMicrotask(() => { if (t.isConnected) ownsFocus = false; });
        }

        // A re-render, a filter, a search: drop what is no longer shown.
        let queued = false;
        const mo = new MutationObserver(() => {
            if (syncing || queued) return;
            queued = true;
            queueMicrotask(() => { queued = false; prune(); });
        });
        mo.observe(list, { childList: true, subtree: true, attributes: true, attributeFilter: ["hidden", "class", "style"] });

        list.addEventListener("click", onClickCapture, true);
        list.addEventListener("pointerdown", onPointerDown);
        list.addEventListener("pointermove", onPointerMove);
        list.addEventListener("pointerup", endPress);
        list.addEventListener("pointercancel", endPress);
        list.addEventListener("contextmenu", onContext);
        list.addEventListener("keydown", onKey);
        list.addEventListener("focusin", onFocusIn);
        list.addEventListener("focusout", onFocusOut);
        paint();

        // A row element or an id, wherever an id is taken.
        const keyOfArg = (k) => (k && k.nodeType === 1 ? key(k) : String(k));

        return {
            get marked() { return ordered(); },
            /** The keyboard cursor's id · its row when shown (null when not). */
            get cursor() { return cursorNow(); },
            get cursorRow() { return rowById(cursorNow()); },
            has: (k) => marks.has(keyOfArg(k)),
            /** Replace the marks (rows not shown are skipped); fires nothing. */
            set(ids) {
                const visible = new Set(shown().map(key));
                marks = new Set(Array.from(ids || [], String).filter((k) => visible.has(k)));
                paint();
            },
            clear() { if (marks.size) { marks.clear(); changed(); } },
            toggle(k) { const id = keyOfArg(k); if (id == null) return; anchor = id; toggle(id); changed(); },
            /** The long-press that marks — sac.contextMenu turns it off: a
             *  long-press is the menu there, whose "Select" marks. */
            get longPress() { return longPress; },
            set longPress(v) { longPress = !!v; if (!longPress) endPress(); },
            /** Re-check after the app changed what is shown without touching the DOM tree. */
            sync: prune,
            destroy() {
                endPress();
                mo.disconnect();
                list.removeEventListener("click", onClickCapture, true);
                list.removeEventListener("pointerdown", onPointerDown);
                list.removeEventListener("pointermove", onPointerMove);
                list.removeEventListener("pointerup", endPress);
                list.removeEventListener("pointercancel", endPress);
                list.removeEventListener("contextmenu", onContext);
                list.removeEventListener("keydown", onKey);
                list.removeEventListener("focusin", onFocusIn);
                list.removeEventListener("focusout", onFocusOut);
                marks.clear();
                paint();
                for (const r of list.querySelectorAll("[data-sac-cursor]")) r.removeAttribute("data-sac-cursor");
                list.removeAttribute("data-sac-selection");
                if (addedTabindex) list.removeAttribute("tabindex");
            },
        };
    }

    sac.selection = { attach };
})();
