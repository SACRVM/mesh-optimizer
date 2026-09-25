/**
 * SACRVM APPKIT — color math (sac.color).
 *
 * The one place the kit converts between the three representations a color
 * UI needs: the hex string an app stores, the RGB triple it paints with, and
 * the HSV triple a picker actually manipulates. Every color component in the
 * kit (<sac-color-picker>, color fields, swatches) speaks through here, so a
 * rounding rule or a parsing tolerance is fixed once and holds everywhere.
 *
 * Classic script, loads with the other libs (after globals.js, before the
 * components) and installs itself defensively — an app that already provides
 * its own sac.color keeps it.
 *
 * Usage:
 *   const rgba = sac.color.parse("#3B82F6");        // { r: 59, g: 130, b: 246, a: 1 }
 *   sac.color.format(rgba);                          // "#3b82f6"
 *   sac.color.format({ ...rgba, a: 0.5 }, { alpha: true });   // "#3b82f680"
 *   const hsv  = sac.color.rgbToHsv(rgba);          // { h: 217.2…, s: 0.76, v: 0.96 }
 *   sac.color.hsvToRgb({ h: 0, s: 1, v: 1 });       // { r: 255, g: 0, b: 0 }
 *   sac.color.onColor(rgba);                         // "#ffffff" — readable ON that ground
 *
 * API:
 *   parse(str)      → { r, g, b, a } | null
 *                     r/g/b integers 0–255, a float 0–1. Accepts, case-
 *                     insensitively and with or without a leading "#":
 *                     "rgb", "rgba", "rrggbb", "rrggbbaa". Surrounding
 *                     whitespace is trimmed. ANYTHING else — a color name, an
 *                     "rgb(…)" function, a 5-digit string, "" or a non-string
 *                     — returns null. Callers treat null as "user is still
 *                     typing", never as an error.
 *   format(rgba, { alpha = false })
 *                   → "#rrggbb" (lowercase), or "#rrggbbaa" with alpha: true.
 *                     Components are clamped to 0–255 and rounded; a missing
 *                     `a` counts as 1. Never throws — a junk input formats as
 *                     "#000000" rather than blowing up a render.
 *   rgbToHsv({r,g,b}) → { h: 0–360, s: 0–1, v: 0–1 }
 *                     Grays and black have no hue: h is 0 there. UI that must
 *                     REMEMBER the hue across s=0 / v=0 keeps its own h and
 *                     only adopts this one when s and v are non-zero — that is
 *                     the picker's job, not this function's.
 *   hsvToRgb({h,s,v}) → { r, g, b } integers 0–255. h wraps (-90 → 270,
 *                     450 → 90), s/v clamp to 0–1.
 *   luma({r,g,b})   → 0–1, Rec. 709 (0.2126 R + 0.7152 G + 0.0722 B).
 *   onColor({r,g,b}) → "#000000" | "#ffffff" — the readable text/icon color on
 *                     that ground, flipping at luma 0.35.
 *
 * Round-tripping: rgb → hsv → rgb is stable (the divide-by-zero cases at s=0
 * and v=0 are guarded, and both directions round the same way), so dragging a
 * picker thumb never drifts the color it is not touching.
 */
