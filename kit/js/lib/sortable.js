/**
 * SACRVM APPKIT — drag-to-reorder for any list of elements.
 *
 *   const s = sac.sortable(listEl, {
 *       items: ".row",                 // selector for the draggable children
 *       handle: ".grip",               // optional — only this part starts a drag
 *       axis: "y",                     // "x" | "y" | "grid"
 *       onReorder(from, to) { … },     // indices among the matching children
 *       disabled: () => false,         // optional — boolean or function
 *   });
 *   s.destroy();
 *
 * sac.tiles.sortable(grid, …) is the same drag for a hub grid whose small
 * tiles sit in .tile-pack cells — one flat order, packs re-formed live (below).
 *
 * The helper moves the DOM: the dragged item travels through the list while
 * the pointer moves, so its slot opens up as a live gap wherever it would
 * land, and on drop it stays there. `onReorder(from, to)` then reports the
 * move once — `to` is the item's final index, so `arr.splice(to, 0,
 * ...arr.splice(from, 1))` mirrors it on the data. A component that renders
 * from data may simply re-render; the DOM already agrees.
 *
 * Input:
 *   Mouse / pen — press and move 4px to lift (a plain click stays a click).
 *   Touch — a finger swipe must keep scrolling the page, so without a
 *     `handle` a drag starts only after a 250ms long-press that did not move;
 *     moving first is a scroll and the helper stays out of it. With a
 *     `handle` the handle gets `touch-action: none` and drags at once.
 *   Escape during a drag puts the item back where it started (no callback).
 *   A drag never ends in a click: the click that follows the drop is eaten.
 *   Presses that start in a text field ("input, textarea, select,
 *   [contenteditable], [data-sortable-ignore]") never drag, so inline
 *   editors keep their own mouse behaviour. Override with `ignore`.
 *
 * While dragging the item carries `data-sortable-dragging` (style the lift
 * with it — a shadow, a z-index) and is offset with a transform — its own
 * transition is off meanwhile, so it follows the pointer 1:1 even when its
 * CSS animates transform (a .tile does); its natural slot is the gap. The
 * container carries `data-sortable-active` for the length of the drag. A
 * native drag (a link, an image) never starts while a press is live. The nearest scrolling ancestor — crossing shadow roots —
 * auto-scrolls when the pointer nears its edge.
 *
 * Shadow DOM: `container` may live inside a shadow root; nothing is moved
 * out of it (no body-level ghost), so the component's own styles keep
 * applying to the item in flight.
 *
 * Keyboard reordering (Alt+Arrow and friends) is the component's job — the
 * list helper is pointer-only on purpose, and it calls nothing for keys.
 * sac.tiles.sortable is the exception: its arrange mode IS the keyboard
 * path to moving a tile, so it handles Alt+Arrow itself (below).
 *
 * Reduced motion: the item follows the pointer 1:1 either way; the list
 * helper animates nothing on its own (sac.tiles.sortable slides and settles,
 * except under reduced motion).
 */
