/* SACRVM APPKIT — shared synchronized pan & zoom.
 * Scroll-wheel zoom (anchored at the cursor) + left-mouse drag to pan.
 * Drives several panes from ONE shared transform so side-by-side views move
 * together. Middle-drag pans too; double-click resets.
 *
 * Usage (classic global, works from both classic and module scripts):
 *   const pz = sac.setupPanZoom({ panes: [{ pane: el, layer: el }, ...] });
 *   pz.reset();   // e.g. when a new image loads
 *
 * Options: minScale (0.2), maxScale (24), enabled() — return false to hand
 * the pointer to an edit tool (wheel, drag and touch are all ignored then),
 * onChange(scale) — called after every transform.
 *
 * Each `layer` must fill its `pane` (position:absolute; inset:0;
 * transform-origin:0 0 — the kit's .pz-layer class does exactly this).
 *
 * Compact/touch: one finger pans, two fingers pinch-zoom around their
 * midpoint (and pan with it), double-tap resets. The pane gets
 * `touch-action: none` so the gesture stays inside it — the browser's own
 * page scroll / page zoom is untouched everywhere outside the pane.
 */
(function () {
    if (!window.sac) { console.warn("[sac.setupPanZoom] globals.js must load first — pan/zoom unavailable."); return; }
    function setupPanZoom({ panes, minScale = 0.2, maxScale = 24, enabled, onChange }) {
        let scale = 1, tx = 0, ty = 0;
        const active = () => (typeof enabled !== 'function') || enabled();
        const clamp = (s) => Math.min(maxScale, Math.max(minScale, s));

        function apply() {
            const t = `translate(${tx}px, ${ty}px) scale(${scale})`;
            panes.forEach((p) => { p.layer.style.transform = t; });
            if (typeof onChange === 'function') onChange(scale);
        }
        function reset() { scale = 1; tx = 0; ty = 0; apply(); }

        panes.forEach(({ pane }) => {
            // Without this the browser claims a finger drag as page scroll and
            // a two-finger spread as page zoom before any pointermove arrives.
            // Scoped to the pane, so the rest of the page scrolls as usual.
            pane.style.touchAction = 'none';

            pane.addEventListener('wheel', (e) => {
                if (!active()) return;
                e.preventDefault();
                const rect = pane.getBoundingClientRect();
                const px = e.clientX - rect.left;
                const py = e.clientY - rect.top;
                const factor = Math.exp(-e.deltaY * 0.0015);
                const ns = clamp(scale * factor);
                // Keep the point under the cursor fixed.
                tx = px - (px - tx) * (ns / scale);
                ty = py - (py - ty) * (ns / scale);
                scale = ns;
                apply();
            }, { passive: false });

            // Mouse keeps its own mousedown path: preventDefault there is what
            // suppresses text selection and the middle-button autoscroll.
            pane.addEventListener('mousedown', (e) => {
                // Left button (0) pans; middle button (1) pans too.
                if (!active() || (e.button !== 0 && e.button !== 1)) return;
                e.preventDefault();
                const sx = e.clientX, sy = e.clientY, ox = tx, oy = ty;
                pane.classList.add('grabbing');
                const move = (ev) => { tx = ox + (ev.clientX - sx); ty = oy + (ev.clientY - sy); apply(); };
                const up = () => {
                    window.removeEventListener('mousemove', move);
                    window.removeEventListener('mouseup', up);
                    pane.classList.remove('grabbing');
                };
                window.addEventListener('mousemove', move);
                window.addEventListener('mouseup', up);
            });

            // Touch / pen: pointer events, tracked per pointer id. One pointer
            // pans, two pinch. Every change in pointer count re-bases the
            // gesture, so lifting one finger of a pinch continues as a pan
            // without a jump.
            const pts = new Map();
            let base = null;
            const local = (p) => {
                const r = pane.getBoundingClientRect();
                return { x: p.x - r.left, y: p.y - r.top };
            };
            const rebase = () => {
                const [a, b] = [...pts.values()];
                if (!a) { base = null; return; }
                if (!b) { base = { x: a.x, y: a.y, tx, ty }; return; }
                const m = local({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
                base = {
                    d: Math.hypot(b.x - a.x, b.y - a.y) || 1,
                    // The content point under the midpoint — it stays under
                    // the (moving) midpoint for the whole pinch.
                    cx: (m.x - tx) / scale, cy: (m.y - ty) / scale, s: scale,
                };
            };
            const onMove = (e) => {
                if (!pts.has(e.pointerId) || !base) return;
                pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
                const [a, b] = [...pts.values()];
                if (!b) {
                    tx = base.tx + (a.x - base.x);
                    ty = base.ty + (a.y - base.y);
                } else {
                    const m = local({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
                    scale = clamp(base.s * Math.hypot(b.x - a.x, b.y - a.y) / base.d);
                    tx = m.x - base.cx * scale;
                    ty = m.y - base.cy * scale;
                }
                apply();
            };
            const onUp = (e) => {
                if (!pts.delete(e.pointerId)) return;
                rebase();
                if (!pts.size) {
                    window.removeEventListener('pointermove', onMove);
                    window.removeEventListener('pointerup', onUp);
                    window.removeEventListener('pointercancel', onUp);
                    pane.classList.remove('grabbing');
                }
            };
            pane.addEventListener('pointerdown', (e) => {
                if (e.pointerType === 'mouse' || !active()) return;
                // A third finger is ignored — it would only muddy the pinch.
                if (pts.size >= 2) return;
                if (!pts.size) {
                    window.addEventListener('pointermove', onMove);
                    window.addEventListener('pointerup', onUp);
                    window.addEventListener('pointercancel', onUp);
                    pane.classList.add('grabbing');
                }
                pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
                rebase();
            });

            // Double-click (double-tap on touch) resets the view.
            pane.addEventListener('dblclick', () => { if (active()) reset(); });
        });

        apply();
        return { reset, apply };
    }

    sac.setupPanZoom = setupPanZoom;
})();
