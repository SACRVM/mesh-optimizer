# Mesh Optimizer

Clean up and slim down 3D meshes in the browser — no upload, no install, no
build step. Built on [SACRVM APPKIT](https://github.com/SACRVM/sacrvm-appkit);
runs standalone or as an app on a SACRVM desktop.

```bash
npx serve .
```

## What it does

- **In:** OBJ, STL, GLB or glTF — open or drop it. Textured GLBs are baked to
  vertex colours on load. **Out:** OBJ (with vertex colours, the extended
  `v x y z r g b` form) or glTF.
- **Simplify:** Density (adaptive QEM — evens out over-dense areas) or
  Quality (meshoptimizer, WASM — keeps form and sharp edges), with a
  reduction slider.
- **Loose parts:** find physically separate lumps inside one object; hide,
  delete, frame or split them; delete everything under N faces or keep only
  the largest.
- **Repair:** fill holes, recalculate normals (unify winding outward), bake /
  merge all objects into one mesh.
- **Edit:** face, edge, vertex and part modes — collapse, delete, dissolve,
  drag vertices; undo / redo.
- **Inspect:** wireframe, quality overlay, flat or smooth shading, vertex
  colours, a single-sided view that shows wrongly wound faces as holes, a
  movable key light; live face / vertex / open-edge / sliver counts.
- **Transforms:** rotate, move and uniformly scale objects before processing.
- **Remembers** your view and optimization settings; Ctrl+O opens, Ctrl+S saves
  the OBJ. Every save asks where the file goes; unsaved edits are guarded
  before another file replaces them.
- **Keyboard:** V / 1–4 switch modes, Del deletes, Esc deselects, F frames a
  part, Ctrl+Z / Ctrl+Y undo and redo — `?` shows them all.
- **Touch:** viewing and every panel work on a phone; face / edge / vertex /
  part editing needs a mouse and is hidden there.

## Install on a desktop

Paste `github.com/SACRVM/mesh-optimizer` into a SACRVM desktop's install
dialog, or pick it from the App Store tab there.

## Credits

[three.js](https://threejs.org) 0.170.0 (MIT) and
[meshoptimizer](https://github.com/zeux/meshoptimizer) 1.1.1 (MIT), both
loaded from jsDelivr.

## License

MIT — see `LICENSE`.