(function () {

    /** Hex digits only — the gate every parse path passes through. */
    const HEX_ONLY = /^[0-9a-f]+$/;

    /** Round + clamp to a byte. Junk (NaN, null, "abc") becomes 0. */
    function byte(n) {
        const v = Math.round(Number(n));
        if (!Number.isFinite(v)) return 0;
        return v < 0 ? 0 : (v > 255 ? 255 : v);
    }

    /** Clamp to 0–1. Junk becomes 0. */
    function unit(n) {
        const v = Number(n);
        if (!Number.isFinite(v)) return 0;
        return v < 0 ? 0 : (v > 1 ? 1 : v);
    }

    /** Normalize any hue into [0, 360). Junk becomes 0. */
    function wrapHue(n) {
        const v = Number(n);
        if (!Number.isFinite(v)) return 0;
        const h = v % 360;
        return h < 0 ? h + 360 : h;
    }

    /** Byte → two lowercase hex digits. */
    function hex2(n) {
        const s = byte(n).toString(16);
        return s.length === 1 ? "0" + s : s;
    }

    /** One hex digit → the byte its doubled form means ("f" → 255). */
    function dbl(ch) {
        return parseInt(ch + ch, 16);
    }

    function parse(str) {
        if (typeof str !== "string") return null;

        let s = str.trim().toLowerCase();
        if (s.charAt(0) === "#") s = s.slice(1);
        if (s === "" || !HEX_ONLY.test(s)) return null;

        switch (s.length) {
            case 3:
                return { r: dbl(s[0]), g: dbl(s[1]), b: dbl(s[2]), a: 1 };
            case 4:
                return { r: dbl(s[0]), g: dbl(s[1]), b: dbl(s[2]), a: dbl(s[3]) / 255 };
            case 6:
                return {
                    r: parseInt(s.slice(0, 2), 16),
                    g: parseInt(s.slice(2, 4), 16),
                    b: parseInt(s.slice(4, 6), 16),
                    a: 1,
                };
            case 8:
                return {
                    r: parseInt(s.slice(0, 2), 16),
                    g: parseInt(s.slice(2, 4), 16),
                    b: parseInt(s.slice(4, 6), 16),
                    a: parseInt(s.slice(6, 8), 16) / 255,
                };
            default:
                return null;
        }
    }

    function format(rgba, options) {
        const c = rgba || {};
        const opts = options || {};
        const out = "#" + hex2(c.r) + hex2(c.g) + hex2(c.b);
        if (!opts.alpha) return out;
        const a = c.a == null ? 1 : unit(c.a);
        return out + hex2(Math.round(a * 255));
    }

    function rgbToHsv(rgb) {
        const c = rgb || {};
        const r = byte(c.r) / 255;
        const g = byte(c.g) / 255;
        const b = byte(c.b) / 255;

        const max = Math.max(r, g, b);
        const min = Math.min(r, g, b);
        const d = max - min;

        // d === 0 is the gray axis: no hue exists, and dividing by d would be
        // the classic NaN. max === 0 is black: same story for saturation.
        let h = 0;
        if (d !== 0) {
            if (max === r)      h = ((g - b) / d) % 6;
            else if (max === g) h = (b - r) / d + 2;
            else                h = (r - g) / d + 4;
            h *= 60;
            if (h < 0) h += 360;
        }

        return { h, s: max === 0 ? 0 : d / max, v: max };
    }

    function hsvToRgb(hsv) {
        const c = hsv || {};
        const h = wrapHue(c.h);
        const s = unit(c.s);
        const v = unit(c.v);

        const chroma = v * s;
        const x = chroma * (1 - Math.abs(((h / 60) % 2) - 1));
        const m = v - chroma;

        let r = 0, g = 0, b = 0;
        switch (Math.floor(h / 60) % 6) {
            case 0: r = chroma; g = x;      b = 0;      break;
            case 1: r = x;      g = chroma; b = 0;      break;
            case 2: r = 0;      g = chroma; b = x;      break;
            case 3: r = 0;      g = x;      b = chroma; break;
            case 4: r = x;      g = 0;      b = chroma; break;
            default: r = chroma; g = 0;     b = x;      break;
        }

        return {
            r: Math.round((r + m) * 255),
            g: Math.round((g + m) * 255),
            b: Math.round((b + m) * 255),
        };
    }

    function luma(rgb) {
        const c = rgb || {};
        // Each channel is normalized BEFORE weighting — same Rec. 709 formula,
        // but this way pure white comes out as exactly 1 instead of 0.9999….
        return 0.2126 * (byte(c.r) / 255)
             + 0.7152 * (byte(c.g) / 255)
             + 0.0722 * (byte(c.b) / 255);
    }

    /**
     * Readable foreground for a ground color. 0.35 rather than the naive 0.5:
     * mid-tone accents (blues, purples) still want white text, and that
     * threshold is what proven practice landed on.
     */
    function onColor(rgb) {
        return luma(rgb) > 0.35 ? "#000000" : "#ffffff";
    }

    if (!window.sac) console.warn("[sac.color] globals.js must load first — colour helpers unavailable.");
    else if (!sac.color) sac.color = { parse, format, rgbToHsv, hsvToRgb, luma, onColor };
})();
