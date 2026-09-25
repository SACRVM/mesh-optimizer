/**
 * <app-mesh-optimizer> — mesh cleanup and simplification as a SACRVM APPKIT app
 * (kind: "view").
 *
 * Load an OBJ, STL or glTF/GLB; inspect it in 3D; slim it down with adaptive QEM
 * or meshoptimizer; find and remove loose parts; fill holes and unify the
 * winding; edit single faces, edges and vertices; export OBJ (with vertex
 * colours) or glTF.
 *
 * Split of work:
 *   app.js     — this element: the markup (kit components only), the file
 *                open / save through context.files, visibility, lifecycle,
 *                remembered settings, credits.
 *   engine.js  — the tool itself, an ES module imported on mount: the
 *                half-edge mesh, the simplifiers, the Three.js viewport. Its
 *                DOM lookups are scoped to this element.
 *
 * Three.js 0.170 and meshoptimizer come from jsDelivr (+esm, so every addon
 * shares one Three instance) — a desktop page has no importmap to lean on.
 */
(function () {
    const BASE = sac.app.base();
    const CSS_ID = "app-mesh-optimizer-css";
    const ACCEPT = ".obj,.stl,.glb,.gltf";

    const svg = (inner) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;

    class AppMeshOptimizer extends sac.app.Element {
        build() {
            sac.app.styles(BASE + "app.css", CSS_ID);
            this.innerHTML = `
<sac-nav brand="MESH OPTIMIZER" brand-icon="mesh" brand-href="#/" host-nav="wide">
    <div slot="context" class="mo-theme"><sac-theme-toggle></sac-theme-toggle></div>
    <div slot="toolbar" class="toolbar">
        <button type="button" class="btn mo-open" title="Open OBJ, STL, GLB or glTF (Ctrl+O)">
            <sac-icon name="folder"></sac-icon> Open
        </button>
        <button type="button" class="btn primary" id="btn-export" data-overflow="never" title="Save as OBJ, with vertex colours (Ctrl+S)">
            <sac-icon name="download"></sac-icon> OBJ
        </button>
        <sac-menu class="mo-formats">
            <button slot="trigger" type="button" class="btn" title="More formats">More <sac-icon name="chevron-down"></sac-icon></button>
            <button type="button" data-action="gltf" id="btn-export-gltf"><sac-icon name="download"></sac-icon> Save as glTF</button>
        </sac-menu>
        <button type="button" class="nav-icon-btn" id="btn-undo" title="Undo (Ctrl+Z)" disabled>
            <sac-icon name="undo"></sac-icon>
        </button>
        <button type="button" class="nav-icon-btn" id="btn-redo" title="Redo (Ctrl+Y)" disabled>
            <sac-icon name="redo"></sac-icon>
        </button>
        <button type="button" class="nav-icon-btn" id="toolbar-scene" title="Scene graph">
            <sac-icon name="layers"></sac-icon>
        </button>
        <button type="button" class="nav-icon-btn" id="toolbar-transforms" title="Transforms">
            <sac-icon name="move"></sac-icon>
        </button>
        <button type="button" class="nav-icon-btn mo-fit" title="Frame the model">
            <sac-icon name="fit"></sac-icon>
        </button>
        <button type="button" class="nav-icon-btn mo-keys" title="Keyboard shortcuts (?)">
            <sac-icon name="keyboard"></sac-icon>
        </button>
        <button type="button" class="nav-icon-btn mo-credits" title="Credits &amp; licences">
            <sac-icon name="copyright"></sac-icon>
        </button>
        <button type="button" class="nav-icon-btn" id="toolbar-help" title="Help">
            <sac-icon name="info"></sac-icon>
        </button>
    </div>
</sac-nav>

<div class="main-layout mo-root">
    <sac-split class="mo-split" position="20%" min-start="250px" min-end="360px"
               aria-label="Resize the control panel">

        <div class="sidebar fill mo-panel" slot="start">
            <sac-section title="Tools">
                <sac-segmented-control id="tool-group-selectors" class="mo-modes" value="view">
                    <button data-value="view" title="View mode (V)">${svg('<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>')}</button>
                    <button data-value="face" title="Face mode (1)">${svg('<path d="M3 20h18L12 4z"/>')}</button>
                    <button data-value="edge" title="Edge mode (2)">${svg('<path d="M5 12h14"/>')}</button>
                    <button data-value="vertex" title="Vertex mode (3)">${svg('<rect x="7" y="7" width="10" height="10"/>')}</button>
                    <button data-value="part" title="Part mode (4) — pick a whole connected mesh group">${svg('<rect x="3" y="3" width="8" height="8" rx="1"/><rect x="13" y="13" width="8" height="8" rx="1"/>')}</button>
                </sac-segmented-control>
            </sac-section>

            <sac-section title="View settings" collapsible collapsed data-fold="view">
                <sac-toggle id="view-wire" data-keep="wire" label="Wireframe" checked></sac-toggle>
                <sac-toggle id="view-quality" data-keep="quality" label="Quality overlay"></sac-toggle>
                <sac-toggle id="view-shading" data-keep="shading" label="High quality shading" checked></sac-toggle>
                <sac-toggle id="view-flat" data-keep="flat" label="Flat shading" checked></sac-toggle>
                <sac-toggle id="view-vertex-colors" data-keep="vertexColors" label="Vertex colors" checked></sac-toggle>
                <sac-toggle id="view-ingame" data-keep="singleSided" label="Single-sided view"></sac-toggle>
                <sac-slider id="light-angle-slider" data-keep="lightAngle" label="Light angle" min="0" max="360" step="5" value="45" suffix="°"></sac-slider>
            </sac-section>

            <sac-section title="Loose parts" collapsible data-fold="parts">
                <button type="button" class="btn" id="btn-analyse-parts">Analyse connected parts</button>
                <div id="parts-summary" class="mo-parts-summary">No mesh loaded.</div>
                <div id="parts-actions" class="mo-parts-actions" style="display:none;">
                    <div class="mo-parts-tiny">
                        <span>Delete under</span>
                        <sac-stepper id="parts-min-faces" value="10" min="1" max="999" step="1" label="Minimum faces"></sac-stepper>
                        <span>faces</span>
                        <button type="button" class="btn" id="btn-delete-tiny">Go</button>
                    </div>
                    <button type="button" class="btn" id="btn-keep-largest">Keep largest only</button>
                    <button type="button" class="btn" id="btn-split-parts">Split to objects</button>
                </div>
            </sac-section>

            <sac-section title="Combine">
                <button type="button" class="btn" id="btn-merge-all" title="Fuse all objects into one mesh">Bake / merge all objects</button>
            </sac-section>

            <sac-section title="Optimization">
                <div>
                    <label>Engine</label>
                    <sac-segmented-control id="simplify-engine" data-keep="engine" value="density">
                        <button data-value="density">Density (QEM)</button>
                        <button data-value="quality">Quality (meshopt)</button>
                    </sac-segmented-control>
                </div>
                <sac-slider id="qem-reduction-slider" data-keep="reduction" label="Reduction" min="10" max="95" step="5" value="50" suffix="%"></sac-slider>
                <div id="density-balance-wrap">
                    <sac-slider id="qem-density-slider" data-keep="densityBalance" label="Density balance" min="0" max="100" step="5" value="60" suffix="%"></sac-slider>
                </div>
                <button type="button" class="btn primary" id="btn-qem-mesh">Slim mesh</button>
            </sac-section>

            <sac-section title="Repair" collapsible data-fold="repair">
                <button type="button" class="btn" id="btn-fill-holes">Fill holes</button>
                <button type="button" class="btn" id="btn-recalc-normals"
                        title="Unify face winding so all normals point outward">Recalc normals</button>
            </sac-section>
        </div>

        <div class="viewport mo-viewport" id="canvas-container" slot="end">
            <sac-hud id="selection-info" position="top-left"></sac-hud>
            <sac-hud id="mesh-stats" position="bottom-left">Faces: 0 · Verts: 0 · Open: 0</sac-hud>
            <div class="mo-busy" hidden><sac-spinner label="Working" style="--spinner-size: 28px"></sac-spinner><span class="mo-busy-label"></span></div>
            <div class="app-drop mo-empty">
                <sac-drop-zone class="on-viewport" accept=".obj,.stl,.glb,.gltf" label="Drop a mesh" hint="or click to open"
                               touch-label="Open a mesh" touch-hint=""></sac-drop-zone>
            </div>
        </div>

    </sac-split>
</div>

<sac-window id="window-scene" title="Scene Graph" width="350px" height="400px"
            left="calc(100vw - 370px)" top="100px" controls="close">
    <div class="mo-graph-toolbar">
        <span id="graph-sel-info">Nothing selected</span>
        <button type="button" class="btn" id="btn-deselect-all" title="Clear the selection (Esc)" disabled>Deselect</button>
    </div>
    <sac-scene-graph id="scene-graph" class="mo-graph"></sac-scene-graph>
</sac-window>

<sac-window id="window-transforms" title="Transforms" width="320px" height="520px"
            left="calc(50vw - 150px)" top="100px" controls="close">
    <div class="mo-transforms">
        <label>Live alignment</label>
        <div class="mo-tgrid">
            <span>Rot X</span><sac-stepper id="rot-x" value="0" min="0" max="345" step="15" unit="°" label="Rotation X"></sac-stepper>
            <span>Rot Y</span><sac-stepper id="rot-y" value="0" min="0" max="345" step="15" unit="°" label="Rotation Y"></sac-stepper>
            <span>Rot Z</span><sac-stepper id="rot-z" value="0" min="0" max="345" step="15" unit="°" label="Rotation Z"></sac-stepper>
            <span>Pos X</span><input type="number" id="pos-x" value="0" step="0.01" aria-label="Position X">
            <span>Pos Y</span><input type="number" id="pos-y" value="0" step="0.01" aria-label="Position Y">
            <span>Pos Z</span><input type="number" id="pos-z" value="0" step="0.01" aria-label="Position Z">
        </div>
        <label>Uniform scale</label>
        <div class="mo-scale">
            <input type="number" id="scale-uniform" value="1" step="0.1" min="0.0001" aria-label="Uniform scale">
            <button type="button" class="btn" data-scale-mul="0.5">÷2</button>
            <button type="button" class="btn" data-scale-mul="2">×2</button>
            <button type="button" class="btn" data-scale-mul="10">×10</button>
        </div>
        <div id="scale-readout" class="mo-readout"></div>
        <button type="button" class="btn" id="btn-reset-transforms">Reset transforms</button>
    </div>
</sac-window>

<sac-window id="window-help" title="Mesh Optimizer Help" width="520px" height="520px"
            left="calc(50vw - 260px)" top="10vh" controls="close">
    <div class="mo-help">
        <h3>How to use it</h3>
        <p><b>Open</b> an OBJ, STL, GLB or glTF (or drop it on the viewport), inspect it, then slim
           and repair it and save it as <b>OBJ</b> (vertex colours included) or, under <b>More</b>,
           as <b>glTF</b>. Every save asks where to put the file. Textured GLBs are baked to vertex
           colours on load. <b>Ctrl+O</b> opens, <b>Ctrl+S</b> saves the OBJ.</p>
        <h3>Optimization</h3>
        <p><b>Density (QEM)</b> is adaptive QEM: it collapses nearby points and evens out
           over-dense areas. <b>Density balance</b> sets how hard it attacks over-dense clusters
           (e.g. round eyes): low keeps the form, high gives an even mesh.
           <b>Quality (meshopt)</b> is meshoptimizer (WASM): the highest quality, it keeps form and
           sharp edges best. <b>Reduction</b> is the share of faces to remove.</p>
        <p>A model often arrives as several objects: <b>Bake / merge all objects</b> fuses them
           into one mesh (coincident seams welded) — do that before simplifying.</p>
        <h3>Loose parts</h3>
        <p>A single object often holds several physically separate lumps of geometry (a body
           plus stray shells). <b>Analyse connected parts</b> finds them; then delete every part
           under N faces, keep only the largest, or split each part into its own object.</p>
        <p>Expand an object in the scene graph to list its parts — hover a row to light it up,
           the eye hides it, the bin deletes it. Or press <b>4</b> for part mode and click a part in
           the viewport: <b>Del</b> deletes, <b>F</b> frames it, <b>Ctrl+click</b> adds a single
           part, <b>Shift+click</b> selects a range, <b>Esc</b> deselects.</p>
        <h3>Transforms</h3>
        <p>Rotate, move and uniformly scale the active object before processing — the results
           are best on a correctly oriented, sensibly sized model. Scale works from the object's
           origin, equal in every direction; ÷2 / ×2 / ×10 fix the usual "imported 100× too
           big" case. Rotation goes in 15° steps; position and scale take any number.</p>
        <h3>Editing</h3>
        <p><b>1</b> face, <b>2</b> edge, <b>3</b> vertex mode: click an element for its menu
           (collapse, delete, dissolve); drag vertices to move them. <b>V</b> returns to view mode.
           <b>Single-sided view</b> renders with backface culling, so wrongly wound faces show as
           holes — fix them with <b>Recalc normals</b>.</p>
        <h3>Navigation</h3>
        <p>Drag to orbit, right-drag to pan. The wheel zooms towards the cursor, so you can keep
           diving into a detail instead of stalling at the orbit centre. <b>Frame the model</b>
           (toolbar) brings everything back into view. <b>?</b> lists every shortcut.</p>
        <p>On a touch screen the viewer and every panel work; face, edge, vertex and part editing
           need a mouse and are hidden there.</p>
        <h3>Unsaved work</h3>
        <p>Edits count as unsaved until you save. Opening another file asks first, and so does
           leaving the page.</p>
    </div>
</sac-window>
`;
        }

        onMount(context) {
            this._ctx = context;
            const nav = this.querySelector("sac-nav");
            if (nav) nav.host = context.host;

            const viewport = this.querySelector("#canvas-container");
            this._viewport = viewport;
            this.querySelector(".mo-open").addEventListener("click", () => this._open());
            this.querySelector(".mo-credits").addEventListener("click", () => this._about());
            this.querySelector(".mo-fit").addEventListener("click", () => this._engine?.frame());
            this.querySelector(".mo-keys").addEventListener("click", () => this._showKeys());
            // The host brings its own theme switch; standalone the app offers one.
            this.querySelector(".mo-theme").hidden = !!context.host;
            this._busyEl = this.querySelector(".mo-busy");

            // Face / edge / vertex / part picking is mouse-only: on a touch screen the
            // buttons are hidden (CSS) and an active edit mode falls back to view.
            this._coarse = matchMedia("(pointer: coarse)");
            this._onCoarse = () => { if (this._coarse.matches && this._engine && this._engine.mode() !== "view") this._engine.setMode("view"); };
            this._coarse.addEventListener("change", this._onCoarse);
            this._wireDropZone((file) => this._openFile(file));

            // Whole-viewport drop, for when a mesh is already loaded. The drop
            // zone handles its own drops — ignore those here.
            const fromZone = (e) => e.composedPath().some((n) => n.tagName === "SAC-DROP-ZONE");
            ["dragenter", "dragover"].forEach((ev) =>
                viewport.addEventListener(ev, (e) => { if (fromZone(e)) return; e.preventDefault(); viewport.classList.add("dragover"); }));
            ["dragleave", "drop"].forEach((ev) =>
                viewport.addEventListener(ev, (e) => { viewport.classList.remove("dragover"); if (fromZone(e)) return; e.preventDefault(); }));
            viewport.addEventListener("drop", (e) => {
                if (fromZone(e)) return;
                const file = e.dataTransfer?.files?.[0];
                if (file) this._openFile(file);
            });

            this._io = new IntersectionObserver((entries) => {
                this._setVisible(entries[entries.length - 1].isIntersecting);
            });
            this._io.observe(this);

            this._restoreFolds();

            this._ready = import(BASE + "engine.js").then((engine) => {
                this._engine = engine.start(this, {
                    isVisible: () => !!this._visible,
                    saveFile: (blob, name, accept) => this._save(blob, name, accept),
                    notify: (message, kind = "info") => sac.toast?.(message, { kind }),
                    busy: (label) => this._busy(label),
                    setDirty: (on) => this._setDirty(on),
                });
                this._onCoarse();
                this._syncKeys();
                // The engine attached its listeners in start() — only now can a
                // replayed setting reach it.
                this._restoreSettings();
                return this._engine;
            }).catch((err) => {
                console.error("[mesh-optimizer] the engine did not load:", err);
                sac.toast?.("The 3D engine did not load — check the connection.", { kind: "error", duration: 0 });
            });
        }

        onUnmount() {
            this._setVisible(false);
            this._coarse?.removeEventListener("change", this._onCoarse);
            this._setDirty(false);
            this._io?.disconnect();
            this._io = null;
            clearTimeout(this._keepTimer);
            this._engine?.dispose();
            this._engine = null;
        }

        /** Keys only while on screen — a hidden view must not answer another app's Ctrl+S. */
        _setVisible(on) {
            if (on === !!this._visible) return;
            this._visible = on;
            this._syncKeys();
        }

        /** Register every key (file, tool, "?") while visible AND the engine is up; release otherwise. */
        _syncKeys() {
            const want = !!this._visible && !!this._engine;
            if (want === !!this._offKeys) return;
            if (!want) { this._offKeys(); this._offKeys = null; return; }
            const offs = [this._registerFileKeys(() => this.querySelector("#btn-export").click())];
            for (const k of this._engine.keyBindings()) {
                offs.push(sac.hotkeys.register(k.combo, () => k.run(), {
                    group: k.group, description: k.description, skipInInput: !!k.skipInInput,
                }));
            }
            if (sac.shortcuts) {
                offs.push(sac.shortcuts.bind("shift+?"));
                offs.push(sac.shortcuts.add([
                    { group: "View", keys: ["Drag"], description: "Orbit" },
                    { group: "View", keys: ["Right-drag"], description: "Pan" },
                    { group: "View", keys: ["Wheel"], description: "Zoom towards the cursor" },
                    { group: "Edit", keys: ["Ctrl", "click"], description: "Add a part to the selection" },
                    { group: "Edit", keys: ["Shift", "click"], description: "Select a range of parts" },
                ]));
            }
            this._offKeys = () => offs.forEach((off) => off && off());
        }

        _showKeys() {
            if (sac.shortcuts) sac.shortcuts.show({ title: "Mesh Optimizer shortcuts" });
        }

        /** Busy overlay: shown and painted (two frames) before the blocking work starts. */
        async _busy(label) {
            this._busyCount = (this._busyCount || 0) + 1;
            this._busyEl.querySelector(".mo-busy-label").textContent = label;
            this._busyEl.hidden = false;
            await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
            return () => {
                this._busyCount = Math.max(0, this._busyCount - 1);
                if (!this._busyCount) this._busyEl.hidden = true;
            };
        }

        _setDirty(on) {
            this._dirty = !!on;
            this._ctx?.setDirty?.(this._dirty);
        }

        /** Unsaved edits? Ask before throwing them away. → true to go on. */
        async _discardOk() {
            if (!this._dirty) return true;
            const answer = await sac.dialog.confirm({
                title: "Discard unsaved changes?",
                message: "The edited mesh has not been saved.",
                buttons: [
                    { action: "cancel", label: "Cancel", kind: "default" },
                    { action: "discard", label: "Discard", kind: "destructive" },
                ],
            });
            return answer === "discard";
        }

        async _open() {
            const picked = await this._ctx.files.open({ accept: ACCEPT, title: "Open mesh" });
            if (picked) this._openFile(picked.file);
        }

        async _openFile(file) {
            const ext = (file.name.split(".").pop() || "").toLowerCase();
            if (!["obj", "stl", "glb", "gltf"].includes(ext)) {
                sac.toast?.("Open an OBJ, STL, GLB or glTF file.", { kind: "warn" });
                return;
            }
            const engine = await this._ready;
            if (!engine) return;
            if (!(await this._discardOk())) return;
            this._viewport.classList.add("has-mesh");
            await engine.openFile(file);
        }

        async _save(blob, name, accept) {
            try {
                const saved = await this._ctx.files.save(blob, { name, accept, title: "Save mesh" });
                if (saved) {
                    this._setDirty(false);
                    sac.toast?.(`Saved ${saved.name}`, { kind: "success" });
                }
                return saved;
            } catch (err) {
                console.error("[mesh-optimizer] save failed:", err);
                sac.toast?.("Saving failed.", { kind: "error" });
                return null;
            }
        }

        /* Folded sidebar sections (data-fold="key") are remembered in
         * context.fs ("sections"), next to the settings but outside the
         * shared settings snippet. An older host kit ignores `collapsible`
         * and `collapsed`, so the sections just stay open there. */
        async _restoreFolds() {
            const sections = [...this.querySelectorAll("sac-section[data-fold]")];
            let saved = null;
            try { saved = await this._ctx.fs?.read("sections", null); } catch { saved = null; }
            if (saved && typeof saved === "object") {
                for (const el of sections) {
                    const key = el.dataset.fold;
                    if (key in saved) el.toggleAttribute("collapsed", !!saved[key]);
                }
            }
            for (const el of sections) {
                el.addEventListener("sac:toggle", () => {
                    const out = {};
                    for (const s of sections) out[s.dataset.fold] = s.hasAttribute("collapsed");
                    Promise.resolve(this._ctx.fs?.write("sections", out)).catch(() => {});
                });
            }
        }

        /* ------------------------------------------------ the app shell ---- *
         * Shared by the four DREAM-TOOLS-born apps (vectorizer, background-
         * remover, mesh-optimizer, svg-to-3d) — keep the copies in step.
         *   · settings: every control with data-keep is remembered in
         *     context.fs ("settings") and restored by replaying its event;
         *   · credits: sac.about from the manifest (notices included);
         *   · the empty state is a sac-drop-zone whose click goes through
         *     context.files (the host's file space), not the device picker.
         * ------------------------------------------------------------------ */

        _keepValue(el) {
            return el.tagName === "SAC-TOGGLE" ? el.checked : el.value;
        }

        async _restoreSettings() {
            let saved = null;
            try { saved = await this._ctx.fs?.read("settings", null); } catch { saved = null; }
            if (saved && typeof saved === "object" && this._migrateSettings) saved = this._migrateSettings(saved);
            if (saved && typeof saved === "object") {
                for (const el of this.querySelectorAll("[data-keep]")) {
                    const key = el.dataset.keep;
                    if (!(key in saved)) continue;
                    const v = saved[key];
                    const fire = (type, value) => el.dispatchEvent(new CustomEvent(type, { detail: { value }, bubbles: true }));
                    if (el.tagName === "SAC-TOGGLE") { el.checked = !!v; fire("sac:change", !!v); }
                    else if (el.tagName === "INPUT") { el.value = v; el.dispatchEvent(new Event("input", { bubbles: true })); }
                    else if (el.tagName === "SAC-STEPPER") { el.value = Number(v); fire("sac:change", Number(v)); }
                    else if (el.tagName === "SAC-SLIDER") { el.value = String(v); fire("sac:input", String(v)); fire("sac:change", String(v)); }
                    else { el.value = String(v); fire("sac:change", String(v)); }
                }
            }
            // Watch only after restoring, so the replay above does not write back.
            const save = () => {
                clearTimeout(this._keepTimer);
                this._keepTimer = setTimeout(() => {
                    const out = {};
                    for (const el of this.querySelectorAll("[data-keep]")) out[el.dataset.keep] = this._keepValue(el);
                    Promise.resolve(this._ctx.fs?.write("settings", out)).catch(() => {});
                }, 400);
            };
            for (const el of this.querySelectorAll("[data-keep]")) {
                for (const type of ["sac:change", "sac:input", "input"]) el.addEventListener(type, save);
            }
        }

        async _about() {
            if (!this._manifest) {
                this._manifest = this._ctx.manifest
                    || await fetch(BASE + "app.json").then((r) => r.json()).catch(() => null);
            }
            if (sac.about) sac.about.open(this._manifest || { name: this.tagName.toLowerCase() });
        }

        _wireDropZone(onFile) {
            const wrap = this.querySelector(".app-drop");
            const zone = wrap.querySelector("sac-drop-zone");
            // Click / Enter / Space open through context.files, like the Open button.
            const intercept = (e) => {
                if (e.type === "keydown" && e.key !== "Enter" && e.key !== " ") return;
                if (!e.composedPath().includes(zone)) return;
                e.preventDefault();
                e.stopPropagation();
                this._open();
            };
            wrap.addEventListener("click", intercept, true);
            wrap.addEventListener("keydown", intercept, true);
            zone.addEventListener("sac:files", (e) => { const f = e.detail.files[0]; if (f) onFile(f); });
            zone.addEventListener("sac:rejected", () => sac.toast?.("That file type does not open here.", { kind: "warn" }));
        }

        /** Ctrl+O / Ctrl+S — only while the app is on screen. */
        _registerFileKeys(saveFn) {
            const offs = [
                sac.hotkeys.register("mod+o", () => this._open(), { group: "File", description: "Open" }),
                sac.hotkeys.register("mod+s", () => saveFn(), { group: "File", description: "Save / export" }),
            ];
            return () => offs.forEach((off) => off());
        }
    }

    sac.app.define("app-mesh-optimizer", AppMeshOptimizer);
})();
