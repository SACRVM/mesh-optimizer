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
 *                open / save through context.files, visibility, lifecycle.
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
    <div slot="toolbar" class="toolbar">
        <button type="button" class="btn primary mo-open" title="Open OBJ, STL, GLB or glTF">
            <sac-icon name="upload"></sac-icon> Open
        </button>
        <button type="button" class="btn" id="btn-export" title="Save as OBJ (with vertex colours)">
            <sac-icon name="download"></sac-icon> OBJ
        </button>
        <button type="button" class="btn" id="btn-export-gltf" title="Save as glTF">
            <sac-icon name="download"></sac-icon> glTF
        </button>
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

            <sac-section title="View">
                <sac-toggle id="view-wire" label="Wireframe" checked></sac-toggle>
                <sac-toggle id="view-quality" label="Quality overlay"></sac-toggle>
                <sac-toggle id="view-shading" label="High quality shading" checked></sac-toggle>
                <sac-toggle id="view-flat" label="Flat shading" checked></sac-toggle>
                <sac-toggle id="view-vertex-colors" label="Vertex colors" checked></sac-toggle>
                <sac-toggle id="view-ingame" label="Single-sided view (backface culling)"></sac-toggle>
                <sac-slider id="light-angle-slider" label="Light angle" min="0" max="360" step="5" value="45" suffix="°"></sac-slider>
            </sac-section>

            <sac-section title="Loose parts">
                <button type="button" class="btn" id="btn-analyse-parts">Analyse connected parts</button>
                <div id="parts-summary" class="mo-parts-summary">No mesh loaded.</div>
                <div id="parts-actions" class="mo-parts-actions" style="display:none;">
                    <div class="mo-parts-tiny">
                        <span>Delete parts under</span>
                        <input type="number" id="parts-min-faces" value="10" min="1" step="1">
                        <span>faces</span>
                        <button type="button" class="btn" id="btn-delete-tiny">Go</button>
                    </div>
                    <button type="button" class="btn" id="btn-keep-largest">Keep largest only</button>
                    <button type="button" class="btn" id="btn-split-parts">Split to objects</button>
                </div>
                <p class="mo-note">Finds mesh groups that are welded into one object but not actually
                   connected. Expand an object in the scene graph to list them, or use part mode (4)
                   and click one in the viewport. Del removes the selection, Ctrl+click adds a single
                   part, Shift+click picks a range, Esc deselects.</p>
            </sac-section>

            <sac-section title="Combine">
                <button type="button" class="btn" id="btn-merge-all">Bake / merge all objects</button>
                <p class="mo-note">Fuses all parts into one mesh (coincident seams welded). Bake before simplifying.</p>
            </sac-section>

            <sac-section title="Optimization">
                <div>
                    <label>Engine</label>
                    <sac-segmented-control id="simplify-engine" value="density">
                        <button data-value="density">Density (QEM)</button>
                        <button data-value="quality">Quality (meshopt)</button>
                    </sac-segmented-control>
                </div>
                <p id="engine-hint" class="mo-note"></p>
                <sac-slider id="qem-reduction-slider" label="Reduction" min="10" max="95" step="5" value="50" suffix="%"></sac-slider>
                <div id="density-balance-wrap">
                    <sac-slider id="qem-density-slider" label="Density balance (keep form → even)" min="0" max="100" step="5" value="60" suffix="%"></sac-slider>
                    <p class="mo-note">Higher = attack over-dense clusters (e.g. round eyes) harder for an even mesh.</p>
                </div>
                <button type="button" class="btn primary" id="btn-qem-mesh">Slim mesh</button>
            </sac-section>

            <sac-section title="Repair">
                <button type="button" class="btn" id="btn-fill-holes">Fill holes</button>
                <button type="button" class="btn" id="btn-recalc-normals"
                        title="Unify face winding so all normals point outward">Recalc normals</button>
            </sac-section>
        </div>

        <div class="viewport mo-viewport" id="canvas-container" slot="end">
            <sac-hud id="selection-info" position="top-left"></sac-hud>
            <sac-hud id="mesh-stats" position="bottom-left">Faces: 0 · Verts: 0 · Open: 0</sac-hud>
            <div class="empty-state mo-empty">
                <sac-icon name="mesh"></sac-icon>
                <b>Drop a mesh here or click Open</b>
                <p>OBJ, STL, GLB or glTF — everything stays in your browser.</p>
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

