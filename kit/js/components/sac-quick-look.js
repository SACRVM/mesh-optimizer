/**
 * <sac-quick-look [nav] [text-limit="262144"]></sac-quick-look>
 *
 *   el.source = { file };                          // a File or Blob
 *   el.source = { url, type, name, size };         // anything the page can fetch
 *   el.source = null;                              // back to the empty state
 *
 * A preview surface: hand it a File or a URL descriptor and it renders the
 * right thing for the type — an Explorer-style preview pane or, inside a
 * maximised <sac-window>, a macOS-style quick look. It never tries to render
 * what it does not understand, and never puts untrusted content into the DOM
 * as HTML.
 *
 * Rendering, by kind (type from the MIME type, else the file extension):
 *   raster image — <img> on a checkerboard, pan/zoom via sac.setupPanZoom
 *                  (wheel, drag, pinch, double-click resets) when loaded.
 *   SVG          — always an <img> from a blob URL: a URL source is fetched
 *                  first, never served inline, never <object> — scripts in
 *                  the file cannot run.
 *   text / code / JSON / CSV / logs — <pre> via textContent, monospace. Only
 *                  the first `text-limit` bytes are read (default 256 KB),
 *                  with a "Showing the first … of …" note. JSON that parses
 *                  is pretty-printed (only when it was read whole).
 *   Markdown     — rendered with the vendored marked + DOMPurify (both must
 *                  be on window, else it shows as text), with a
 *                  Rendered / Source toggle. The choice sticks across files.
 *   audio        — <audio controls preload="metadata">.
 *   video        — <video controls> for whatever the browser can play.
 *   everything else, or a file that fails to load — an info card: icon,
 *                  name, type, size, and the `actions` slot (default: a
 *                  Download link).
 *
 * Attributes:
 *   nav        — shows ‹ › buttons at the sides that fire sac:nav. Bare `nav`
 *                = both; `nav="next"` / `nav="prev"` = one side only (at the
 *                ends of a list). Pure CSS token matching, live.
 *   text-limit — bytes of a text file to read (default 262144).
 *
 * Properties:
 *   source   — the descriptor above (a bare File/Blob is accepted too); null
 *              clears. Reading it returns the normalised descriptor.
 *   kind     — read-only: "image" | "svg" | "video" | "audio" | "markdown" |
 *              "json" | "text" | "other" | "" (empty).
 *
 * Events (bubble + composed):
 *   sac:nav     — detail { direction: -1 | 1 } — ← / → keys or the nav
 *                 buttons. The app walks its list and sets a new source.
 *   sac:dismiss — Escape. The component closes nothing itself: an app that
 *                 hosts it in a <sac-window> closes the window.
 *   sac:load    — detail { kind, source } — the preview finished rendering
 *                 (for a card: at once).
 *   sac:error   — detail { kind, source } — it failed and fell back to the card.
 *
 * Slot:
 *   actions — the info card's buttons. Its fallback is a Download link; put a
 *             `<button slot="actions">` in to replace it.
 *
 * Keyboard: the host is focusable (tabindex 0) — focus it after opening.
 * ← / → fire sac:nav unless focus is in a media control; Escape fires
 * sac:dismiss.
 *
 * Sizing: the preview fills the host's height — give the host one (a pane,
 * a window body). With no height, text grows to its content and images get
 * --quick-look-min-height (default 240px).
 *
 * Compact/touch: nav buttons, toolbar buttons and the Download link grow to
 * 44px under (pointer: coarse); one finger pans an image, two pinch.
 *
 * Object URLs the component creates are revoked when the source changes and
 * on disconnect; a load that finishes after the source changed is discarded.
 */