(function () {
    if (!window.sac) { console.warn("[sac.sortable] globals.js must load first — sortable unavailable."); return; }

    const DRAG_SLOP = 4;          // px a mouse/pen press must move to lift
    const TOUCH_SLOP = 8;         // px a finger may wobble during the long-press
    const LONG_PRESS_MS = 250;
    const EDGE = 32;              // px from a scroller's edge where auto-scroll starts
    const MAX_SPEED = 14;         // px per frame at the very edge
    const SLIDE_MS = 200;         // neighbours sliding aside; the drop settling without sac.motion
    const FLICK = 400;            // px/s: a drop released faster than this lands with a little bounce
    /** sac.motion when lib/motion.js is loaded: the drop then settles on a
     *  spring at the speed the pointer let go; else a 200ms transition. */
    const motion = () => (window.sac && window.sac.motion) || null;
    const PACK = 9;               // small tiles per .tile-pack (3×3, ui.css)
    const IGNORE = "input, textarea, select, [contenteditable], [data-sortable-ignore]";

    const reducedMotion = () => !!(window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches);

    /** The nearest scrollable ancestor along the axis, crossing shadow roots. */
    function scrollParent(el, axis) {
        let node = el;
        while (node) {
            if (node.nodeType === 1) {
                const cs = getComputedStyle(node);
                const oy = /(auto|scroll)/.test(cs.overflowY) && node.scrollHeight > node.clientHeight;
                const ox = /(auto|scroll)/.test(cs.overflowX) && node.scrollWidth > node.clientWidth;
                if ((axis !== "x" && oy) || (axis !== "y" && ox)) return node;
            }
            node = node.parentNode || (node.host ? node.host : null);
            if (node && node.nodeType === 11) node = node.host;   // shadow root → its host
        }
        return document.scrollingElement;
    }

    /**
     * The pointer side every drag-reorder shares: press, lift (4px / a
     * 250ms long-press on touch), follow 1:1, auto-scroll, Escape, drop,
     * the eaten click. What moves where is the caller's:
     *   pick(path, e)  → the item a press starts on, or null
     *   start(item)    → per-drag memo (from index, restore data)
     *   move(s)        → put s.item into the slot under s.x / s.y
     *   finish(s, ok)  → ok = dropped; else put everything back
     * Options: scale — the lifted item's size (1 = none); settle — animate
     * the item from the pointer into its slot on drop / Escape; touch(item)
     * — how a finger may drag this item: "hold" (a 250ms long-press, the
     * default; with a handle it drags at once), "move" (at once — the
     * surface claims the gesture, e.g. tiles being arranged) or "off".
     *
     * A context menu wins over a held press: when one opens (a right-click
     * or the kit's long-press = right-click, see context-menu.js) while a
     * finger is down and has not moved since the lift, the drag lets go.
     * Moving first makes it a drag, and no menu comes.
     */
    function engine(container, { axis, handle, ignore, disabled, pick, start, move, finish, scale = 1, settle = false, touch = null }) {
        const isDisabled = () => (typeof disabled === "function" ? disabled() : !!disabled);
        let state = null;         // the press/drag in progress, or null

        // Touch handles claim the gesture up front; body-drags keep scrolling.
        const handleStyle = () => {
            if (!handle) return;
            container.querySelectorAll(handle).forEach((h) => { h.style.touchAction = "none"; });
        };
        handleStyle();
        const mo = handle ? new MutationObserver(handleStyle) : null;
        if (mo) mo.observe(container, { childList: true, subtree: true });

        // A link or an image is natively draggable: a native drag would
        // start, and Chrome cancels the pointer (pointercancel) — the kit's
        // drag would die. While a press is live, there is no native drag.
        const noNativeDrag = (e) => { if (state) e.preventDefault(); };

        function onDown(e) {
            if (state || isDisabled()) return;
            if (e.pointerType === "mouse" && e.button !== 0) return;
            const path = e.composedPath();
            const item = pick(path, e);
            if (!item) return;
            const first = path[0];
            if (first && first.nodeType === 1 && first.closest && first.closest(ignore)) return;
            const viaHandle = handle
                ? path.some((n) => n.nodeType === 1 && n !== item && item.contains(n) && n.matches(handle)) ||
                  (item.matches(handle))
                : false;
            if (handle && !viaHandle) return;

            const finger = e.pointerType === "touch";
            const how = finger ? (handle ? "move" : (typeof touch === "function" ? touch(item) : "hold")) : "move";
            if (how === "off") return;

            state = {
                item, id: e.pointerId, type: e.pointerType,
                x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY,
                dragging: false, timer: null,
                memo: start(item),
            };
            if (finger && how === "hold") {
                state.timer = setTimeout(() => { if (state && !state.dragging) lift(); }, LONG_PRESS_MS);
            }
            window.addEventListener("pointermove", onMove, true);
            window.addEventListener("pointerup", onUp, true);
            window.addEventListener("pointercancel", onCancel, true);
            window.addEventListener("keydown", onKey, true);
        }

        function lift() {
            const s = state;
            s.dragging = true;
            s.liftX = s.x; s.liftY = s.y;
            const it = s.item;
            // Grabbed where it SHOWS (mid-slide, mid-settle, hover-lifted);
            // then any animation of its own ends, and follow() keeps it there.
            const r = it.getBoundingClientRect();
            s.grabX = s.x - r.left;
            s.grabY = s.y - r.top;
            if (it._sacSettle) it._sacSettle();
            if (it._sacSlide) it._sacSlide();
            // 1:1 with the pointer: no transition on the item while lifted
            // (a .tile has its own on transform — every move would animate).
            s.saved = {
                transition: it.style.transition, transformOrigin: it.style.transformOrigin,
                position: it.style.position, zIndex: it.style.zIndex, pointerEvents: it.style.pointerEvents,
            };
            it.style.transition = "none";
            it.style.transformOrigin = `${s.grabX}px ${s.grabY}px`;   // a scale keeps the grab point
            it.setAttribute("data-sortable-dragging", "");
            it.style.position = "relative";
            it.style.zIndex = "2";
            it.style.pointerEvents = "none";
            container.setAttribute("data-sortable-active", "");
            container.style.userSelect = "none";
            const sel = window.getSelection && window.getSelection();
            if (sel) sel.removeAllRanges();
            s.scroller = scrollParent(container, axis);
            s.raf = requestAnimationFrame(tick);
            const m = motion();
            s.trackX = m ? m.tracker() : null;
            s.trackY = m ? m.tracker() : null;
            place();
        }

        /** Offset the item from its slot onto the pointer. */
        function follow(s) {
            const it = s.item;
            it.style.transform = "";
            const r = it.getBoundingClientRect();
            const dx = axis === "y" ? 0 : s.x - s.grabX - r.left;
            const dy = axis === "x" ? 0 : s.y - s.grabY - r.top;
            it.style.transform = `translate(${dx}px, ${dy}px)` + (scale !== 1 ? ` scale(${scale})` : "");
            return { dx, dy };
        }

        /** Move the item to the slot under the pointer, then onto the pointer. */
        function place() {
            const s = state;
            move(s);
            follow(s);
        }

        function tick() {
            const s = state;
            if (!s || !s.dragging) return;
            const sc = s.scroller;
            if (sc) {
                const r = sc === document.scrollingElement
                    ? { left: 0, top: 0, right: innerWidth, bottom: innerHeight }
                    : sc.getBoundingClientRect();
                const speed = (d) => (d < EDGE ? Math.ceil(MAX_SPEED * (1 - Math.max(0, d) / EDGE)) : 0);
                let vx = 0, vy = 0;
                if (axis !== "y") vx = speed(s.x - r.left) ? -speed(s.x - r.left) : speed(r.right - s.x);
                if (axis !== "x") vy = speed(s.y - r.top) ? -speed(s.y - r.top) : speed(r.bottom - s.y);
                if (vx || vy) {
                    const bx = sc.scrollLeft, by = sc.scrollTop;
                    sc.scrollLeft += vx;
                    sc.scrollTop += vy;
                    if (sc.scrollLeft !== bx || sc.scrollTop !== by) place();
                }
            }
            s.raf = requestAnimationFrame(tick);
        }

        function onMove(e) {
            const s = state;
            if (!s || e.pointerId !== s.id) return;
            s.x = e.clientX; s.y = e.clientY;
            const moved = Math.hypot(s.x - s.x0, s.y - s.y0);
            if (!s.dragging) {
                if (s.timer) {                          // touch long-press pending
                    if (moved > TOUCH_SLOP) end(false); // it was a scroll
                    return;
                }
                if (moved < DRAG_SLOP) return;
                lift();
            }
            e.preventDefault();
            s.trackX?.add(s.x, e.timeStamp);
            s.trackY?.add(s.y, e.timeStamp);
            place();
        }

        function onUp(e) {
            if (!state || e.pointerId !== state.id) return;
            state.upAt = e.timeStamp;           // a real release: the drop keeps its speed
            end(state.dragging);
        }
        function onCancel(e) {
            if (!state || e.pointerId !== state.id) return;
            end(false);
        }
        function onKey(e) {
            if (!state || e.key !== "Escape") return;
            if (state.dragging) { e.preventDefault(); e.stopPropagation(); }
            end(false);
        }

        /** Finish: commit (drop) or put a lifted item back. */
        function end(commit) {
            const s = state;
            state = null;
            clearTimeout(s.timer);
            cancelAnimationFrame(s.raf);
            window.removeEventListener("pointermove", onMove, true);
            window.removeEventListener("pointerup", onUp, true);
            window.removeEventListener("pointercancel", onCancel, true);
            window.removeEventListener("keydown", onKey, true);
            if (!s.dragging) return;

            container.removeAttribute("data-sortable-active");
            container.style.userSelect = "";
            // The click that follows a drop (or a cancelled drag) is not a click.
            const eat = (ev) => { ev.stopPropagation(); ev.preventDefault(); };
            window.addEventListener("click", eat, { capture: true, once: true });
            setTimeout(() => window.removeEventListener("click", eat, true), 0);

            finish(s, !!commit);

            const it = s.item;
            const done = () => {
                it._sacSettle = null;
                clearTimeout(timer);
                it.removeEventListener("transitionend", onEnd);
                it.removeAttribute("data-sortable-dragging");
                // Back in its slot with no transition, THEN its own back:
                // the item's CSS one (a .tile's 0.4s) must not replay the move.
                it.style.transition = "none";
                it.style.transform = "";
                void it.offsetWidth;
                it.style.transition = s.saved.transition;
                it.style.transformOrigin = s.saved.transformOrigin;
                it.style.position = s.saved.position;
                it.style.zIndex = s.saved.zIndex;
                it.style.pointerEvents = s.saved.pointerEvents;
            };
            const onEnd = (ev) => { if (ev.target === it && ev.propertyName === "transform") done(); };
            let timer = null;
            if (!settle || reducedMotion()) { done(); return; }
            // Settle: from where the pointer left it into its slot (the slot
            // may have moved — Escape put it back), then hand the item back.
            const mo = motion();
            if (mo) {
                // On a spring, at the speed the pointer let go — no seam
                // between hand and animation; a flick lands with a little bounce.
                const { dx, dy } = follow(s);
                const vx = s.upAt != null && axis !== "y" ? s.trackX.velocity(s.upAt) : 0;
                const vy = s.upAt != null && axis !== "x" ? s.trackY.velocity(s.upAt) : 0;
                const damping = Math.hypot(vx, vy) > FLICK ? 0.8 : 1;
                let x = dx, y = dy, k = scale;
                const paint = () => {
                    it.style.transform = `translate(${x}px, ${y}px)` + (scale !== 1 ? ` scale(${k})` : "");
                };
                const springs = [
                    mo.spring({ from: dx, to: 0, velocity: vx, damping, response: 0.3, onUpdate: (v) => { x = v; paint(); } }),
                    mo.spring({ from: dy, to: 0, velocity: vy, damping, response: 0.3, onUpdate: (v) => { y = v; paint(); } }),
                ];
                if (scale !== 1) {
                    springs.push(mo.spring({ from: scale, to: 1, response: 0.3, restDelta: 0.001, restSpeed: 0.01,
                        onUpdate: (v) => { k = v; paint(); } }));
                }
                const settleNow = () => { springs.forEach((sp) => sp.stop()); done(); };
                it._sacSettle = settleNow;
                Promise.all(springs.map((sp) => sp.done)).then((landed) => {
                    if (it._sacSettle === settleNow && landed.every(Boolean)) done();
                });
                return;
            }
            follow(s);
            void it.offsetWidth;
            it.style.transition = `transform ${SLIDE_MS}ms ease-out`;
            it.style.transform = "translate(0px, 0px)" + (scale !== 1 ? " scale(1)" : "");
            it.addEventListener("transitionend", onEnd);
            timer = setTimeout(done, SLIDE_MS + 80);
            it._sacSettle = done;
        }

        // A context menu opening on a held, unmoved press: the menu wins.
        const onMenu = () => {
            const s = state;
            if (!s || container.closest("[data-arranging]")) return;
            if (s.dragging && Math.hypot(s.x - s.liftX, s.y - s.liftY) > TOUCH_SLOP) return;
            end(false);
        };

        // While a finger drag is live the page must not scroll under it.
        // Touch-action cannot change mid-gesture, so touchmove says no instead.
        const onTouchMove = (e) => { if (state && state.dragging) e.preventDefault(); };
        // A long-press would otherwise open the context menu / callout.
        const onContext = (e) => { if (state) e.preventDefault(); };

        container.addEventListener("pointerdown", onDown);
        container.addEventListener("dragstart", noNativeDrag);
        container.addEventListener("sac:context-open", onMenu);
        container.addEventListener("contextmenu", onMenu);
        container.addEventListener("touchmove", onTouchMove, { passive: false });
        container.addEventListener("contextmenu", onContext);

        return {
            destroy() {
                if (state) end(false);
                container.removeEventListener("pointerdown", onDown);
                container.removeEventListener("dragstart", noNativeDrag);
                container.removeEventListener("sac:context-open", onMenu);
                container.removeEventListener("contextmenu", onMenu);
                container.removeEventListener("touchmove", onTouchMove);
                container.removeEventListener("contextmenu", onContext);
                if (mo) mo.disconnect();
            },
        };
    }

    /* ---------------------------------------------------- sac.sortable --- */

    function sortable(container, opts = {}) {
        const {
            items = "*",
            handle = null,
            axis = "y",
            onReorder = null,
            disabled = false,
            ignore = IGNORE,
        } = opts;

        const list = () => Array.from(container.children).filter((el) => el.matches(items));

        return engine(container, {
            axis, handle, ignore, disabled,
            pick: (path) => path.find((n) => n.nodeType === 1 && n.parentNode === container && n.matches(items)) || null,
            start: (item) => ({ from: list().indexOf(item), next: item.nextSibling }),
            move(s) {
                const others = list().filter((el) => el !== s.item);
                let before = null;
                if (axis === "grid") {
                    let best = null, bestD = Infinity;
                    for (const el of others) {
                        const r = el.getBoundingClientRect();
                        const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
                        const d = Math.hypot(cx - s.x, cy - s.y);
                        if (d < bestD) { bestD = d; best = { el, cx }; }
                    }
                    if (best) before = s.x < best.cx ? best.el : best.el.nextElementSibling;
                } else {
                    for (const el of others) {
                        const r = el.getBoundingClientRect();
                        const mid = axis === "x" ? r.left + r.width / 2 : r.top + r.height / 2;
                        if ((axis === "x" ? s.x : s.y) < mid) { before = el; break; }
                    }
                    if (!before && others.length) before = others[others.length - 1].nextSibling;
                }
                if (before !== s.item && before !== s.item.nextSibling) {
                    container.insertBefore(s.item, before);
                }
            },
            finish(s, ok) {
                const m = s.memo;
                if (!ok) {
                    container.insertBefore(s.item, m.next && m.next.parentNode === container ? m.next : null);
                    return;
                }
                const to = list().indexOf(s.item);
                if (to !== m.from && typeof onReorder === "function") onReorder(m.from, to);
            },
        });
    }

    sac.sortable = sortable;

    /* ---------------------------------------------- sac.tiles.sortable --- */

    /**
     * Drag-to-reorder for a hub grid (ui.css .grid) whose small tiles sit in
     * .tile-pack cells. Every tile is an item in ONE flat order — grid tiles
     * and pack tiles alike — and the packing follows the drag live:
     * consecutive .small tiles share a pack, nine per pack (3×3); a small tile
     * dragged out leaves its pack (it closes up, an empty one goes), one
     * dragged next to others joins theirs, a bigger tile pushes the rest
     * (packs included) aside. The helper owns the packing, so the hub keeps
     * the kit's rule by construction.
     *
     *   const s = sac.tiles.sortable(grid, {
     *       items: ".tile",                    // default — the movable tiles
     *       onReorder(from, to, tile) { … },   // flat indices, once per drop
     *       disabled: () => !isOwner,          // boolean or function
     *       ignore: "…",                       // presses that never drag
     *       label: (tile) => tile.dataset.name, // optional — a tile's name
     *                          // for announcements (default: its
     *                          // aria-label, title, heading, text)
     *   });
     *   s.repack();   // after the host added / removed tiles itself
     *   s.arrange(true);  s.arranging;   // the arrange mode, see below
     *   s.arrangeItem();  // → the "Arrange" entry for a tile's context menu
     *   s.destroy();
     *
     * Arrange mode (the iPhone's): moving tiles is an entry in the tile's
     * context menu — `arrangeItem()` returns it ready-made (`sac.contextMenu`
     * items). Arranging, the grid carries data-arranging: the tiles wiggle
     * (ui.css; under reduced motion a dashed hairline instead), a floating
     * "Arrange · Done" pill shows, a tap opens nothing, a finger drags at
     * once, and no context menu opens. Done, Escape or a tap on a free spot
     * ends it. sac:arrange { arranging } fires on the grid either way.
     * A mouse drags tiles any time (the desktop convention); a finger only
     * while arranging.
     *
     * Keyboard (2.36.0): Shift+F10 / the Menu key on a focused tile → Arrange
     * enters the mode. While arranging, Alt+←/↑ moves the focused tile one
     * place earlier in the flat order and Alt+→/↓ one place later (the
     * sac-layer-list convention; on a tile, Alt+←/→ no longer goes Back /
     * Forward). A key move commits exactly as a drop does — packs re-form,
     * the neighbours slide, onReorder(from, to, tile) fires once per step —
     * and focus stays on the tile. A visually hidden live region in the pill
     * says how the mode works on entry ("Arrange mode. Alt+arrow keys move
     * the focused tile. Escape or Done ends.") and announces every move
     * ("Moved Notes to position 3 of 12"); at either end it says where the
     * tile is. The pill's visible text stays "Arrange · Done". Outside
     * arrange mode no key moves a tile.
     *
     * Feel (the home-screen kind):
     *   lift    — the tile follows the pointer 1:1 at its grab offset, a
     *             little larger (1.03), with a strong shadow, on top; the
     *             grid carries data-sortable-active (ui.css: grabbing
     *             cursor, no hover on the other tiles).
     *   target  — hit-tested against the SETTLED layout (never against
     *             tiles still sliding). The order changes only when the
     *             pointer enters another tile — its before or after half —
     *             and then holds until the pointer leaves whatever it is
     *             over after the change: one reorder per tile entered,
     *             never an oscillation. Over a gap, a fixed tile or outside
     *             every tile the slot stays; past the last tile = the end.
     *   slide   — displaced tiles (packs re-forming included) slide to their
     *             new cells, 200ms ease-out.
     *   settle  — on drop the tile glides from the pointer into its slot,
     *             on a spring at the speed the pointer let go (sac.motion;
     *             without it a 200ms ease-out); Escape glides it — and
     *             everything else — back to the exact DOM from before the drag.
     *   reduced motion — the same targeting, nothing animates.
     *
     * Grid children that are neither an item nor a .tile-pack (a cover tile)
     * keep their place among the grid's children, and nothing moves past
     * them. Presses on a button, a <sac-menu> or a text field never drag; a
     * tile link's native drag is off while a press is live. Input is
     * sac.sortable's: 4px to lift with mouse / pen, the click after a drop
     * is eaten.
     */
    function tilesSortable(grid, opts = {}) {
        const {
            items = ".tile",
            onReorder = null,
            disabled = false,
            ignore = IGNORE + ", button, sac-menu",
            label = null,
        } = opts;

        const isPack = (el) => el.classList.contains("tile-pack");
        const isItem = (el) => el.nodeType === 1 && el.matches(items) && !isPack(el);

        /** The flat order: grid tiles and pack tiles, in document order. */
        function flat() {
            const out = [];
            for (const el of grid.children) {
                if (isPack(el)) { for (const t of el.children) if (isItem(t)) out.push(t); }
                else if (isItem(el)) out.push(el);
            }
            return out;
        }

        /** Grid children that stay put: [index among the children, element]. */
        function fixed() {
            const out = [];
            Array.from(grid.children).forEach((el, i) => { if (!isPack(el) && !isItem(el)) out.push([i, el]); });
            return out;
        }

        /** Lay `order` out: runs of small tiles in packs of nine (existing
         *  packs reused in order, new ones made, empty ones dropped), the
         *  fixed children back at their indices. */
        function pack(order, keep) {
            const packs = Array.from(grid.children).filter(isPack);
            const units = [];
            let cur = null;
            for (const t of order) {
                if (t.classList.contains("small")) {
                    if (!cur || cur.length === PACK) { cur = []; units.push(cur); }
                    cur.push(t);
                } else {
                    cur = null;
                    units.push(t);
                }
            }
            const children = units.map((u) => {
                if (!Array.isArray(u)) return u;
                const p = packs.shift() || Object.assign(document.createElement("div"), { className: "tile-pack" });
                // Only what differs moves: a tile in its place is left alone.
                if (p.children.length !== u.length || u.some((t, i) => p.children[i] !== t)) p.replaceChildren(...u);
                return p;
            });
            for (const [i, el] of keep) children.splice(Math.min(i, children.length), 0, el);
            if (children.length !== grid.children.length || children.some((c, i) => grid.children[i] !== c)) {
                grid.replaceChildren(...children);
            }
        }

        /** Change the DOM and slide every tile but the lifted one from where
         *  it shows now to its new cell (FLIP). Returns the settled layout:
         *  each tile's rect relative to the grid, measured before any slide
         *  offset is applied — what targeting tests against. */
        function relayout(mutate, lifted) {
            const all = flat();
            const animate = !reducedMotion();
            const was = new Map();
            if (animate) for (const t of all) if (t !== lifted) was.set(t, t.getBoundingClientRect());
            mutate();
            const now = flat();
            // The settled layout: no slide offsets, the lifted tile in its slot.
            const liftedT = lifted ? lifted.style.transform : "";
            if (lifted) lifted.style.transform = "";
            for (const t of now) {
                if (t === lifted || !t._sacSlide) continue;
                t._sacSlide();
            }
            const g = grid.getBoundingClientRect();
            const rects = new Map(now.map((t) => {
                const r = t.getBoundingClientRect();
                return [t, { left: r.left - g.left, top: r.top - g.top, right: r.right - g.left, bottom: r.bottom - g.top }];
            }));
            if (lifted) lifted.style.transform = liftedT;
            if (!animate) return rects;
            const moved = [];
            for (const t of now) {
                const a = was.get(t);
                if (!a) continue;
                const b = rects.get(t);
                const dx = a.left - (b.left + g.left), dy = a.top - (b.top + g.top);
                if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) continue;
                const prev = t.style.transition;
                t.style.transition = "none";
                t.style.transform = `translate(${dx}px, ${dy}px)`;
                moved.push([t, prev]);
            }
            if (!moved.length) return rects;
            void grid.offsetWidth;
            for (const [t, prev] of moved) {
                t.style.transition = `transform ${SLIDE_MS}ms ease-out`;
                t.style.transform = "";
                const done = () => {
                    clearTimeout(timer);
                    t.removeEventListener("transitionend", onEnd);
                    t._sacSlide = null;
                    t.style.transition = prev;
                    t.style.transform = "";
                };
                const onEnd = (ev) => { if (ev.target === t && ev.propertyName === "transform") done(); };
                const timer = setTimeout(done, SLIDE_MS + 80);
                t.addEventListener("transitionend", onEnd);
                t._sacSlide = done;
            }
            return rects;
        }

        /** The tile under a viewport point in the settled layout: an item,
         *  "self" (the lifted tile's own slot), or null (a gap, a fixed tile,
         *  outside). */
        function hitTest(m, item, x, y) {
            const g = grid.getBoundingClientRect();
            const gx = x - g.left, gy = y - g.top;
            for (const [t, r] of m.rects) {
                if (gx >= r.left && gx < r.right && gy >= r.top && gy < r.bottom) return t === item ? "self" : t;
            }
            return null;
        }

        /** Below the last tile, or right of it on its row. */
        function pastEnd(m, others, x, y) {
            const last = others[others.length - 1];
            const r = last && m.rects.get(last);
            if (!r) return false;
            const g = grid.getBoundingClientRect();
            const gx = x - g.left, gy = y - g.top;
            return gy >= r.bottom || (gy >= r.top && gx >= r.right);
        }

        /* ---- arrange mode ---- */

        let arranging = false;
        let pill = null;
        let live = null;          // the pill's hidden live region (announcements)
        let liveTimer = null;
        let offLang = null;
        const t = (k, fb) => (sac.t ? sac.t(k, fb) : fb);
        const isDisabled = () => (typeof disabled === "function" ? disabled() : !!disabled);

        /** Say something to a screen reader through the pill's live region.
         *  Cleared first, set a beat later — so the same words twice (a tile
         *  already at the end) are spoken twice, and a region made a moment
         *  ago is registered before it changes. */
        function announce(msg) {
            if (!live) return;
            clearTimeout(liveTimer);
            live.textContent = "";
            liveTimer = setTimeout(() => { if (live) live.textContent = msg; }, 120);
        }

        /** A tile's name for an announcement: the host's `label(tile)`, else
         *  its aria-label, its title (a small tile's name), its heading, its
         *  text. */
        function nameOf(tile) {
            if (typeof label === "function") {
                const s = label(tile);
                if (s) return String(s);
            }
            const head = tile.querySelector("h1, h2, h3, h4, h5, h6");
            return (tile.getAttribute("aria-label") || tile.getAttribute("title") ||
                    (head && head.textContent) || tile.textContent || "").trim();
        }

        /** Keyboard, while arranging: Alt+←/↑ moves the focused tile one place
         *  earlier in the flat order, Alt+→/↓ one place later (sac-layer-list's
         *  Alt+Arrow reorder). Committed as a drop is: the DOM re-packs (the
         *  neighbours slide), onReorder(from, to, tile) fires once per step,
         *  and focus stays on the tile. */
        function onArrangeKey(e) {
            if (!arranging || !e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
            const step = { ArrowLeft: -1, ArrowUp: -1, ArrowRight: 1, ArrowDown: 1 }[e.key];
            if (!step || isDisabled() || grid.hasAttribute("data-sortable-active")) return;
            const order = flat();
            const tile = e.composedPath().find((n) => n.nodeType === 1 && order.includes(n));
            if (!tile) return;
            e.preventDefault();      // Alt+←/→ is also the browser's Back / Forward
            e.stopPropagation();
            const from = order.indexOf(tile);
            const to = from + step;
            const name = nameOf(tile);
            if (to < 0 || to >= order.length) {
                announce(t("tiles.at-position", "{name} is at position {pos} of {count}")
                    .replace("{name}", name).replace("{pos}", from + 1).replace("{count}", order.length));
                return;
            }
            const focused = e.composedPath()[0];
            const next = order.slice();
            next.splice(from, 1);
            next.splice(to, 0, tile);
            relayout(() => pack(next, fixed()), null);
            markArrangeable();
            // Re-packing moved the node, and a moved node drops its focus:
            // give it back to whatever had it (the tile, or a control in it).
            const back = focused && focused.nodeType === 1 && tile.contains(focused) ? focused : tile;
            if (typeof back.focus === "function") back.focus({ preventScroll: true });
            if (typeof tile.scrollIntoView === "function") tile.scrollIntoView({ block: "nearest", inline: "nearest" });
            announce(t("tiles.moved", "Moved {name} to position {pos} of {count}")
                .replace("{name}", name).replace("{pos}", to + 1).replace("{count}", order.length));
            if (typeof onReorder === "function") onReorder(from, to, tile);
        }
        // A tap on a tile opens nothing while arranging.
        const noOpen = (e) => {
            const tile = e.composedPath().find((n) => n.nodeType === 1 && isItem(n));
            if (tile) { e.preventDefault(); e.stopPropagation(); }
        };
        // Done: a tap on a free spot (not a tile, not the pill), or Escape.
        const freeTap = (e) => {
            const path = e.composedPath();
            if (pill && path.includes(pill)) return;
            if (path.some((n) => n.nodeType === 1 && isItem(n) && grid.contains(n))) return;
            arrange(false);
        };
        const onEsc = (e) => { if (e.key === "Escape" && !grid.hasAttribute("data-sortable-active")) arrange(false); };

        /** The tiles that move wiggle (ui.css) — not a fixed cover tile. */
        function markArrangeable() {
            grid.querySelectorAll("[data-arrangeable]").forEach((n) => n.removeAttribute("data-arrangeable"));
            if (arranging) flat().forEach((tile) => tile.setAttribute("data-arrangeable", ""));
        }

        function labelPill() {
            if (!pill) return;
            pill.querySelector(".sac-arrange-label").textContent = t("tiles.arranging", "Arrange");
            pill.querySelector("button").textContent = t("tiles.done", "Done");
        }

        function arrange(on) {
            on = !!on;
            if (on === arranging) return;
            arranging = on;
            grid.toggleAttribute("data-arranging", on);
            markArrangeable();
            if (on) {
                pill = document.createElement("div");
                pill.className = "sac-arrange-pill";
                pill.innerHTML = `<span class="sac-arrange-label"></span><button type="button" class="btn primary"></button>`;
                pill.querySelector("button").addEventListener("click", () => arrange(false));
                // The announcements' live region: visually hidden, out of the
                // pill's flex flow (absolute), gone with the pill. It — not
                // the pill — is the status: the pill's own text stays
                // "Arrange · Done", the region says how the mode works.
                live = document.createElement("div");
                live.className = "sac-arrange-live";
                live.setAttribute("role", "status");
                live.style.cssText = "position:absolute;width:1px;height:1px;margin:-1px;padding:0;" +
                    "border:0;overflow:hidden;clip-path:inset(50%);white-space:nowrap;";
                pill.appendChild(live);
                labelPill();
                document.body.appendChild(pill);
                announce(t("tiles.arrange-help",
                    "Arrange mode. Alt+arrow keys move the focused tile. Escape or Done ends."));
                if (sac.lang) offLang = sac.lang.onChange(labelPill);
                grid.addEventListener("click", noOpen, true);
                grid.addEventListener("keydown", onArrangeKey);
                document.addEventListener("keydown", onEsc);
                // Not the click that chose "Arrange": from the next one on.
                setTimeout(() => { if (arranging) document.addEventListener("click", freeTap, true); }, 0);
            } else {
                clearTimeout(liveTimer);
                live = null;
                if (pill) { pill.remove(); pill = null; }
                if (offLang) { offLang(); offLang = null; }
                grid.removeEventListener("click", noOpen, true);
                grid.removeEventListener("keydown", onArrangeKey);
                document.removeEventListener("keydown", onEsc);
                document.removeEventListener("click", freeTap, true);
            }
            grid.dispatchEvent(new CustomEvent("sac:arrange", { detail: { arranging: on }, bubbles: true, composed: true }));
        }

        const eng = engine(grid, {
            axis: "grid", handle: null, ignore, disabled,
            scale: 1.03, settle: true,
            // A mouse drags any time; a finger only while arranging — then
            // at once (the tiles claim the gesture, ui.css touch-action).
            touch: () => (arranging ? "move" : "off"),
            pick: (path) => {
                for (const n of path) {
                    if (n === grid) return null;
                    if (n.nodeType === 1 && isItem(n) &&
                        (n.parentNode === grid || (n.parentNode && isPack(n.parentNode) && n.parentNode.parentNode === grid))) return n;
                }
                return null;
            },
            start(item) {
                // The exact DOM, for an Escape: the grid's children and each pack's.
                const kids = Array.from(grid.children);
                return {
                    from: flat().indexOf(item),
                    kids,
                    packs: kids.filter(isPack).map((p) => [p, Array.from(p.children)]),
                    keep: fixed(),
                    rects: null,     // the settled layout, relative to the grid
                    hold: undefined, // what the pointer was over after the last change
                };
            },
            move(s) {
                const m = s.memo;
                const item = s.item;
                if (!m.rects) m.rects = relayout(() => {}, item);
                const hit = hitTest(m, item, s.x, s.y);
                // Hysteresis: after a change, nothing until the pointer leaves
                // what it was over then — the reflow must not re-trigger.
                if (m.hold !== undefined) {
                    if (hit === m.hold) return;
                    m.hold = undefined;
                }
                const order = flat();
                const others = order.filter((t) => t !== item);
                let at;
                if (hit && hit !== "self") {
                    const r = m.rects.get(hit);
                    const g = grid.getBoundingClientRect();
                    const i = others.indexOf(hit);
                    at = s.x - g.left < (r.left + r.right) / 2 ? i : i + 1;
                } else if (!hit && pastEnd(m, others, s.x, s.y)) {
                    at = others.length;
                } else {
                    return;                     // a gap, a fixed tile, its own slot: stay
                }
                const next = others.slice();
                next.splice(at, 0, item);
                if (next.every((t, i) => t === order[i])) return;
                m.rects = relayout(() => pack(next, m.keep), item);
                m.hold = hitTest(m, item, s.x, s.y);
            },
            finish(s, ok) {
                const m = s.memo;
                if (!ok) {
                    relayout(() => {
                        m.packs.forEach(([p, kids]) => p.replaceChildren(...kids));
                        grid.replaceChildren(...m.kids);
                    }, s.item);
                    return;
                }
                const to = flat().indexOf(s.item);
                if (to !== m.from && typeof onReorder === "function") onReorder(m.from, to, s.item);
            },
        });

        return {
            destroy() { arrange(false); eng.destroy(); },
            repack() { pack(flat(), fixed()); markArrangeable(); },
            arrange,
            get arranging() { return arranging; },
            arrangeItem: () => ({ id: "arrange", label: "Arrange", labelKey: "tiles.arrange", icon: "move",
                                  onClick: () => arrange(true) }),
        };
    }

    sac.tiles = Object.assign(sac.tiles || {}, { sortable: tilesSortable });
})();