<sac-window id="window-transforms" title="Transforms" width="300px" height="380px"
            left="calc(50vw - 150px)" top="100px" controls="close">
    <div class="mo-transforms">
        <label>Live alignment</label>
        <div class="mo-tgrid">
            <div><span>Rot X</span><input type="number" id="rot-x" value="0" step="90"></div>
            <div><span>Rot Y</span><input type="number" id="rot-y" value="0" step="90"></div>
            <div><span>Rot Z</span><input type="number" id="rot-z" value="0" step="90"></div>
            <div><span>Pos X</span><input type="number" id="pos-x" value="0" step="0.1"></div>
            <div><span>Pos Y</span><input type="number" id="pos-y" value="0" step="0.1"></div>
            <div><span>Pos Z</span><input type="number" id="pos-z" value="0" step="0.1"></div>
        </div>
        <label>Uniform scale</label>
        <div class="mo-scale">
            <input type="number" id="scale-uniform" value="1" step="0.1" min="0.0001"
                   title="Uniform scale from the object's origin — equal in every direction">
            <button type="button" class="btn" data-scale-mul="0.5">÷2</button>
            <button type="button" class="btn" data-scale-mul="2">×2</button>
            <button type="button" class="btn" data-scale-mul="10">×10</button>
        </div>
        <div id="scale-readout" class="mo-note mo-center"></div>
        <button type="button" class="btn" id="btn-reset-transforms">Reset transforms</button>
        <p class="mo-note mo-center">Adjust transforms before processing for best results.</p>
    </div>
</sac-window>

<sac-window id="window-help" title="Mesh Optimizer Help" width="500px" height="460px"
            left="calc(50vw - 250px)" top="12vh" controls="close">
    <div class="mo-help">
        <h3>How to use it</h3>
        <p><b>Open</b> an OBJ, STL, GLB or glTF (or drop it on the viewport), inspect it, then slim
           and repair it and save it as <b>OBJ</b> (vertex colours included) or <b>glTF</b>.
           Textured GLBs are baked to vertex colours on load.</p>
        <h3>Optimization</h3>
        <p><b>Density (QEM)</b> collapses nearby points and evens out over-dense areas;
           <b>Quality (meshopt)</b> keeps form and sharp edges best. Bake / merge first when a
           model arrives as several objects.</p>
        <h3>Loose parts</h3>
        <p>A single mesh object often holds several physically separate lumps of geometry
           (a body plus stray shells). Expand an object in the scene graph to list them — hover
           a row to light it up, use the eye to hide it, the bin to delete it. Or press
           <b>4</b> for part mode and click a part in the viewport: <b>Del</b> deletes,
           <b>F</b> frames it, <b>Ctrl+click</b> adds a part, <b>Shift+click</b> selects a range,
           <b>Esc</b> deselects.</p>
        <h3>Editing</h3>
        <p><b>1</b> face, <b>2</b> edge, <b>3</b> vertex mode: click an element for its menu
           (collapse, delete, dissolve); drag vertices to move them. <b>V</b> returns to view mode.
           <b>Single-sided view</b> shows wrongly wound faces as holes — fix them with
           <b>Recalc normals</b>.</p>
        <h3>Navigation</h3>
        <p>The wheel zooms towards the cursor, so you can keep diving into a detail instead of
           stalling at the orbit centre.</p>
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
            ["dragenter", "dragover"].forEach((ev) =>
                viewport.addEventListener(ev, (e) => { e.preventDefault(); viewport.classList.add("dragover"); }));
            ["dragleave", "drop"].forEach((ev) =>
                viewport.addEventListener(ev, (e) => { e.preventDefault(); viewport.classList.remove("dragover"); }));
            viewport.addEventListener("drop", (e) => {
                const file = e.dataTransfer?.files?.[0];
                if (file) this._openFile(file);
            });

            this._io = new IntersectionObserver((entries) => {
                this._visible = entries[entries.length - 1].isIntersecting;
            });
            this._io.observe(this);

            this._ready = import(BASE + "engine.js").then((engine) => {
                this._engine = engine.start(this, {
                    isVisible: () => !!this._visible,
                    saveFile: (blob, name, accept) => this._save(blob, name, accept),
                });
                return this._engine;
            }).catch((err) => {
                console.error("[mesh-optimizer] the engine did not load:", err);
                sac.toast?.("The 3D engine did not load — check the connection.", { kind: "error", duration: 0 });
            });
        }

        onUnmount() {
            this._io?.disconnect();
            this._io = null;
            this._engine?.dispose();
            this._engine = null;
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
            this._viewport.classList.add("has-mesh");
            engine.openFile(file);
        }

        async _save(blob, name, accept) {
            try {
                const saved = await this._ctx.files.save(blob, { name, accept, title: "Save mesh" });
                if (saved) sac.toast?.(`Saved ${saved.name}`, { kind: "success" });
                return saved;
            } catch (err) {
                console.error("[mesh-optimizer] save failed:", err);
                sac.toast?.("Saving failed.", { kind: "error" });
                return null;
            }
        }
    }

    sac.app.define("app-mesh-optimizer", AppMeshOptimizer);
})();