(function () {

    /** Kit i18n: sac.t when globals.js is loaded, the English fallback when
     *  the component runs standalone. */
    const t = (key, fallback) =>
        (window.sac && window.sac.t) ? window.sac.t(key, fallback) : fallback;

    /** The page language's locale for Intl output. */
    const locale = () => (window.sac && sac.lang ? sac.lang.locale() : undefined);

    function formatSize(bytes) {
        if (bytes == null || !isFinite(bytes)) return "";
        if (bytes < 1024) return `${bytes} B`;
        const num = (v, digits) => v.toLocaleString(locale(),
            { minimumFractionDigits: digits, maximumFractionDigits: digits });
        if (bytes < 1024 * 1024) return `${num(bytes / 1024, bytes < 10240 ? 1 : 0)} KB`;
        return `${num(bytes / 1048576, 1)} MB`;
    }

    /* Extension → MIME, for files that arrive without a type (common for
       code, Markdown and anything from a store that does not keep types). */
    const EXT_TYPES = {
        png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif",
        webp: "image/webp", avif: "image/avif", bmp: "image/bmp", ico: "image/x-icon",
        svg: "image/svg+xml",
        mp4: "video/mp4", m4v: "video/mp4", webm: "video/webm", ogv: "video/ogg",
        mov: "video/quicktime",
        mp3: "audio/mpeg", wav: "audio/wav", ogg: "audio/ogg", oga: "audio/ogg",
        opus: "audio/ogg", m4a: "audio/mp4", aac: "audio/aac", flac: "audio/flac",
        md: "text/markdown", markdown: "text/markdown",
        json: "application/json", csv: "text/csv", tsv: "text/tab-separated-values",
    };
    /* Plain text by extension — shown as source, never rendered. */
    const TEXT_EXT = new Set(("txt log ini cfg conf toml yml yaml xml html htm css js mjs cjs " +
        "ts tsx jsx py rb go rs c h cpp hpp cc cs java kt swift php sh bash zsh ps1 bat cmd " +
        "sql lua r pl gitignore env properties srt vtt").split(" "));

    const extOf = (name) => {
        const m = /\.([^./\\]+)$/.exec(String(name || ""));
        return m ? m[1].toLowerCase() : "";
    };

    function classify(type, name) {
        const m = String(type || "").toLowerCase().split(";")[0].trim();
        const ext = extOf(name);
        if (m === "image/svg+xml" || (!m && ext === "svg")) return "svg";
        if (m === "text/markdown" || m === "text/x-markdown" || ext === "md" || ext === "markdown") return "markdown";
        if (m === "application/json" || m.endsWith("+json") || ext === "json") return "json";
        if (m.startsWith("image/")) return "image";
        if (m.startsWith("video/")) return "video";
        if (m.startsWith("audio/")) return "audio";
        if (m.startsWith("text/") || m.endsWith("+xml") || m === "application/xml" ||
            m === "application/javascript" || m === "application/x-sh" ||
            m === "application/x-yaml" || m === "application/toml" || m === "application/sql") return "text";
        if (!m || m === "application/octet-stream") {
            const guess = EXT_TYPES[ext];
            if (guess) return classify(guess, "");
            if (TEXT_EXT.has(ext)) return "text";
        }
        return "other";
    }

    const ICONS = { image: "image", svg: "image", video: "film", audio: "play",
                    markdown: "document", json: "document", text: "document", other: "attachment" };

    /* Marked output goes through DOMPurify; <style> and style="" are dropped
       too — a rendered README must not restyle the preview's own shadow. */
    const PURIFY = { FORBID_TAGS: ["style"], FORBID_ATTR: ["style"] };

class SacQuickLook extends HTMLElement {
    static get observedAttributes() { return ["text-limit"]; }

    constructor() {
        super();
        this.attachShadow({ mode: "open" });
        this._source = null;
        this._kind = "";
        this._token = 0;
        this._urls = [];          // object URLs owned by the current preview
        this._labels = [];        // [el, fn, attr] — relabelled on a language switch
        this._abort = null;
        this._mdMode = "rendered";
    }

    connectedCallback() {
        if (!this.shadowRoot.firstChild) this._render();
        if (!this.hasAttribute("tabindex")) this.tabIndex = 0;
        if (!this.hasAttribute("role")) this.setAttribute("role", "region");
        if (window.sac && sac.lang && !this._offLang) this._offLang = sac.lang.onChange(() => this._relabel());
        // Re-attached after a disconnect: the object URLs were revoked, so
        // the preview is rebuilt from the source.
        if (this._stale) { this._stale = false; this._load(); }
        else if (!this._token) this._load();
        this._relabel();
    }

    disconnectedCallback() {
        if (this._offLang) { this._offLang(); this._offLang = null; }
        this._token++;            // drop any load still in flight
        if (this._abort) { this._abort.abort(); this._abort = null; }
        this._revoke();
        this._stale = true;
    }

    attributeChangedCallback(name, oldV, newV) {
        if (name === "text-limit" && oldV !== newV && this._view &&
            ["text", "json", "markdown"].includes(this._kind)) this._load();
    }

    /* ---------------------------------------------------------------- API */

    get source() { return this._source; }
    set source(v) {
        this._source = SacQuickLook.normalize(v);
        if (this._view) this._load();
    }

    get kind() { return this._kind; }

    get textLimit() {
        const n = parseInt(this.getAttribute("text-limit"), 10);
        return n > 0 ? n : SacQuickLook.TEXT_LIMIT;
    }
    set textLimit(v) {
        if (v == null) this.removeAttribute("text-limit");
        else this.setAttribute("text-limit", String(v));
    }

    /** A File/Blob, { file }, or { url, type, name, size } → one shape:
     *  { file?, url?, name, type, size, modified }. */
    static normalize(v) {
        if (!v) return null;
        if (v instanceof Blob) v = { file: v };
        const file = v.file instanceof Blob ? v.file : null;
        if (!file && !v.url) return null;
        const url = file ? null : String(v.url);
        let name = v.name || (file && file.name) || "";
        if (!name && url) {
            try { name = decodeURIComponent(new URL(url, location.href).pathname.split("/").pop() || ""); }
            catch (err) { name = ""; }
        }
        const type = v.type || (file && file.type) || EXT_TYPES[extOf(name)] || "";
        const size = v.size != null ? v.size : (file ? file.size : null);
        const modified = v.modified != null ? v.modified : (file && file.lastModified) || null;
        return { file, url, name, type, size, modified };
    }

    /* --------------------------------------------------------------- load */

    _load() {
        const token = ++this._token;
        if (this._abort) { this._abort.abort(); this._abort = null; }
        this._revoke();
        this._doc = null;
        this._labels = this._labels.filter(([el]) => !this._view.contains(el));
        this._view.replaceChildren();

        const src = this._source;
        if (!src) {
            this._kind = "";
            this._view.append(this._el("div", "empty", null,
                () => t("quick-look.empty", "Nothing to preview")));
            return;
        }
        const kind = this._kind = classify(src.type, src.name);
        this._view.dataset.kind = kind;

        if (kind === "image") this._showImage(src.file ? this._objectUrl(src.file) : src.url, token);
        else if (kind === "svg") this._loadSvg(src, token);
        else if (kind === "video" || kind === "audio") this._showMedia(kind, src, token);
        else if (kind === "text" || kind === "json" || kind === "markdown") this._loadText(kind, src, token);
        else this._showCard(null, token);
    }

    _objectUrl(blob) {
        const u = URL.createObjectURL(blob);
        this._urls.push(u);
        return u;
    }

    _revoke() {
        for (const u of this._urls) URL.revokeObjectURL(u);
        this._urls = [];
    }

    _done(token, ok) {
        if (token !== this._token) return;
        this.dispatchEvent(new CustomEvent(ok ? "sac:load" : "sac:error", {
            detail: { kind: this._kind, source: this._source }, bubbles: true, composed: true,
        }));
    }

    /** Failure path: whatever was being built goes, the info card comes. */
    _fail(token) {
        if (token !== this._token) return;
        this._view.replaceChildren();
        this._revoke();
        this._showCard("failed", token);
    }

    _loading() {
        this._view.append(this._el("div", "empty", null, () => t("quick-look.loading", "Loading…")));
    }

    /* ------------------------------------------------------------- images */

    _showImage(url, token) {
        const stage = this._el("div", "stage");
        const layer = this._el("div", "pz-layer");
        const img = document.createElement("img");
        img.alt = this._source.name || "";
        img.draggable = false;
        img.addEventListener("load", () => this._done(token, true), { once: true });
        img.addEventListener("error", () => this._fail(token), { once: true });
        img.src = url;
        layer.append(img);
        stage.append(layer);
        this._view.append(stage);
        // A fresh stage per image: its listeners go with it, and the view
        // starts fitted (scale 1) every time.
        if (window.sac && sac.setupPanZoom) sac.setupPanZoom({ panes: [{ pane: stage, layer }] });
    }

    async _loadSvg(src, token) {
        let blob = src.file;
        if (!blob) {
            this._loading();
            try { blob = await this._fetch(src.url).then((r) => r.blob()); }
            catch (err) { if (err.name !== "AbortError") this._fail(token); return; }
            if (token !== this._token) return;
            this._view.replaceChildren();
        }
        // Re-typed, so a file with an empty or wrong type still renders as SVG
        // — as an image, where its scripts never run.
        this._showImage(this._objectUrl(new Blob([blob], { type: "image/svg+xml" })), token);
    }

    _fetch(url) {
        this._abort = new AbortController();
        return fetch(url, { signal: this._abort.signal }).then((r) => {
            if (!r.ok) throw new Error(`HTTP ${r.status}`);
            return r;
        });
    }

    /* -------------------------------------------------------------- media */

    _showMedia(kind, src, token) {
        const wrap = this._el("div", "media " + kind);
        const el = document.createElement(kind);
        el.controls = true;
        el.preload = "metadata";
        if (kind === "video") el.playsInline = true;
        el.addEventListener("loadedmetadata", () => this._done(token, true), { once: true });
        el.addEventListener("error", () => this._fail(token), { once: true });
        if (kind === "audio") {
            const icon = document.createElement("sac-icon");
            icon.setAttribute("name", ICONS.audio);
            icon.className = "big-icon";
            wrap.append(icon, this._el("div", "name", src.name || ""));
        }
        el.src = src.file ? this._objectUrl(src.file) : src.url;
        wrap.append(el);
        this._view.append(wrap);
    }

    /* --------------------------------------------------------------- text */

    /** Read at most `limit` bytes → { text, total, truncated }. */
    async _readText(src, limit) {
        let bytes, total, truncated;
        if (src.file) {
            total = src.file.size;
            truncated = total > limit;
            bytes = new Uint8Array(await (truncated ? src.file.slice(0, limit) : src.file).arrayBuffer());
        } else {
            const r = await this._fetch(src.url);
            const len = parseInt(r.headers.get("content-length"), 10);
            total = src.size != null ? src.size : (len >= 0 ? len : null);
            if (r.body && r.body.getReader) {
                // Stream, and stop at the cap — a 2 GB log is not downloaded
                // to show its first 256 KB.
                const reader = r.body.getReader();
                const chunks = [];
                let got = 0;
                while (got < limit) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    chunks.push(value);
                    got += value.length;
                }
                truncated = got > limit;
                if (!truncated) {
                    const { done } = got >= limit ? await reader.read() : { done: true };
                    truncated = !done;
                }
                if (truncated) reader.cancel().catch(() => {});
                bytes = new Uint8Array(Math.min(got, limit));
                let at = 0;
                for (const c of chunks) {
                    const take = Math.min(c.length, bytes.length - at);
                    bytes.set(c.subarray(0, take), at);
                    at += take;
                    if (at >= bytes.length) break;
                }
            } else {
                const all = new Uint8Array(await r.arrayBuffer());
                truncated = all.length > limit;
                bytes = truncated ? all.subarray(0, limit) : all;
            }
            if (total == null && !truncated) total = bytes.length;
        }
        let text = new TextDecoder("utf-8").decode(bytes);
        // A cut through a multi-byte character decodes to U+FFFD at the end.
        if (truncated) text = text.replace(/�+$/, "");
        return { text, total, shown: bytes.length, truncated };
    }

    async _loadText(kind, src, token) {
        this._loading();
        let res;
        try { res = await this._readText(src, this.textLimit); }
        catch (err) { if (err.name !== "AbortError") this._fail(token); return; }
        if (token !== this._token) return;
        this._view.replaceChildren();

        let text = res.text;
        if (kind === "json" && !res.truncated) {
            try { text = JSON.stringify(JSON.parse(text), null, 2); } catch (err) { /* shown as is */ }
        }

        const doc = this._el("div", "doc");
        const md = kind === "markdown" && window.marked && window.DOMPurify;
        if (md) doc.append(this._mdToolbar());

        const pre = this._el("pre", "code");
        pre.textContent = text;          // never innerHTML — untrusted content
        doc.append(pre);

        if (md) {
            const out = this._el("div", "md");
            // The whole file (or its first text-limit bytes) is parsed once;
            // the toggle only flips which of the two is shown.
            out.innerHTML = window.DOMPurify.sanitize(window.marked.parse(res.text), PURIFY);
            for (const a of out.querySelectorAll("a[href]")) {
                a.target = "_blank";
                a.rel = "noopener noreferrer";
            }
            doc.append(out);
            this._doc = doc;
            this._applyMdMode();
        }

        if (res.truncated) {
            doc.append(this._el("div", "note", null, () =>
                (res.total != null
                    ? t("quick-look.truncated", "Showing the first {shown} of {total}")
                    : t("quick-look.truncated-unknown", "Showing the first {shown}"))
                    .replace("{shown}", formatSize(res.shown))
                    .replace("{total}", formatSize(res.total))));
        }
        this._view.append(doc);
        this._done(token, true);
    }

    _mdToolbar() {
        const bar = this._el("div", "toolbar");
        bar.setAttribute("role", "group");
        const mk = (mode, key, fallback) => {
            const b = this._el("button", "seg", null, () => t(key, fallback));
            b.type = "button";
            b.dataset.mode = mode;
            b.addEventListener("click", () => { this._mdMode = mode; this._applyMdMode(); });
            return b;
        };
        bar.append(mk("rendered", "quick-look.rendered", "Rendered"),
                   mk("raw", "quick-look.raw", "Source"));
        this._bind(bar, () => t("quick-look.view", "View"), "aria-label");
        return bar;
    }

    _applyMdMode() {
        const doc = this._doc;
        if (!doc) return;
        const raw = this._mdMode === "raw";
        doc.querySelector(".code").hidden = !raw;
        doc.querySelector(".md").hidden = raw;
        for (const b of doc.querySelectorAll(".seg")) {
            b.setAttribute("aria-pressed", String(b.dataset.mode === this._mdMode));
        }
    }

    /* --------------------------------------------------------------- card */

    /** The info card. reason: null = a type we do not render, "failed" =
     *  a load or decode error. */
    _showCard(reason, token) {
        const src = this._source;
        const card = this._el("div", "card");
        card.setAttribute("part", "card");

        const icon = document.createElement("sac-icon");
        icon.setAttribute("name", ICONS[this._kind] || "attachment");
        icon.className = "big-icon";

        const meta = this._el("div", "meta", null, () =>
            [src.type || t("quick-look.unknown-type", "Unknown type"), formatSize(src.size)]
                .filter(Boolean).join(" · "));
        const msg = reason === "failed"
            ? this._el("div", "msg", null, () => t("quick-look.failed", "This file could not be previewed"))
            : this._el("div", "msg", null, () => t("quick-look.unsupported", "No preview available"));

        const actions = this._el("div", "actions");
        const slot = document.createElement("slot");
        slot.name = "actions";
        const dl = this._el("a", "btn", null, () => t("quick-look.download", "Download"));
        dl.href = src.file ? this._objectUrl(src.file) : src.url;
        dl.download = src.name || "";
        dl.target = "_blank";
        dl.rel = "noopener noreferrer";
        slot.append(dl);
        actions.append(slot);

        card.append(icon, this._el("div", "name", src.name || ""), meta, msg, actions);
        this._view.append(card);
        this._done(token, reason !== "failed");
    }

    /* ---------------------------------------------------------- utilities */

    /** createElement + class + optional static text, or a text function that
     *  is re-run on every language switch. */
    _el(tag, cls, text, fn) {
        const el = document.createElement(tag);
        if (cls) el.className = cls;
        if (text != null) el.textContent = text;
        if (fn) this._bind(el, fn);
        return el;
    }

    _bind(el, fn, attr) {
        this._labels.push([el, fn, attr]);
        if (attr) el.setAttribute(attr, fn());
        else el.textContent = fn();
    }

    _relabel() {
        if (!this._view) return;
        for (const [el, fn, attr] of this._labels) {
            if (attr) el.setAttribute(attr, fn());
            else el.textContent = fn();
        }
        this._prev.setAttribute("aria-label", t("quick-look.prev", "Previous"));
        this._next.setAttribute("aria-label", t("quick-look.next", "Next"));
        if (this._managesAria) this.setAttribute("aria-label", t("quick-look.label", "Preview"));
    }

    _nav(direction) {
        this.dispatchEvent(new CustomEvent("sac:nav", {
            detail: { direction }, bubbles: true, composed: true,
        }));
    }

    _onKeyDown(e) {
        if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
        if (e.key === "Escape") {
            e.preventDefault();
            this.dispatchEvent(new CustomEvent("sac:dismiss", { bubbles: true, composed: true }));
            return;
        }
        if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
        // Arrow keys belong to a focused media control (seek) or text field.
        const from = e.composedPath()[0];
        if (from instanceof HTMLMediaElement || from.isContentEditable ||
            /^(INPUT|TEXTAREA|SELECT)$/.test(from.tagName)) return;
        e.preventDefault();
        this._nav(e.key === "ArrowLeft" ? -1 : 1);
    }

    /* ------------------------------------------------------------- render */

    _render() {
        this._managesAria = !this.hasAttribute("aria-label");

        this.shadowRoot.innerHTML = `
            <style>
                :host {
                    --quick-look-min-height: 240px;

                    display: flex;
                    flex-direction: column;
                    position: relative;
                    box-sizing: border-box;
                    min-height: var(--quick-look-min-height);
                    overflow: hidden;
                    color: var(--text);
                    font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
                }
                :host(:focus) { outline: none; }
                :host(:focus-visible) {
                    outline: 2px solid var(--accent);
                    outline-offset: -2px;
                }
                [hidden] { display: none !important; }

                .view {
                    flex: 1;
                    min-height: 0;
                    display: flex;
                    flex-direction: column;
                }

                .empty {
                    flex: 1;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    padding: 1.5rem;
                    color: var(--text-dim);
                    font-size: 0.85rem;
                }

                /* Images: a pan/zoom pane (sac.setupPanZoom) whose layer
                   centres the picture, fitted, never upscaled. */
                .stage {
                    position: relative;
                    flex: 1;
                    min-height: 0;
                    overflow: hidden;
                    cursor: grab;
                }
                .stage.grabbing { cursor: grabbing; }
                .pz-layer {
                    position: absolute;
                    inset: 0;
                    transform-origin: 0 0;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    padding: 12px;
                    box-sizing: border-box;
                }
                .pz-layer img {
                    max-width: 100%;
                    max-height: 100%;
                    object-fit: contain;
                    user-select: none;
                    -webkit-user-select: none;
                    /* Transparency shows as the kit's checkerboard. */
                    background: repeating-conic-gradient(var(--checker-a) 0 25%, var(--checker-b) 0 50%) 0 0 / 16px 16px;
                    box-shadow: var(--shadow-1);
                }

                .media {
                    flex: 1;
                    min-height: 0;
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    justify-content: center;
                    gap: 0.75rem;
                    padding: 12px;
                    box-sizing: border-box;
                }
                .media video {
                    width: 100%;
                    height: 100%;
                    min-height: 0;
                    object-fit: contain;
                    border-radius: var(--radius-l);
                }
                .media audio { width: min(100%, 480px); }

                .big-icon { --icon-size: 40px; color: var(--text-dim); }
                .name {
                    font-weight: 600;
                    font-size: 0.95rem;
                    text-align: center;
                    overflow-wrap: anywhere;
                }

                /* Text, code, Markdown */
                .doc {
                    flex: 1;
                    min-height: 0;
                    display: flex;
                    flex-direction: column;
                }
                .code {
                    flex: 1;
                    min-height: 0;
                    margin: 0;
                    padding: 12px 16px;
                    overflow: auto;
                    font-family: var(--font-mono, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace);
                    font-size: 0.8rem;
                    line-height: 1.55;
                    tab-size: 4;
                    white-space: pre;
                    color: var(--text);
                    user-select: text;
                }
                .note {
                    padding: 6px 16px;
                    border-top: 1px solid var(--border);
                    color: var(--text-dim);
                    font-size: 0.75rem;
                }

                .toolbar {
                    display: flex;
                    justify-content: flex-end;
                    gap: 2px;
                    padding: 6px 8px;
                    border-bottom: 1px solid var(--border);
                }
                .seg {
                    height: 26px;
                    padding: 0 10px;
                    border: none;
                    border-radius: var(--radius-m);
                    background: none;
                    color: var(--text-muted);
                    font-family: inherit;
                    font-size: 0.78rem;
                    font-weight: 500;
                    cursor: pointer;
                }
                .seg:hover { background: var(--hover); color: var(--text); }
                /* Press: the strong wash at once; the pressed segment keeps its tint. */
                .seg:not([aria-pressed="true"]):active { background: var(--hover-strong); color: var(--text); transition-duration: 0s; }
                .seg[aria-pressed="true"] { background: var(--accent-tint); color: var(--accent-text); }
                .seg:focus-visible, .btn:focus-visible, .nav:focus-visible {
                    outline: 2px solid var(--accent);
                    outline-offset: 1px;
                }

                .md {
                    flex: 1;
                    min-height: 0;
                    overflow: auto;
                    padding: 12px 20px 20px;
                    font-size: 0.9rem;
                    line-height: 1.6;
                    overflow-wrap: break-word;
                    user-select: text;
                }
                .md h1, .md h2, .md h3, .md h4 {
                    font-family: 'Outfit', sans-serif;
                    font-weight: 700;
                    line-height: 1.25;
                    margin: 1.2em 0 0.5em;
                }
                .md h1 { font-size: 1.5rem; }
                .md h2 { font-size: 1.25rem; }
                .md h3 { font-size: 1.05rem; }
                .md > :first-child { margin-top: 0; }
                .md a { color: var(--accent-text); }
                .md code {
                    font-family: var(--font-mono, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace);
                    font-size: 0.85em;
                    background: var(--field);
                    padding: 0.1em 0.35em;
                    border-radius: var(--radius-s);
                }
                .md pre {
                    background: var(--field);
                    padding: 10px 12px;
                    border-radius: var(--radius-m);
                    overflow: auto;
                }
                .md pre code { background: none; padding: 0; }
                .md blockquote {
                    margin: 1em 0;
                    padding: 0.5em 1em;
                    background: var(--hover);
                    border-radius: var(--radius-m);
                    color: var(--text-muted);
                }
                .md img { max-width: 100%; }
                .md hr { border: none; border-top: 1px solid var(--border); }
                .md table { border-collapse: collapse; }
                .md th, .md td { border: 1px solid var(--border); padding: 4px 8px; }

                /* Info card */
                .card {
                    flex: 1;
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    justify-content: center;
                    gap: 0.4rem;
                    padding: 1.5rem;
                    text-align: center;
                }
                .meta { color: var(--text-muted); font-size: 0.8rem; overflow-wrap: anywhere; }
                .msg { color: var(--text-dim); font-size: 0.8rem; }
                .actions {
                    display: flex;
                    flex-wrap: wrap;
                    justify-content: center;
                    gap: 8px;
                    margin-top: 0.6rem;
                }
                .btn {
                    display: inline-flex;
                    align-items: center;
                    height: 32px;
                    padding: 0 14px;
                    border-radius: var(--radius-m);
                    background: var(--accent-fill);
                    color: var(--on-accent);
                    font-size: 0.8rem;
                    font-weight: 600;
                    text-decoration: none;
                    transition: background 150ms var(--ease-smooth), transform 0.2s var(--ease-smooth);
                }
                .btn:hover { background: var(--accent-strong); }
                /* Press: answers the moment it goes down. */
                .btn:active { transform: scale(0.97); transition-duration: 0.1s; }

                /* ‹ › — only with the nav attribute */
                .nav {
                    display: none;
                    position: absolute;
                    top: 50%;
                    transform: translateY(-50%);
                    z-index: 1;
                    width: 36px;
                    height: 36px;
                    align-items: center;
                    justify-content: center;
                    border: 1px solid var(--border);
                    border-radius: 50%;
                    background: var(--glass-strong);
                    color: var(--text);
                    box-shadow: var(--shadow-1);
                    cursor: pointer;
                    --icon-size: 18px;
                    opacity: 0.75;
                    transition: opacity 150ms var(--ease-smooth), background 150ms var(--ease-smooth),
                                transform 0.2s var(--ease-smooth);
                }
                .nav:hover { opacity: 1; background: linear-gradient(var(--hover), var(--hover)), var(--glass-strong); }
                /* Press: keeps the vertical centring, gives under the pointer. */
                .nav:active:not(:disabled) { opacity: 1; transform: translateY(-50%) scale(0.97); transition-duration: 0.1s; }
                .prev { left: 8px; }
                .next { right: 8px; }
                :host([nav=""]) .nav,
                :host([nav~="prev"]) .prev,
                :host([nav~="next"]) .next { display: flex; }

                @media (pointer: coarse) {
                    .nav { width: 44px; height: 44px; opacity: 1; }
                    .seg { height: 44px; padding: 0 14px; }
                    .btn { height: 44px; padding: 0 18px; }
                }
                @media (prefers-reduced-motion: reduce) {
                    .nav, .btn { transition: none; }
                }
            </style>
            <div class="view" part="view"></div>
            <button class="nav prev" type="button" part="nav"><sac-icon name="chevron-left"></sac-icon></button>
            <button class="nav next" type="button" part="nav"><sac-icon name="chevron-right"></sac-icon></button>
        `;

        this._view = this.shadowRoot.querySelector(".view");
        this._prev = this.shadowRoot.querySelector(".prev");
        this._next = this.shadowRoot.querySelector(".next");
        this._prev.addEventListener("click", () => this._nav(-1));
        this._next.addEventListener("click", () => this._nav(1));
        this.addEventListener("keydown", (e) => this._onKeyDown(e));
    }
}

SacQuickLook.TEXT_LIMIT = 256 * 1024;
SacQuickLook.classify = classify;

customElements.define("sac-quick-look", SacQuickLook);
})();
