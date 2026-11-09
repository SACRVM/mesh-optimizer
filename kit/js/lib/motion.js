/**
 * SACRVM APPKIT — sac.motion: springs and gesture physics, no library.
 *
 * Use it where a gesture LETS GO of something: a window thrown, a sheet
 * pulled down, a drawer swiped shut, a tile dropped. Only a spring starts from
 * the value on screen and carries on at the finger's speed, so the hand-off
 * from finger to animation has no seam, and it can be grabbed again
 * mid-flight. State changes nobody holds (hover, a menu opening) stay CSS
 * transitions with the --ease-* tokens.
 *
 *   const s = sac.motion.spring({
 *       from: 120, to: 0,            // any unit: px, degrees, 0–1
 *       velocity: v,                 // units per second, e.g. a tracker's
 *       damping: 1,                  // 1 = settles without overshoot; < 1 overshoots
 *       response: 0.35,              // seconds — how quickly, not a duration
 *       onUpdate(value, velocity) { el.style.translate = `0 ${value}px`; },
 *       onDone() { … },              // settled (not called after stop())
 *   });
 *   s.value; s.velocity;             // where it is now — start the next one here
 *   s.retarget(300);                 // new target, same position and speed
 *   s.stop();                        // freeze where it is (grabbed again)
 *   await s.done;                    // true = settled, false = stopped
 *
 *   const track = sac.motion.tracker();       // release velocity of one axis
 *   track.add(y);                             // every pointermove
 *   const v = track.velocity();               // px/s; 0 when the pointer stopped
 *   track.reset();
 *
 *   sac.motion.project(v)            // how far a flick at v px/s carries on
 *   sac.motion.rubberband(over, size)// past a boundary: follow less and less
 *   sac.motion.reduced()             // prefers-reduced-motion: reduce?
 *
 * Values (Apple's two-parameter spring): damping 1 with a response of
 * 0.3–0.4s is the default. ~0.8 only when the release carried momentum (a
 * flick); a menu that merely opened never bounces. Pick a snap target from
 * where the throw is heading — current + project(v) — not from where the
 * finger let go, then hand v to the spring.
 *
 * Reduced motion, or a hidden page (no animation frames there): a spring
 * jumps to its target — onUpdate(to, 0) at once, onDone and `done` a
 * microtask later — so the outcome is the same and only the travel goes.
 *
 * restDelta / restSpeed decide "settled", in the value's own units: the
 * defaults (0.5 / 5) suit pixels; pass e.g. 0.001 / 0.01 for an opacity or a
 * scale.
 *
 * The formulas for projection and rubber-banding are Apple's, from the WWDC
 * 2018 talk "Designing Fluid Interfaces".
 */
(function () {
    const reduced = () => !!(window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches);

    function spring({ from, to, velocity = 0, damping = 1, response = 0.35,
                      restDelta = 0.5, restSpeed = 5, onUpdate = () => {}, onDone = null }) {
        const k = (2 * Math.PI / response) ** 2;       // stiffness, for a mass of 1
        const c = 4 * Math.PI * damping / response;    // 2 · damping ratio · natural frequency
        let target = to;
        let x = from - to;                             // offset from the target
        let v = velocity;
        let last = null, raf = 0, running = true;
        let resolve;
        const done = new Promise((r) => { resolve = r; });

        const finish = (settled) => {
            if (!running) return;
            running = false;
            cancelAnimationFrame(raf);
            if (settled) { x = 0; v = 0; }
            resolve(settled);
        };
        const settle = () => {
            onUpdate(target, 0);
            finish(true);
            if (onDone) onDone();
        };

        const frame = (now) => {
            if (!running) return;
            // A long gap (a background tab, a jank spike) must not fling it.
            let dt = last === null ? 1 / 60 : Math.min((now - last) / 1000, 1 / 30);
            last = now;
            while (dt > 0) {                           // fixed sub-steps: the same feel at 30–144 Hz
                const h = Math.min(dt, 1 / 240);
                v += (-k * x - c * v) * h;
                x += v * h;
                dt -= h;
            }
            if (Math.abs(x) < restDelta && Math.abs(v) < restSpeed) { x = 0; v = 0; settle(); return; }
            onUpdate(target + x, v);
            raf = requestAnimationFrame(frame);
        };

        const handle = {
            get value() { return target + x; },
            get velocity() { return v; },
            get target() { return target; },
            get running() { return running; },
            done,
            stop() { finish(false); },
            retarget(next, opts = {}) {
                if (!running) return handle;
                x = target + x - next;
                target = next;
                if (opts.velocity !== undefined) v = opts.velocity;
                return handle;
            },
        };

        if (reduced() || document.hidden) {
            x = 0; v = 0;
            onUpdate(target, 0);
            queueMicrotask(() => { if (running) { finish(true); if (onDone) onDone(); } });
            return handle;
        }
        raf = requestAnimationFrame(frame);
        return handle;
    }

    /** Release velocity of one axis, from the samples of the last windowMs.
     *  A pointer that stopped before letting go reports 0, not its old
     *  speed. Timestamps default to performance.now(); a PointerEvent's
     *  timeStamp is on the same clock. */
    function tracker(windowMs = 100) {
        const samples = [];
        return {
            add(value, t = performance.now()) {
                samples.push({ value, t });
                if (samples.length > 64) samples.shift();
            },
            velocity(now = performance.now()) {
                while (samples.length && now - samples[0].t > windowMs) samples.shift();
                if (samples.length < 2) return 0;
                const a = samples[0], b = samples[samples.length - 1];
                return b.t > a.t ? (b.value - a.value) / (b.t - a.t) * 1000 : 0;
            },
            reset() { samples.length = 0; },
        };
    }

    /** How far a flick at `velocity` (px/s) carries on before it stops:
     *  d = 0.998 feels like normal scrolling, 0.99 stops sooner. */
    const project = (velocity, d = 0.998) => (velocity / 1000) * d / (1 - d);

    /** Past a boundary the element follows less and less. overshoot = how
     *  far the finger is past the edge; dimension = the element's size on
     *  that axis. Never exceeds dimension. */
    const rubberband = (overshoot, dimension, c = 0.55) =>
        dimension > 0 ? (overshoot * dimension * c) / (dimension + c * Math.abs(overshoot)) : 0;

    sac.motion = { spring, tracker, project, rubberband, reduced };
})();
