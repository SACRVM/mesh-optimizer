/**
 * Mesh Optimizer — the engine: an ES module that app.js imports on mount.
 *
 * Half-edge mesh editing, QEM / meshoptimizer simplification, loose-part analysis and
 * repair, rendered with Three.js. Every DOM lookup is scoped to the app element (ROOT),
 * so the tool can share a desktop page with other apps.
 */

// Set by start(): the app element, the on-screen test, and the kit-backed file saver.
let ROOT = document;
let IS_VISIBLE = () => true;
let saveFile = async () => null;
const $id = (id) => ROOT.querySelector('#' + CSS.escape(id));

/**
 * QUADRIC ERROR METRICS (QEM) - Surface Preservation
 */
class Quadric {
    constructor() {
        this.m = new Float32Array(10); // Symmetric 4x4 matrix: a2, ab, ac, ad, b2, bc, bd, c2, cd, d2
    }

    static fromPlane(a, b, c, d) {
        const q = new Quadric();
        q.m[0] = a * a; q.m[1] = a * b; q.m[2] = a * c; q.m[3] = a * d;
        q.m[4] = b * b; q.m[5] = b * c; q.m[6] = b * d;
        q.m[7] = c * c; q.m[8] = c * d;
        q.m[9] = d * d;
        return q;
    }

    add(q) {
        for (let i = 0; i < 10; i++) this.m[i] += q.m[i];
        return this;
    }

    clone() {
        const q = new Quadric();
        q.m.set(this.m);
        return q;
    }

    getError(v) {
        const x = v.x, y = v.y, z = v.z;
        // vT * Q * v = 
        // x2*m0 + 2xy*m1 + 2xz*m2 + 2x*m3 + 
        // y2*m4 + 2yz*m5 + 2y*m6 + 
        // z2*m7 + 2z*m8 + m9
        return x * x * this.m[0] + 2 * x * y * this.m[1] + 2 * x * z * this.m[2] + 2 * x * this.m[3] +
            y * y * this.m[4] + 2 * y * z * this.m[5] + 2 * y * this.m[6] +
            z * z * this.m[7] + 2 * z * this.m[8] + this.m[9];
    }
}

class PriorityQueue {
    constructor(comparator) {
        this.heap = [];
        this.comparator = comparator;
    }
    push(item) {
        this.heap.push(item);
        this.bubbleUp();
    }
    pop() {
        if (this.size() === 0) return null;
        const top = this.heap[0];
        const last = this.heap.pop();
        if (this.size() > 0) {
            this.heap[0] = last;
            this.bubbleDown();
        }
        return top;
    }
    size() { return this.heap.length; }
    bubbleUp() {
        let idx = this.heap.length - 1;
        while (idx > 0) {
            let parentIdx = Math.floor((idx - 1) / 2);
            if (this.comparator(this.heap[idx], this.heap[parentIdx]) >= 0) break;
            [this.heap[idx], this.heap[parentIdx]] = [this.heap[parentIdx], this.heap[idx]];
            idx = parentIdx;
        }
    }
    bubbleDown() {
        let idx = 0;
        const length = this.heap.length;
        while (true) {
            let left = 2 * idx + 1;
            let right = 2 * idx + 2;
            let swap = null;
            if (left < length) {
                if (this.comparator(this.heap[left], this.heap[idx]) < 0) swap = left;
            }
            if (right < length) {
                if ((swap === null && this.comparator(this.heap[right], this.heap[idx]) < 0) ||
                    (swap !== null && this.comparator(this.heap[right], this.heap[left]) < 0)) swap = right;
            }
            if (swap === null) break;
            [this.heap[idx], this.heap[swap]] = [this.heap[swap], this.heap[idx]];
            idx = swap;
        }
    }
}

import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.170.0/+esm';
import { OrbitControls } from 'https://cdn.jsdelivr.net/npm/three@0.170.0/examples/jsm/controls/OrbitControls.js/+esm';
import { OBJLoader } from 'https://cdn.jsdelivr.net/npm/three@0.170.0/examples/jsm/loaders/OBJLoader.js/+esm';
import { STLLoader } from 'https://cdn.jsdelivr.net/npm/three@0.170.0/examples/jsm/loaders/STLLoader.js/+esm';
import { GLTFLoader } from 'https://cdn.jsdelivr.net/npm/three@0.170.0/examples/jsm/loaders/GLTFLoader.js/+esm';
import * as BufferGeometryUtils from 'https://cdn.jsdelivr.net/npm/three@0.170.0/examples/jsm/utils/BufferGeometryUtils.js/+esm';

// Lazy-load the meshoptimizer WASM simplifier (CDN ESM). Only fetched the first time the
// "Quality (meshopt)" engine is actually used — the tool boots fine without it.
let _meshoptPromise = null;
function getMeshoptSimplifier() {
    if (!_meshoptPromise) {
        _meshoptPromise = import('https://cdn.jsdelivr.net/npm/meshoptimizer@1.1.1/meshopt_simplifier.js').then(async (m) => {
            const S = m.MeshoptSimplifier;
            await S.ready;
            return S;
        });
    }
    return _meshoptPromise;
}

/**
 * PHASE 1: HALF-EDGE DATA STRUCTURE
 */

class Vertex {
    constructor(id, position) {
        this.id = id;
        this.position = position.clone(); // THREE.Vector3
        this.halfEdge = null; // One outgoing half-edge
        this.isDeleted = false;
        this.quadric = new Quadric(); // For QEM
        // Vertex colour (linear RGB, the same space Three.js/glTF work in), or null when the
        // source had none. Carried all the way to the export so painted GLBs keep their look.
        this.color = null;
    }
}

class HalfEdge {
    constructor(id) {
        this.id = id;
        this.vertex = null;   // Target vertex
        this.face = null;     // Associated face
        this.next = null;     // Next in CCW loop
        this.prev = null;     // Prev in CCW loop
        this.twin = null;     // Opposite edge
        this.isDeleted = false;
    }
}

class Face {
    constructor(id) {
        this.id = id;
        this.halfEdge = null; // One of its half-edges
        this.isDeleted = false;
    }
}

class HalfEdgeMesh {
    constructor() {
        this.vertices = [];
        this.halfEdges = [];
        this.faces = [];
        this.boundaryEdges = [];
        this.hasVertexColors = false;
    }

    clear() {
        this.vertices = [];
        this.halfEdges = [];
        this.faces = [];
        this.boundaryEdges = [];
        this.hasVertexColors = false;
    }

    /**
     * Build Half-Edge from Three.js BufferGeometry
     */
    buildFromGeometry(geometry) {
        this.clear();

        // Weld by POSITION ONLY before building the half-edge structure. Downloaded GLBs/OBJs
        // almost always SPLIT vertices (same xyz, different normal/uv) — e.g. this had 17628 verts
        // for 5679 unique positions. Left split, twin-pairing fails (every edge looks like a
        // boundary) and winding repair can't traverse, so faces end up inverted → see-through
        // holes in-game. A position-only merge rebuilds clean shared topology and slashes false
        // non-manifold edges. Normals are recomputed downstream, so dropping normal/uv is fine.
        const posOnly = new THREE.BufferGeometry();
        posOnly.setAttribute('position', geometry.attributes.position.clone());
        if (geometry.index) posOnly.setIndex(geometry.index.clone());
        let workingGeo = BufferGeometryUtils.mergeVertices(posOnly, 1e-5);

        // Vertex colours must be sampled from the SOURCE, before the weld: feeding them into
        // mergeVertices would make it hash colour too, so a hard colour edge would stop the
        // merge and we'd be back to the split-vertex topology this weld exists to remove.
        // Instead: average every source colour per position, then look them up post-weld.
        const srcColor = geometry.attributes.color;
        let colorByPos = null;
        if (srcColor) {
            const srcPos = geometry.attributes.position;
            colorByPos = new Map();
            for (let i = 0; i < srcPos.count; i++) {
                const key = `${srcPos.getX(i).toFixed(4)},${srcPos.getY(i).toFixed(4)},${srcPos.getZ(i).toFixed(4)}`;
                let acc = colorByPos.get(key);
                if (!acc) { acc = { r: 0, g: 0, b: 0, n: 0 }; colorByPos.set(key, acc); }
                acc.r += srcColor.getX(i);
                acc.g += srcColor.getY(i);
                acc.b += srcColor.getZ(i);
                acc.n++;
            }
        }

        // Drop degenerate triangles (repeated vertex index → zero area → poisons the half-edge)
        // AND duplicate/coincident faces (same 3 verts, any winding) — doubled coplanar faces
        // z-fight and flicker. After the position merge above, both are exact index comparisons.
        if (workingGeo.index) {
            const src = workingGeo.index.array;
            const kept = [];
            const seenTri = new Set();
            let degen = 0, dup = 0;
            for (let i = 0; i < src.length; i += 3) {
                const a = src[i], b = src[i + 1], c = src[i + 2];
                if (a === b || b === c || a === c) { degen++; continue; }
                const key = [a, b, c].sort((x, y) => x - y).join(',');
                if (seenTri.has(key)) { dup++; continue; }
                seenTri.add(key);
                kept.push(a, b, c);
            }
            if (degen || dup) {
                console.log(`[HalfEdgeMesh] Dropped ${degen} degenerate + ${dup} duplicate triangle(s).`);
                workingGeo.setIndex(kept);
            }
        }

        const posAttr = workingGeo.attributes.position;
        const indexAttr = workingGeo.index;

        if (!indexAttr) {
            console.error("Geometry must be indexed! Automatic indexing failed.");
            return;
        }

        // 1. Create Vertices
        for (let i = 0; i < posAttr.count; i++) {
            const pos = new THREE.Vector3().fromBufferAttribute(posAttr, i);
            const v = new Vertex(i, pos);
            if (colorByPos) {
                const acc = colorByPos.get(`${pos.x.toFixed(4)},${pos.y.toFixed(4)},${pos.z.toFixed(4)}`);
                if (acc) v.color = new THREE.Color(acc.r / acc.n, acc.g / acc.n, acc.b / acc.n);
            }
            this.vertices.push(v);
        }
        this.hasVertexColors = !!colorByPos;

        // 2. Create Faces and Half-Edges
        const edgeMap = new Map(); // For twin pairing

        for (let i = 0; i < indexAttr.count; i += 3) {
            const fId = this.faces.length;
            const face = new Face(fId);
            this.faces.push(face);

            const vIdx = [
                indexAttr.getX(i),
                indexAttr.getX(i + 1),
                indexAttr.getX(i + 2)
            ];

            const faceHEs = [];
            for (let j = 0; j < 3; j++) {
                const he = new HalfEdge(this.halfEdges.length);
                he.vertex = this.vertices[vIdx[(j + 1) % 3]];
                he.face = face;

                // Set vertex's outgoing HE if not already set
                if (!this.vertices[vIdx[j]].halfEdge) {
                    this.vertices[vIdx[j]].halfEdge = he;
                }

                this.halfEdges.push(he);
                faceHEs.push(he);

                // For twin mapping: key is sorted pair of vertex IDs
                const v1 = vIdx[j];
                const v2 = vIdx[(j + 1) % 3];
                const key = v1 < v2 ? `${v1}-${v2}` : `${v2}-${v1}`;

                if (edgeMap.has(key)) {
                    const twin = edgeMap.get(key);
                    he.twin = twin;
                    twin.twin = he;
                    edgeMap.delete(key);
                } else {
                    edgeMap.set(key, he);
                }
            }

            // Link Next/Prev
            for (let j = 0; j < 3; j++) {
                faceHEs[j].next = faceHEs[(j + 1) % 3];
                faceHEs[j].prev = faceHEs[(j + 2) % 3];
            }

            face.halfEdge = faceHEs[0];
        }

        // 3. Mark Boundary Edges (remaining in map)
        this.boundaryEdges = Array.from(edgeMap.values());

        console.log(`[HalfEdgeMesh] Initial pairing: ${this.boundaryEdges.length} unpaired edges.`);

        // 4. Weld coincident vertices (same position, different IDs)
        // This fixes cases where mergeVertices didn't fully merge all coincident verts
        const posMap = new Map();
        const vertexRemap = new Map(); // oldVertex → canonicalVertex
        this.vertices.forEach(v => {
            if (v.isDeleted) return;
            // Round to 4 decimal places to catch floating-point near-matches
            const key = `${v.position.x.toFixed(4)},${v.position.y.toFixed(4)},${v.position.z.toFixed(4)}`;
            if (posMap.has(key)) {
                vertexRemap.set(v, posMap.get(key));
                v.isDeleted = true;
            } else {
                posMap.set(key, v);
            }
        });

        if (vertexRemap.size > 0) {
            console.log(`[HalfEdgeMesh] Welding ${vertexRemap.size} coincident vertices...`);
            // Redirect all half-edges pointing to remapped vertices
            this.halfEdges.forEach(e => {
                if (e.isDeleted) return;
                if (vertexRemap.has(e.vertex)) {
                    e.vertex = vertexRemap.get(e.vertex);
                }
            });
        }

        // 5. Rebuild twins globally with clean vertex IDs
        this.repairTwinsGlobally();

        const openEdges = this.halfEdges.filter(e => !e.isDeleted && !e.twin).length;
        console.log(`[HalfEdgeMesh] Built: ${this.vertices.length} verts (${posMap.size} unique), ${this.faces.length} faces, ${openEdges} open edges.`);
    }

    /**
     * Rebuild Three.js indexed geometry for rendering
     * @param {Array} faceMap Optional array to populate with face references per-triangle
     * @param {Function} skipFace Optional (face) => bool — drop a face from the output. Used to
     *        hide whole connected parts; faceMap stays index-aligned because both are skipped.
     */
    generateBufferGeometry(faceMap = null, skipFace = null) {
        const geometry = new THREE.BufferGeometry();
        const positions = [];
        const indices = [];
        // Emit colours whenever the mesh carries them — this is what makes recalcNormals(),
        // simplifyMeshopt() and mergeAllObjects() (all of which round-trip through geometry)
        // keep the paint instead of dropping it.
        const colors = this.hasVertexColors ? [] : null;

        // Map original vertex IDs to new buffer indices (skipping deleted)
        const vMap = new Map();
        let newIdx = 0;

        this.vertices.forEach(v => {
            if (!v.isDeleted) {
                positions.push(v.position.x, v.position.y, v.position.z);
                if (colors) {
                    const c = v.color;
                    colors.push(c ? c.r : 1, c ? c.g : 1, c ? c.b : 1);
                }
                vMap.set(v.id, newIdx++);
            }
        });

        let skippedFaces = 0;
        this.faces.forEach(f => {
            if (!f.isDeleted) {
                if (skipFace && skipFace(f)) return;
                const he = f.halfEdge;
                // Since it's a triangle mesh, we have exactly 3 Next steps
                const v1 = he.prev.vertex;
                const v2 = he.vertex;
                const v3 = he.next.vertex;

                const i1 = vMap.get(v1.id);
                const i2 = vMap.get(v2.id);
                const i3 = vMap.get(v3.id);
                if (i1 !== undefined && i2 !== undefined && i3 !== undefined) {
                    indices.push(i1, i2, i3);
                    if (faceMap) faceMap.push(f);
                } else {
                    skippedFaces++;
                    // Silently increment skipped faces to avoid locking the UI thread with 10k console warnings
                }
            }
        });
        if (skippedFaces > 0) console.warn(`[generateBufferGeometry] Total skipped: ${skippedFaces} faces`);

        geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        if (colors) geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
        geometry.setIndex(indices);
        geometry.computeVertexNormals();

        return geometry;
    }

    /**
     * Unify face winding / recalculate normals ("Recalculate Outside").
     * Imported meshes often have inconsistent triangle winding, which makes face
     * normals point every which way — so a prism/extrusion conversion grows in the
     * wrong direction on those faces. This flood-fills across shared edges to make all
     * faces consistently wound, then flips the whole mesh outward (signed volume > 0),
     * and rebuilds the half-edge structure from the corrected geometry.
     */
    recalcNormals() {
        const geo = this.generateBufferGeometry();
        const pos = geo.attributes.position;
        const idx = Array.from(geo.index.array);
        const triCount = idx.length / 3;
        if (triCount === 0) return false;

        // undirected edge -> list of triangle ids that touch it
        const edge2tris = new Map();
        const ekey = (a, b) => (a < b ? a + '_' + b : b + '_' + a);
        for (let t = 0; t < triCount; t++) {
            const v = [idx[t * 3], idx[t * 3 + 1], idx[t * 3 + 2]];
            for (let e = 0; e < 3; e++) {
                const k = ekey(v[e], v[(e + 1) % 3]);
                let l = edge2tris.get(k); if (!l) edge2tris.set(k, l = []);
                l.push(t);
            }
        }
        // does triangle t (with its current flip applied) traverse the directed edge a->b?
        const flip = new Uint8Array(triCount);
        const goes = (t, a, b) => {
            let v = [idx[t * 3], idx[t * 3 + 1], idx[t * 3 + 2]];
            if (flip[t]) v = [v[0], v[2], v[1]];
            for (let e = 0; e < 3; e++) if (v[e] === a && v[(e + 1) % 3] === b) return true;
            return false;
        };
        // flood-fill each connected component; a neighbour sharing edge (a,b) must
        // traverse it b->a — if it goes a->b (same direction), it's inverted -> flip.
        const visited = new Uint8Array(triCount);
        for (let s = 0; s < triCount; s++) {
            if (visited[s]) continue;
            visited[s] = 1; const stack = [s];
            while (stack.length) {
                const t = stack.pop();
                let v = [idx[t * 3], idx[t * 3 + 1], idx[t * 3 + 2]];
                if (flip[t]) v = [v[0], v[2], v[1]];
                for (let e = 0; e < 3; e++) {
                    const a = v[e], b = v[(e + 1) % 3];
                    for (const nb of (edge2tris.get(ekey(a, b)) || [])) {
                        if (nb === t || visited[nb]) continue;
                        if (goes(nb, a, b)) flip[nb] = 1; // same direction across the edge -> invert
                        visited[nb] = 1; stack.push(nb);
                    }
                }
            }
        }
        // apply flips
        const out = idx.slice();
        for (let t = 0; t < triCount; t++) if (flip[t]) { const i = t * 3; const tmp = out[i + 1]; out[i + 1] = out[i + 2]; out[i + 2] = tmp; }
        // Non-manifold check: an edge shared by >2 triangles has no well-defined
        // orientation — the flood-fill can't fully resolve such a mesh.
        let nonManifold = 0;
        for (const l of edge2tris.values()) if (l.length > 2) nonManifold++;

        // orient outward: signed volume of the (now-consistent) mesh; if clearly
        // negative, flip all. Skip when |vol|~0 (open shell / non-manifold => no inside).
        let vol = 0; const A = new THREE.Vector3(), B = new THREE.Vector3(), C = new THREE.Vector3();
        for (let t = 0; t < triCount; t++) {
            A.fromBufferAttribute(pos, out[t * 3]); B.fromBufferAttribute(pos, out[t * 3 + 1]); C.fromBufferAttribute(pos, out[t * 3 + 2]);
            vol += A.dot(B.clone().cross(C));
        }
        const oriented = Math.abs(vol) > 1e-4;
        if (oriented && vol < 0) for (let t = 0; t < triCount; t++) { const i = t * 3; const tmp = out[i + 1]; out[i + 1] = out[i + 2]; out[i + 2] = tmp; }

        const fixed = new THREE.BufferGeometry();
        fixed.setAttribute('position', pos.clone());
        if (geo.attributes.color) fixed.setAttribute('color', geo.attributes.color.clone());
        fixed.setIndex(out);
        fixed.computeVertexNormals();
        this.buildFromGeometry(fixed);
        return { ok: true, nonManifold, oriented, flips: flip.reduce((a, b) => a + b, 0) };
    }

    toOBJ() {
        let obj = "# V1 Mesh Prep Export\n";
        const vMap = new Map();
        let vIdx = 1;

        this.vertices.forEach(v => {
            if (!v.isDeleted) {
                obj += `v ${v.position.x.toFixed(6)} ${v.position.y.toFixed(6)} ${v.position.z.toFixed(6)}\n`;
                vMap.set(v.id, vIdx++);
            }
        });

        this.faces.forEach(f => {
            if (!f.isDeleted) {
                const he = f.halfEdge;
                const i1 = vMap.get(he.prev.vertex.id);
                const i2 = vMap.get(he.vertex.id);
                const i3 = vMap.get(he.next.vertex.id);
                if (i1 && i2 && i3) {
                    obj += `f ${i1} ${i2} ${i3}\n`;
                }
            }
        });

        return obj;
    }

    /**
     * Compute Quality (Min Angle) for each face and return colored non-indexed geometry
     */
    toQualityGeometry(faceMap = null, skipFace = null) {
        const geometry = new THREE.BufferGeometry();
        const positions = [];
        const colors = [];

        this.faces.forEach(f => {
            if (f.isDeleted) return;
            if (skipFace && skipFace(f)) return;

            const he = f.halfEdge;
            const p1 = he.prev.vertex.position;
            const p2 = he.vertex.position;
            const p3 = he.next.vertex.position;

            // Calculate min angle
            const e1 = p2.clone().sub(p1).normalize();
            const e2 = p3.clone().sub(p2).normalize();
            const e3 = p1.clone().sub(p3).normalize();

            const e1_inv = e1.clone().negate();
            const e2_inv = e2.clone().negate();
            const e3_inv = e3.clone().negate();

            const a1 = Math.acos(Math.max(-1, Math.min(1, e1.dot(e3_inv)))) * (180 / Math.PI);
            const a2 = Math.acos(Math.max(-1, Math.min(1, e2.dot(e1_inv)))) * (180 / Math.PI);
            const a3 = Math.acos(Math.max(-1, Math.min(1, e3.dot(e2_inv)))) * (180 / Math.PI);

            const minAngle = Math.min(a1, a2, a3);

            // Color Mapping
            const color = new THREE.Color();
            if (minAngle >= 30) color.set(0x10b981); // Green
            else if (minAngle >= 15) color.set(0xfacc15); // Yellow
            else if (minAngle >= 5) color.set(0xfb923c); // Orange
            else color.set(0xef4444); // Red

            // Non-indexed for flat color per face
            positions.push(p1.x, p1.y, p1.z, p2.x, p2.y, p2.z, p3.x, p3.y, p3.z);
            for (let i = 0; i < 3; i++) colors.push(color.r, color.g, color.b);
            if (faceMap) faceMap.push(f);
        });

        geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
        geometry.computeVertexNormals();
        return geometry;
    }

    checkLinkCondition(he) {
        if (he.isDeleted) return false;

        const vSource = he.prev.vertex;
        const vTarget = he.vertex;

        // Use IDs for set operations to avoid reference issues
        const ringS = this.getNeighborhood(vSource).map(v => v.id);
        const ringT = this.getNeighborhood(vTarget).map(v => v.id);
        const commonIds = ringS.filter(id => ringT.includes(id));

        const faces = [];
        if (he.face) faces.push(he.face);
        if (he.twin && he.twin.face) faces.push(he.twin.face);

        const expectedIds = [];
        faces.forEach(f => {
            let e = f.halfEdge;
            for (let i = 0; i < 3; i++) {
                if (e.vertex.id !== vSource.id && e.vertex.id !== vTarget.id) {
                    expectedIds.push(e.vertex.id);
                }
                e = e.next;
            }
        });

        // The intersection of vSource and vTarget neighbors MUST only contain 
        // the vertices that belong to the shared faces.
        const unexpected = commonIds.filter(id => !expectedIds.includes(id));
        if (unexpected.length > 0) {
            // console.warn(`[HalfEdgeMesh] Link Condition violation. Unexpected common neighbors: ${unexpected}`);
            return false;
        }

        return true;
    }

    collapseEdge(he, mode = 'CENTER', targetPosition = null) {
        if (!this.checkLinkCondition(he)) return false;

        const vSource = he.prev.vertex;
        const vTarget = he.vertex;

        // 1. Move vSource to target position FIRST
        if (mode === 'CENTER') {
            const midpoint = vSource.position.clone().add(vTarget.position).multiplyScalar(0.5);
            vSource.position.copy(midpoint);
        } else if (mode === 'P2') {
            vSource.position.copy(vTarget.position);
        } else if (mode === 'CUSTOM' && targetPosition) {
            vSource.position.copy(targetPosition);
        }
        // If mode === 'P1', vSource stays at its current position.

        // The survivor inherits the paint: blend for a midpoint collapse, take the target's
        // colour when it moved onto it. Without this, decimation slowly bleaches the mesh.
        if (vSource.color && vTarget.color) {
            if (mode === 'CENTER') vSource.color.lerp(vTarget.color, 0.5);
            else if (mode === 'P2') vSource.color.copy(vTarget.color);
        } else if (!vSource.color && vTarget.color) {
            vSource.color = vTarget.color.clone();
        }

        // 2. Redirect ALL half-edges pointing to vTarget → vSource
        this.halfEdges.forEach(e => {
            if (!e.isDeleted && e.vertex === vTarget) {
                e.vertex = vSource;
            }
        });

        // 3. Mark vTarget as deleted
        vTarget.isDeleted = true;

        // 4. PURGE: Scan ALL faces for degeneracy (< 3 unique vertices)
        let purgedCount = 0;
        this.faces.forEach(f => {
            if (f.isDeleted) return;
            const fh = f.halfEdge;
            if (!fh || fh.isDeleted) return;

            const verts = new Set([fh.vertex, fh.next.vertex, fh.next.next.vertex]);
            if (verts.size < 3) {
                f.isDeleted = true;
                fh.isDeleted = true;
                fh.next.isDeleted = true;
                fh.next.next.isDeleted = true;
                purgedCount++;
            }
        });

        // 5. REPAIR: Rebuild all twin pointers from scratch
        this.repairTwinsGlobally();
        this.cleanupOrphanVertices();

        // Removed automatic sealHoles() per user request - manual only

        // console.log(`[HalfEdgeMesh] Edge collapse (${mode}). V${vTarget.id} → V${vSource.id}. Purged ${purgedCount} degenerate faces.`);
        return true;
    }

    collapseTriangle(face, mode = 'CENTER') {
        if (face.isDeleted) return false;

        const h1 = face.halfEdge;
        const h2 = h1.next;
        const h3 = h2.next;

        const vTarget = h1.prev.vertex;  // V1 = survivor
        const v2 = h1.vertex;
        const v3 = h2.vertex;

        // Compute target position
        const targetPos = new THREE.Vector3();
        if (mode === 'CENTER') {
            targetPos.add(vTarget.position).add(v2.position).add(v3.position).divideScalar(3);
        } else if (mode === 'V1') {
            targetPos.copy(vTarget.position);
        } else if (mode === 'V2') {
            targetPos.copy(v2.position);
        } else if (mode === 'V3') {
            targetPos.copy(v3.position);
        }

        vTarget.position.copy(targetPos);

        // MERGE: Redirect all half-edges pointing to v2 or v3 → vTarget
        this.halfEdges.forEach(e => {
            if (!e.isDeleted && (e.vertex === v2 || e.vertex === v3)) {
                e.vertex = vTarget;
            }
        });

        v2.isDeleted = true;
        v3.isDeleted = true;

        // PURGE: Scan ALL faces for degeneracy (< 3 unique vertices)
        let purgedCount = 0;
        this.faces.forEach(f => {
            if (f.isDeleted) return;
            const fh = f.halfEdge;
            if (!fh || fh.isDeleted) return;

            const verts = new Set([fh.vertex, fh.next.vertex, fh.next.next.vertex]);
            if (verts.size < 3) {
                f.isDeleted = true;
                fh.isDeleted = true;
                fh.next.isDeleted = true;
                fh.next.next.isDeleted = true;
                purgedCount++;
            }
        });

        // 5. REPAIR: Ensure vTarget has a valid outgoing half-edge
        vTarget.halfEdge = this.halfEdges.find(e => !e.isDeleted && e.prev.vertex === vTarget) || null;

        this.repairTwinsGlobally();
        this.cleanupOrphanVertices();

        // Removed automatic sealHoles() per user request - manual only

        console.log(`[MeshPrep] Face collapse (${mode}). Purged ${purgedCount} degenerate faces.`);
        // Diagnostic: count open edges
        let openCount = 0;
        this.halfEdges.forEach(e => { if (!e.isDeleted && !e.twin) openCount++; });
        const activeFaces = this.faces.filter(f => !f.isDeleted).length;
        console.log(`[MeshPrep] Post-collapse topology: ${activeFaces} faces, ${openCount} open edges.`);
        return true;
    }

    repairTwinsGlobally() {
        // Clear all twins and rebuild
        this.halfEdges.forEach(e => { if (!e.isDeleted) e.twin = null; });

        const edgeMap = new Map();
        this.halfEdges.forEach(e => {
            if (e.isDeleted) return;
            const vStart = e.prev.vertex;
            const vTarget = e.vertex;
            if (!vStart || !vTarget || vStart === vTarget) {
                // Zero-length edge: delete the entire face
                e.isDeleted = true;
                if (e.face && !e.face.isDeleted) {
                    e.face.isDeleted = true;
                    // Also delete sibling half-edges of this face
                    if (e.next && !e.next.isDeleted) e.next.isDeleted = true;
                    if (e.prev && !e.prev.isDeleted) e.prev.isDeleted = true;
                }
                return;
            }

            // Key represents the DIRECTED edge
            const key = `${vStart.id}->${vTarget.id}`;
            const twinKey = `${vTarget.id}->${vStart.id}`;

            if (edgeMap.has(twinKey)) {
                const other = edgeMap.get(twinKey);
                e.twin = other;
                other.twin = e;
                edgeMap.delete(twinKey);
            } else {
                edgeMap.set(key, e);
            }
        });

        // Pointer Sanitization
        const vToHe = new Map();
        const fToHe = new Map();

        this.halfEdges.forEach(e => {
            if (e.isDeleted) return;
            if (!vToHe.has(e.prev.vertex)) vToHe.set(e.prev.vertex, e);
            if (!fToHe.has(e.face)) fToHe.set(e.face, e);
        });

        this.vertices.forEach(v => {
            if (v.isDeleted) return;
            v.halfEdge = vToHe.get(v) || null;
        });

        this.faces.forEach(f => {
            if (f.isDeleted) return;
            if (!f.halfEdge || f.halfEdge.isDeleted) {
                f.halfEdge = fToHe.get(f) || null;
            }
        });
    }

    getNeighborhood(vertex) {
        const neighbors = new Set();
        // Global search: absolute topological correctness (debug-stable)
        this.halfEdges.forEach(e => {
            if (e.isDeleted) return;
            if (e.prev.vertex === vertex) neighbors.add(e.vertex);
            if (e.vertex === vertex) neighbors.add(e.prev.vertex);
        });
        return Array.from(neighbors);
    }

    getFaceNormal(face) {
        if (face.isDeleted) return new THREE.Vector3();
        const he = face.halfEdge;
        const p1 = he.prev.vertex.position;
        const p2 = he.vertex.position;
        const p3 = he.next.vertex.position;
        const v1 = new THREE.Vector3().subVectors(p2, p1);
        const v2 = new THREE.Vector3().subVectors(p3, p1);
        return new THREE.Vector3().crossVectors(v1, v2).normalize();
    }

    planarDecimate(thresholdDegrees = 1.0) {
        // ... (existing planarDecimate logic stays as fallback)
        const thresholdRad = thresholdDegrees * Math.PI / 180;
        const thresholdCos = Math.cos(thresholdRad);
        let totalCollapsed = 0;

        // Pass 1: Collect candidates (edges that connect two coplanar faces)
        // We'll use a conservative approach: only collapse edges where
        // normals are extremely close and both vertices aren't boundary.
        const candidates = [];
        this.halfEdges.forEach(e => {
            if (e.isDeleted || !e.twin) return;
            if (e.id > e.twin.id) return; // Only process each pair once

            const n1 = this.getFaceNormal(e.face);
            const n2 = this.getFaceNormal(e.twin.face);

            if (n1.dot(n2) >= thresholdCos) {
                candidates.push(e);
            }
        });

        // Sort candidates by edge length (shortest first) to preserve topology quality
        candidates.sort((a, b) => {
            const lA = a.prev.vertex.position.distanceTo(a.vertex.position);
            const lB = b.prev.vertex.position.distanceTo(b.vertex.position);
            return lA - lB;
        });

        for (const he of candidates) {
            if (he.isDeleted || he.vertex.isDeleted || he.prev.vertex.isDeleted) continue;

            // Check if ANY of the neighbors are boundary (safety)
            const vS = he.prev.vertex;
            const vT = he.vertex;

            // Don't collapse if it changes silhouette (boundary)
            const isBoundaryS = this.halfEdges.some(e => !e.isDeleted && e.prev.vertex === vS && !e.twin);
            const isBoundaryT = this.halfEdges.some(e => !e.isDeleted && e.prev.vertex === vT && !e.twin);

            // If one is boundary and other is not, we can only collapse to the boundary one
            let mode = 'CENTER';
            if (isBoundaryS && !isBoundaryT) mode = 'P1';
            else if (!isBoundaryS && isBoundaryT) mode = 'P2';
            else if (isBoundaryS && isBoundaryT) {
                // Both are boundary - only collapse if they share a boundary edge
                const boundaryEdge = this.halfEdges.find(e => !e.isDeleted && !e.twin &&
                    ((e.prev.vertex === vS && e.vertex === vT) || (e.prev.vertex === vT && e.vertex === vS)));
                if (!boundaryEdge) continue; // Safety
                mode = 'CENTER';
            }

            if (this.collapseEdge(he, mode)) {
                totalCollapsed++;
            }
        }

        console.log(`[HalfEdgeMesh] Planar Decimate: Collapsed ${totalCollapsed} edges.`);
        return totalCollapsed;
    }

    calculateQuadrics() {
        this.vertices.forEach(v => v.quadric = new Quadric());
        this.faces.forEach(f => {
            if (f.isDeleted) return;
            const norm = this.getFaceNormal(f);
            const p = f.halfEdge.vertex.position;
            const d = -norm.dot(p);
            const q = Quadric.fromPlane(norm.x, norm.y, norm.z, d);

            // Add to all 3 vertices of the face
            f.halfEdge.vertex.quadric.add(q);
            f.halfEdge.next.vertex.quadric.add(q);
            f.halfEdge.prev.vertex.quadric.add(q);
        });
    }

    getOptimalEdgeCollapse(he) {
        const v1 = he.prev.vertex;
        const v2 = he.vertex;
        const qSum = v1.quadric.clone().add(v2.quadric);

        // Simple strategy: check v1, v2, and midpoint
        const p1 = v1.position;
        const p2 = v2.position;
        const mid = p1.clone().add(p2).multiplyScalar(0.5);

        const e1 = qSum.getError(p1);
        const e2 = qSum.getError(p2);
        const em = qSum.getError(mid);

        let bestPos = mid;
        let minErr = em;

        if (e1 < minErr) { minErr = e1; bestPos = p1; }
        if (e2 < minErr) { minErr = e2; bestPos = p2; }

        return { pos: bestPos, error: minErr };
    }

    /**
     * Would collapsing edge (v1,v2) — moving the survivor to newPos — invert or strongly turn
     * any SURVIVING incident face? Guards against foldovers/spikes/self-intersection that
     * "fundamentally change the form". Checks the 1-ring of v1∪v2, skipping the (≤2) faces that
     * share both endpoints (those collapse away). Reads positions, mutates nothing.
     */
    _collapseWouldFlip(v1, v2, newPos, set1, set2) {
        const faces = new Set();
        const add = (s) => { if (s) s.forEach(e => { if (!e.isDeleted && e.face && !e.face.isDeleted) faces.add(e.face); }); };
        add(set1); add(set2);
        const remap = (v) => (v === v1 || v === v2) ? newPos : v.position;
        for (const f of faces) {
            const fh = f.halfEdge; if (!fh || fh.isDeleted) continue;
            const a = fh.vertex, b = fh.next.vertex, c = fh.prev.vertex;
            const has1 = (a === v1 || b === v1 || c === v1);
            const has2 = (a === v2 || b === v2 || c === v2);
            if (has1 && has2) continue; // collapsing face — disappears
            const oN = b.position.clone().sub(a.position).cross(c.position.clone().sub(a.position));
            const oL = oN.length();
            const na = remap(a), nb = remap(b), nc = remap(c);
            const nN = nb.clone().sub(na).cross(nc.clone().sub(na));
            const nL = nN.length();
            if (nL < 1e-12) return true;            // degenerate after collapse → reject
            if (oL < 1e-12) continue;               // was already degenerate → ignore
            if (oN.dot(nN) / (oL * nL) < 0.2) return true; // normal flipped / >~78° turn → reject
        }
        return false;
    }

    simplify(targetFaceCount, opts = {}) {
        const preserveBoundary = opts.preserveBoundary !== false; // default ON — no new holes
        const preventFlips = opts.preventFlips !== false;         // default ON — no spikes/foldovers
        let activeFaceCount = this.faces.reduce((cnt, f) => cnt + (f.isDeleted ? 0 : 1), 0);
        if (activeFaceCount <= targetFaceCount) return 0;

        // Boundary vertices = touch an open edge (no twin). Pinned/constrained below so the
        // simplifier can never pull a boundary inward → no new holes, silhouette preserved.
        const boundaryVerts = new Set();
        this.halfEdges.forEach(he => { if (!he.isDeleted && !he.twin) { boundaryVerts.add(he.vertex); boundaryVerts.add(he.prev.vertex); } });

        // Error ceiling from mesh scale: never collapse an edge whose QEM error exceeds this, so
        // we don't "radically delete faces just to hit the target" and distort the form. QEM error
        // is squared distance, so square the tolerance (~1.2% of the bbox diagonal by default).
        const mn = new THREE.Vector3(Infinity, Infinity, Infinity), mx = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
        this.vertices.forEach(v => { if (!v.isDeleted) { mn.min(v.position); mx.max(v.position); } });
        const diag = mn.distanceTo(mx) || 1;
        const tol = (opts.tolerance != null ? opts.tolerance : 0.012) * diag;
        const maxError = tol * tol;

        // Density equalization: bias the collapse cost by local edge length so OVER-DENSE
        // clusters (short edges — e.g. a finely-tessellated round eye) get an artificially
        // LOW cost and are collapsed first, evening out the triangle distribution. Pure QEM
        // (densityBias=0) instead PRESERVES high-curvature detail, which keeps such clusters
        // dense — the opposite of what we want for a balanced low-poly. The exponent is applied
        // to (edgeLen / avgEdgeLen): <1 for dense edges → cost shrinks, >1 for sparse → protected.
        const densityBias = Math.max(0, opts.densityBias || 0);
        let avgEdgeLen = 1;
        if (densityBias > 0) {
            let sumL = 0, nL = 0;
            this.halfEdges.forEach(he => {
                if (he.isDeleted || (he.twin && he.id > he.twin.id)) return;
                sumL += he.prev.vertex.position.distanceTo(he.vertex.position); nL++;
            });
            avgEdgeLen = (nL > 0 ? sumL / nL : 1) || 1;
        }

        console.log(`[QEM] Simplify ${activeFaceCount} -> ${targetFaceCount} | preserveBoundary=${preserveBoundary} preventFlips=${preventFlips} densityBias=${densityBias.toFixed(2)} maxErr=${maxError.toExponential(2)} (${boundaryVerts.size} boundary verts)`);

        this.calculateQuadrics();
        const pq = new PriorityQueue((a, b) => a.error - b.error);

        // Edge maps to track which ones are in PQ
        const edgeToEntry = new Map();
        
        // Fast topological map: Vertex -> Set of HalfEdges it touches
        const v2he = new Map();
        this.halfEdges.forEach(he => {
            if (he.isDeleted) return;
            const v1 = he.prev.vertex;
            const v2 = he.vertex;
            if (!v2he.has(v1)) v2he.set(v1, new Set());
            if (!v2he.has(v2)) v2he.set(v2, new Set());
            v2he.get(v1).add(he);
            v2he.get(v2).add(he);
        });

        const refreshEdge = (he) => {
            if (he.isDeleted || he.prev.vertex.isDeleted || he.vertex.isDeleted) return;
            // Only add one entry per edge pair (he and he.twin)
            if (he.twin && he.id > he.twin.id) return;

            const opt = this.getOptimalEdgeCollapse(he);
            let err = opt.error;
            if (densityBias > 0) {
                const L = he.prev.vertex.position.distanceTo(he.vertex.position);
                err *= Math.pow((L / avgEdgeLen) || 1, densityBias); // dense (short) edges → cheaper
            }
            const entry = { he, error: err, pos: opt.pos, version: (edgeToEntry.get(he.id)?.version ?? 0) + 1 };
            edgeToEntry.set(he.id, entry);
            pq.push(entry);
        };

        this.halfEdges.forEach(he => {
            if (he.isDeleted || (he.twin && he.id > he.twin.id)) return;
            refreshEdge(he);
        });

        let collapsed = 0;
        let attempts = 0;
        const maxAttempts = activeFaceCount * 2; // Prevent infinite loops

        while (pq.size() > 0 && activeFaceCount > targetFaceCount && attempts < maxAttempts) {
            attempts++;
            const entry = pq.pop();
            const he = entry.he;

            // Check if this entry is stale (edge was already processed or deleted)
            if (he.isDeleted || he.prev.vertex.isDeleted || he.vertex.isDeleted ||
                entry.version !== edgeToEntry.get(he.id)?.version) {
                continue;
            }

            const v1 = he.prev.vertex;
            const v2 = he.vertex;
            const qSum = v1.quadric.clone().add(v2.quadric);

            // Error ceiling: the PQ is ascending, so once the cheapest remaining collapse is too
            // costly, every remaining one is too — stop rather than distort the shape to hit target.
            if (entry.error > maxError) break;

            // Boundary preservation: pin boundaries. Allow a collapse only if fully interior, OR
            // strictly ALONG an open boundary edge (both endpoints boundary AND the edge itself is
            // open) — and then keep the survivor exactly on the boundary (endpoint, not the
            // QEM-optimal interior point), so the outline never moves and no hole opens.
            const b1 = boundaryVerts.has(v1), b2 = boundaryVerts.has(v2);
            if (preserveBoundary && (b1 || b2)) {
                if (b1 && b2 && !he.twin) {
                    entry.pos = (qSum.getError(v1.position) <= qSum.getError(v2.position))
                        ? v1.position.clone() : v2.position.clone();
                } else {
                    continue; // would pull a boundary inward or merge boundaries → hole
                }
            }

            // Flip/foldover guard: reject collapses that invert or strongly turn a surviving face.
            if (preventFlips && this._collapseWouldFlip(v1, v2, entry.pos, v2he.get(v1), v2he.get(v2))) {
                continue;
            }

            // FAST INLINE EDGE COLLAPSE (O(1) Local Topological Merge)

            // 1. Absorb Quadric & Reposition
            v1.quadric = qSum;
            v1.position.copy(entry.pos);
            
            // 2. Redirect HalfEdges pointing to absorbed vertex V2
            const setV1 = v2he.get(v1) || new Set();
            const setV2 = v2he.get(v2) || new Set();
            setV2.forEach(e => {
                if (!e.isDeleted) {
                    if (e.vertex === v2) e.vertex = v1;
                    if (e.prev.vertex === v2) e.prev.vertex = v1;
                }
            });
            v2.isDeleted = true;
            
            // 3. Fast Degenerate Face Purge (Only checks V1/V2 adjacent faces)
            let facesLost = 0;
            const checkFaces = new Set();
            setV2.forEach(e => { if (e.face) checkFaces.add(e.face); });
            setV1.forEach(e => { if (e.face) checkFaces.add(e.face); });

            checkFaces.forEach(f => {
                if (f.isDeleted) return;
                const fh = f.halfEdge;
                if (!fh || fh.isDeleted) return;
                const verts = new Set([fh.vertex.id, fh.next.vertex.id, fh.next.next.vertex.id]);
                if (verts.size < 3) {
                    f.isDeleted = true;
                    fh.isDeleted = true;
                    fh.next.isDeleted = true;
                    fh.next.next.isDeleted = true;
                    facesLost++;
                }
            });

            // 4. Update QEM Priority Queue for the surviving neighborhood
            const edgesToUpdate = new Set();
            setV2.forEach(e => {
                if (!e.isDeleted && !e.prev.vertex.isDeleted && !e.vertex.isDeleted) {
                    setV1.add(e);
                    edgesToUpdate.add(e);
                }
            });
            setV1.forEach(e => {
                if (!e.isDeleted && !e.prev.vertex.isDeleted && !e.vertex.isDeleted) {
                    edgesToUpdate.add(e);
                }
            });

            edgesToUpdate.forEach(e => refreshEdge(e));
            
            collapsed++;
            activeFaceCount -= facesLost;
        }

        console.log(`[QEM] Core simplification complete. Executing global topological rebuild...`);
        this.repairTwinsGlobally();
        this.cleanupOrphanVertices();
        // Removed automatic sealHoles()

        console.log(`[QEM] Fertig. Kollabierte Kanten: ${collapsed}. Gesichter übrig: ${activeFaceCount}`);
        return collapsed;
    }

    /**
     * High-quality QEM simplification via meshoptimizer (WASM). Feature-PRESERVING: keeps
     * sharp silhouettes / high-curvature detail, is error-bounded, flip-safe, and locks
     * topological borders. Rebuilds the half-edge structure from the decimated index buffer
     * so the rest of the pipeline (export / repair / density-QEM) keeps working on the result.
     */
    async simplifyMeshopt(targetFaceCount, opts = {}) {
        const Simplifier = await getMeshoptSimplifier();
        const geo = this.generateBufferGeometry();
        if (!geo.index) return 0;
        const indices = (geo.index.array instanceof Uint32Array)
            ? geo.index.array : new Uint32Array(geo.index.array);
        const positions = (geo.attributes.position.array instanceof Float32Array)
            ? geo.attributes.position.array : new Float32Array(geo.attributes.position.array);

        const triCount = indices.length / 3;
        let targetIndexCount = Math.max(12, Math.floor(targetFaceCount) * 3);
        targetIndexCount = Math.min(targetIndexCount, indices.length);
        const targetError = opts.targetError != null ? opts.targetError : 0.02; // relative to mesh size
        const flags = [];
        if (opts.lockBorder !== false) flags.push('LockBorder');

        const [simplified, resultError] = Simplifier.simplify(
            indices, positions, 3, targetIndexCount, targetError, flags
        );

        const out = new THREE.BufferGeometry();
        out.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        // meshopt only rewrites the index buffer, so the colour array still lines up 1:1
        if (geo.attributes.color) out.setAttribute('color', geo.attributes.color.clone());
        out.setIndex(new THREE.BufferAttribute(simplified, 1));
        out.computeVertexNormals();
        this.buildFromGeometry(out); // weld + rebuild half-edge (drops now-unused vertices)

        const after = this.faces.filter(f => !f.isDeleted).length;
        console.log(`[meshopt] ${triCount} -> ${after} faces (err ${resultError.toExponential(2)}).`);
        return triCount - after;
    }

    calculateAngle(p1, p2, p3) {
        const v1 = p2.clone().sub(p1);
        const v2 = p3.clone().sub(p1);
        return Math.acos(Math.max(-1, Math.min(1, v1.dot(v2) / (v1.length() * v2.length())))) * (180 / Math.PI);
    }

    sliverKiller(minAngle = 5.0) {
        let total = 0;
        // Create a copy of faces to iterate over, as original array might change
        const currentFaces = [...this.faces];

        for (const f of currentFaces) {
            if (f.isDeleted) continue;
            const he = f.halfEdge;
            if (!he || he.isDeleted) continue;

            const p1 = he.prev.vertex.position;
            const p2 = he.vertex.position;
            const p3 = he.next.vertex.position;

            const a1 = this.calculateAngle(p1, p2, p3); // Angle at p1
            const a2 = this.calculateAngle(p2, p3, p1); // Angle at p2
            const a3 = this.calculateAngle(p3, p1, p2); // Angle at p3

            if (Math.min(a1, a2, a3) < minAngle) {
                // Collapse the shortest edge of this triangle
                const l1 = p1.distanceTo(p2); // Edge he.prev.vertex -> he.vertex
                const l2 = p2.distanceTo(p3); // Edge he.vertex -> he.next.vertex
                const l3 = p3.distanceTo(p1); // Edge he.next.vertex -> he.prev.vertex

                let targetEdge = he; // Corresponds to edge (p1, p2)
                if (l2 < l1 && l2 < l3) targetEdge = he.next; // Corresponds to edge (p2, p3)
                else if (l3 < l1 && l3 < l2) targetEdge = he.prev; // Corresponds to edge (p3, p1)

                if (this.collapseEdge(targetEdge, 'CENTER')) {
                    total++;
                }
            }
        }
        console.log(`[HalfEdgeMesh] Sliver Killer: Collapsed ${total} edges.`);
        return total;
    }

    validateTopology() {
        let openEdges = 0;
        this.halfEdges.forEach(e => {
            if (!e.isDeleted && !e.twin) openEdges++;
        });
        console.log(`[HalfEdgeMesh] Topology: ${this.faces.filter(f => !f.isDeleted).length} faces, ${openEdges} open edges.`);
        return openEdges;
    }

    /**
     * Find the connected parts ("loose parts" / islands) inside this ONE mesh.
     *
     * Downloaded models constantly ship several physically separate objects fused into a single
     * mesh — a body plus 40 stray shells, a chair welded into the floor slab. They are not
     * separate objects in the file, but they ARE separate connected vertex groups, and that is
     * what this finds so a single one can be picked and deleted.
     *
     * Connectivity is by SHARED VERTEX, not shared edge: buildFromGeometry() already welds by
     * position, so anything that physically touches shares a vertex. Parts joined at a single
     * point (very common) therefore count as ONE part — same semantics as Blender's "Separate
     * by Loose Parts". Union-find over vertices, O(F + V).
     *
     * KEY PROPERTY: a part's vertices are exclusive to it (a shared vertex would have merged the
     * two groups), which is what makes deleteParts() an exact and cheap delete.
     */
    findConnectedParts() {
        const parent = new Map(); // Vertex → Vertex. Object keys: no vertex-id collision risk.
        const find = (v) => {
            let root = v;
            while (parent.get(root) !== root) root = parent.get(root);
            while (parent.get(v) !== root) { const nxt = parent.get(v); parent.set(v, root); v = nxt; }
            return root;
        };
        const union = (a, b) => {
            const ra = find(a), rb = find(b);
            if (ra !== rb) parent.set(ra, rb);
        };

        const liveFaces = [];
        for (const f of this.faces) {
            if (f.isDeleted || !f.halfEdge) continue;
            const he = f.halfEdge;
            const v1 = he.prev && he.prev.vertex;
            const v2 = he.vertex;
            const v3 = he.next && he.next.vertex;
            if (!v1 || !v2 || !v3) continue;
            if (v1.isDeleted || v2.isDeleted || v3.isDeleted) continue;
            if (!parent.has(v1)) parent.set(v1, v1);
            if (!parent.has(v2)) parent.set(v2, v2);
            if (!parent.has(v3)) parent.set(v3, v3);
            union(v1, v2);
            union(v2, v3);
            liveFaces.push(f);
        }

        // Group faces + vertices by their component root
        const groups = new Map();
        const groupOf = (root) => {
            let g = groups.get(root);
            if (!g) { g = { faces: [], vertices: [] }; groups.set(root, g); }
            return g;
        };
        for (const f of liveFaces) groupOf(find(f.halfEdge.vertex)).faces.push(f);
        for (const v of parent.keys()) groupOf(find(v)).vertices.push(v);

        // Biggest first — the body lands on top, junk shells collect at the bottom of the list
        const parts = [...groups.values()]
            .sort((a, b) => b.faces.length - a.faces.length)
            .map((g, i) => {
                const bbox = new THREE.Box3();
                let key = Infinity;
                g.vertices.forEach(v => bbox.expandByPoint(v.position));
                g.faces.forEach(f => { if (f.id < key) key = f.id; });
                const size = bbox.getSize(new THREE.Vector3());
                return {
                    index: i,
                    // Stable identity across re-detection: the smallest face id in the part.
                    // Deleting part A doesn't renumber part B's faces, so hide/select state survives.
                    key,
                    faces: g.faces,
                    vertices: g.vertices,
                    faceCount: g.faces.length,
                    vertexCount: g.vertices.length,
                    bbox,
                    center: bbox.getCenter(new THREE.Vector3()),
                    size,
                    diagonal: size.length()
                };
            });

        const faceToPart = new Map();
        parts.forEach(p => p.faces.forEach(f => faceToPart.set(f, p)));
        return { parts, faceToPart };
    }

    /**
     * Delete whole connected parts. Because a part owns its vertices exclusively (see
     * findConnectedParts), this drops faces AND vertices in one pass — no need for the
     * O(V·E) orphan sweep deleteFace() runs per triangle, which would take minutes on an
     * island of 20k faces.
     */
    deleteParts(parts) {
        let faces = 0, vertices = 0;
        for (const part of parts) {
            for (const f of part.faces) {
                if (f.isDeleted) continue;
                f.isDeleted = true;
                faces++;
                let he = f.halfEdge;
                for (let i = 0; i < 3 && he; i++) {
                    const nxt = he.next;
                    he.isDeleted = true;
                    // The twin belongs to the same part (it shares 2 verts) and dies too, but
                    // unlink both sides so no traversal can walk into a deleted edge.
                    if (he.twin) { he.twin.twin = null; he.twin = null; }
                    he = nxt;
                }
            }
            for (const v of part.vertices) {
                if (v.isDeleted) continue;
                v.isDeleted = true;
                v.halfEdge = null;
                vertices++;
            }
        }
        return { faces, vertices };
    }

    /** BufferGeometry for a single part — used for highlight overlays and for splitting it off. */
    partGeometry(part) {
        if (part._geo) return part._geo;
        const positions = [];
        const indices = [];
        const colors = this.hasVertexColors ? [] : null;
        const vMap = new Map();
        part.vertices.forEach(v => {
            vMap.set(v, positions.length / 3);
            positions.push(v.position.x, v.position.y, v.position.z);
            if (colors) {
                const c = v.color;
                colors.push(c ? c.r : 1, c ? c.g : 1, c ? c.b : 1);
            }
        });
        part.faces.forEach(f => {
            const he = f.halfEdge;
            const i1 = vMap.get(he.prev.vertex);
            const i2 = vMap.get(he.vertex);
            const i3 = vMap.get(he.next.vertex);
            if (i1 === undefined || i2 === undefined || i3 === undefined) return;
            indices.push(i1, i2, i3);
        });
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        if (colors) geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
        geo.setIndex(indices);
        geo.computeVertexNormals();
        part._geo = geo;
        return geo;
    }

    deleteFace(face) {
        if (!face || face.isDeleted) return;

        const he1 = face.halfEdge;
        const he2 = he1.next;
        const he3 = he2.next;

        // Mark face and its 3 edges as deleted
        face.isDeleted = true;
        [he1, he2, he3].forEach(e => {
            e.isDeleted = true;
            // If the edge had a twin, the twin now becomes a boundary edge (twin = null)
            if (e.twin) {
                e.twin.twin = null;
            }
        });

        this.cleanupOrphanVertices();
        return true;
    }

    deleteEdge(he) {
        if (!he || he.isDeleted) return;
        // Deleting an edge effectively deletes the adjacent faces
        if (he.face) this.deleteFace(he.face);
        if (he.twin && he.twin.face) this.deleteFace(he.twin.face);
        return true;
    }

    deleteVertex(vertex) {
        if (!vertex || vertex.isDeleted) return;

        // Find all half-edges starting from this vertex and delete their faces
        const adjacentHEs = this.halfEdges.filter(e => !e.isDeleted && e.prev.vertex === vertex);
        adjacentHEs.forEach(e => {
            if (e.face) this.deleteFace(e.face);
        });

        vertex.isDeleted = true;
        return true;
    }

    cleanupOrphanVertices() {
        this.vertices.forEach(v => {
            if (v.isDeleted) return;
            // A vertex is an orphan if no non-deleted half-edge starts from it
            const hasEdge = this.halfEdges.some(e => !e.isDeleted && e.prev.vertex === v);
            if (!hasEdge) {
                v.isDeleted = true;
            }
        });
    }

    dissolveVertex(vertex) {
        if (!vertex || vertex.isDeleted) return false;

        // Find outgoing half-edges to determine valence
        const outgoing = this.halfEdges.filter(e => !e.isDeleted && e.prev.vertex === vertex);
        const valence = outgoing.length;

        // Safety: Don't dissolve boundary vertices for now (complex)
        const isBoundary = outgoing.some(e => !e.face || (e.twin && !e.twin.face));
        if (isBoundary) {
            console.warn("[HalfEdgeMesh] Cannot dissolve boundary vertex.");
            return false;
        }

        // For valence 3 or 4, we can safely use edge collapse as a dissolve mechanism
        if (valence >= 3 && valence <= 6) {
            return this.collapseEdge(outgoing[0], 'P2'); // Collapse V into its neighbor
        }

        console.warn(`[HalfEdgeMesh] Dissolve not supported for valence ${valence}`);
        return false;
    }

    /**
     * Find all boundary loops (holes) in the mesh.
     * Uses the standard half-edge boundary walk algorithm:
     * From a boundary edge (no twin), rotate around the target vertex
     * via he.next → (twin.next)* until hitting another boundary edge.
     * Returns an array of loops, each loop being an ordered array of Vertex objects.
     */
    findBoundaryLoops() {
        // Collect all boundary half-edges (non-deleted, no twin)
        const boundaryEdges = this.halfEdges.filter(e => !e.isDeleted && !e.twin);
        if (boundaryEdges.length === 0) return [];

        const visited = new Set();
        const loops = [];

        for (const startEdge of boundaryEdges) {
            if (visited.has(startEdge.id)) continue;

            const loop = [];
            let current = startEdge;
            let safety = 0;

            do {
                if (visited.has(current.id)) break;
                visited.add(current.id);
                // Record the source vertex of this boundary edge
                loop.push(current.prev.vertex);

                // Walk to the next boundary edge in the loop:
                let walker = current.next;
                const seenWalkers = new Set();
                
                while (walker && walker.twin && !seenWalkers.has(walker.id)) {
                    seenWalkers.add(walker.id);
                    walker = walker.twin.next;
                }

                if (!walker || walker.twin) {
                    // We either hit a dead end, or we cycled infinitely in a non-manifold fan
                    // without ever finding an edge that has no twin.
                    // This means the boundary loop cannot be closed cleanly.
                    break;
                }
                
                // walker is now the next boundary edge (leaving from B, no twin)
                current = walker;
            } while (current !== startEdge && !visited.has(current.id));

            if (loop.length >= 3 && current === startEdge) {
                loops.push(loop);
            }
        }

        return loops;
    }

    /**
     * Fill a hole defined by an ordered vertex loop using ear-clipping triangulation.
     * The loop vertices trace the boundary in the half-edge direction (which goes
     * OPPOSITE to the face winding). So we reverse the loop to get correct CCW winding
     * for the fill triangles.
     */
    fillHole(loop) {
        if (loop.length < 3) return 0;

        // Reverse the loop so fill triangles have correct winding (CCW, matching mesh)
        let remaining = [...loop].reverse();
        let filled = 0;

        while (remaining.length > 3) {
            let bestEar = -1;
            let bestScore = -Infinity;

            // Find the best ear (smallest angle = tightest ear to clip first)
            for (let i = 0; i < remaining.length; i++) {
                const prev = remaining[(i - 1 + remaining.length) % remaining.length];
                const curr = remaining[i];
                const next = remaining[(i + 1) % remaining.length];

                // Calculate the angle at 'curr'
                const v1 = prev.position.clone().sub(curr.position).normalize();
                const v2 = next.position.clone().sub(curr.position).normalize();
                const angle = Math.acos(Math.max(-1, Math.min(1, v1.dot(v2)))) * (180 / Math.PI);

                // Prefer ears with smaller angles (clip tight corners first)
                // This produces better quality triangulation
                if (bestEar === -1 || angle < bestScore) {
                    bestScore = angle;
                    bestEar = i;
                }
            }

            if (bestEar === -1) break;

            const prev = remaining[(bestEar - 1 + remaining.length) % remaining.length];
            const curr = remaining[bestEar];
            const next = remaining[(bestEar + 1) % remaining.length];

            this._createTriangle(prev, curr, next);
            filled++;

            // Remove the ear vertex
            remaining.splice(bestEar, 1);
        }

        // Final triangle
        if (remaining.length === 3) {
            this._createTriangle(remaining[0], remaining[1], remaining[2]);
            filled++;
        }

        return filled;
    }

    /**
     * Check if a face with the same 3 vertices already exists (any winding order).
     */
    _faceExists(v0, v1, v2) {
        const ids = [v0.id, v1.id, v2.id].sort((a, b) => a - b);
        return this.faces.some(f => {
            if (f.isDeleted) return false;
            const fh = f.halfEdge;
            if (!fh || fh.isDeleted) return false;
            const fIds = [fh.vertex.id, fh.next.vertex.id, fh.next.next.vertex.id].sort((a, b) => a - b);
            return fIds[0] === ids[0] && fIds[1] === ids[1] && fIds[2] === ids[2];
        });
    }

    /**
     * Create a single triangle face from 3 vertices, adding new HalfEdges and Face.
     * Returns false if a face with those vertices already exists.
     */
    _createTriangle(v0, v1, v2) {
        // Skip if this triangle already exists
        if (this._faceExists(v0, v1, v2)) {
            // Silently skip duplicates to prevent blocking Chrome's UI thread
            return false;
        }

        const face = new Face(this.faces.length);
        this.faces.push(face);

        const he0 = new HalfEdge(this.halfEdges.length);
        const he1 = new HalfEdge(this.halfEdges.length + 1);
        const he2 = new HalfEdge(this.halfEdges.length + 2);

        // HE convention: he.vertex = target vertex
        // Triangle: v0 → v1 → v2
        he0.vertex = v1;
        he1.vertex = v2;
        he2.vertex = v0;

        he0.face = face;
        he1.face = face;
        he2.face = face;

        he0.next = he1; he0.prev = he2;
        he1.next = he2; he1.prev = he0;
        he2.next = he0; he2.prev = he1;

        face.halfEdge = he0;

        this.halfEdges.push(he0, he1, he2);
        return true;
    }

    /**
     * Remove duplicate faces (same 3 vertex IDs, any winding).
     */
    _removeDuplicateFaces() {
        const seen = new Set();
        let removed = 0;
        this.faces.forEach(f => {
            if (f.isDeleted) return;
            const fh = f.halfEdge;
            if (!fh || fh.isDeleted) return;
            const ids = [fh.vertex.id, fh.next.vertex.id, fh.next.next.vertex.id].sort((a, b) => a - b);
            const key = ids.join('-');
            if (seen.has(key)) {
                // Duplicate — delete this one
                f.isDeleted = true;
                fh.isDeleted = true;
                fh.next.isDeleted = true;
                fh.next.next.isDeleted = true;
                removed++;
            } else {
                seen.add(key);
            }
        });
        if (removed > 0) console.log(`[HalfEdgeMesh] Removed ${removed} duplicate face(s).`);
        return removed;
    }

    /**
     * Detect and fill all holes in the mesh.
     * Returns the number of holes filled.
     */
    sealHoles() {
        const loops = this.findBoundaryLoops();
        if (loops.length === 0) return 0;

        let totalFilled = 0;
        loops.forEach((loop, i) => {
            // Silencing console.log inside this massive iteration
            const filled = this.fillHole(loop);
            totalFilled += filled;
        });

        if (totalFilled > 0) {
            // Clean up any duplicate faces before rebuilding twins
            this._removeDuplicateFaces();
            // Rebuild twins to pair new edges with existing mesh
            this.repairTwinsGlobally();
            console.log(`[HalfEdgeMesh] Sealed ${loops.length} hole(s) with ${totalFilled} new triangle(s).`);
        }

        return totalFilled;
    }

    /**
     * Merge two vertices: keep vKeep, remove vRemove.
     * Redirects all half-edges, purges degenerate faces, repairs twins.
     */
    mergeVertices(vKeep, vRemove) {
        if (vKeep === vRemove || vKeep.isDeleted || vRemove.isDeleted) return false;

        // Log adjacency before merge
        const sharedFaces = this.faces.filter(f => {
            if (f.isDeleted) return false;
            const fh = f.halfEdge;
            if (!fh) return false;
            const verts = [fh.vertex, fh.next.vertex, fh.next.next.vertex];
            return verts.includes(vKeep) && verts.includes(vRemove);
        });
        console.log(`[HalfEdgeMesh] Merge V${vRemove.id} → V${vKeep.id}: ${sharedFaces.length} shared face(s).`);

        // 1. Redirect ALL half-edges pointing to vRemove → vKeep
        //    (identical to collapseEdge line 440-443)
        this.halfEdges.forEach(e => {
            if (!e.isDeleted && e.vertex === vRemove) {
                e.vertex = vKeep;
            }
        });

        // 2. Mark vRemove as deleted
        vRemove.isDeleted = true;

        // 3. PURGE degenerate faces — EXACT same pattern as collapseEdge (line 449-464)
        let purgedCount = 0;
        this.faces.forEach(f => {
            if (f.isDeleted) return;
            const fh = f.halfEdge;
            if (!fh || fh.isDeleted) return;

            const verts = new Set([fh.vertex, fh.next.vertex, fh.next.next.vertex]);
            if (verts.size < 3) {
                f.isDeleted = true;
                fh.isDeleted = true;
                fh.next.isDeleted = true;
                fh.next.next.isDeleted = true;
                purgedCount++;
            }
        });

        // 4. REPAIR twins globally — same as collapseEdge (line 467)
        this.repairTwinsGlobally();
        this.cleanupOrphanVertices();

        // 5. SEAL holes — same as collapseEdge (line 471)
        this.sealHoles();

        console.log(`[HalfEdgeMesh] Merge complete. Purged ${purgedCount} degenerate face(s).`);
        return true;
    }

    serialize() {
        return {
            hasVertexColors: this.hasVertexColors,
            vertices: this.vertices.map(v => ({
                id: v.id,
                x: v.position.x, y: v.position.y, z: v.position.z,
                c: v.color ? [v.color.r, v.color.g, v.color.b] : null,
                heId: v.halfEdge ? v.halfEdge.id : null,
                isDeleted: v.isDeleted
            })),
            halfEdges: this.halfEdges.map(e => ({
                id: e.id,
                vId: e.vertex ? e.vertex.id : null,
                fId: e.face ? e.face.id : null,
                nextId: e.next ? e.next.id : null,
                prevId: e.prev ? e.prev.id : null,
                twinId: e.twin ? e.twin.id : null,
                isDeleted: e.isDeleted
            })),
            faces: this.faces.map(f => ({
                id: f.id,
                heId: f.halfEdge ? f.halfEdge.id : null,
                isDeleted: f.isDeleted
            }))
        };
    }

    deserialize(data) {
        this.clear();

        // Build ID → object lookup maps for safe pointer resolution
        const vertMap = new Map();
        const heMap = new Map();
        const faceMap = new Map();

        this.hasVertexColors = !!data.hasVertexColors;

        // 1. Recreate Vertices
        data.vertices.forEach(v => {
            const vertex = new Vertex(v.id, new THREE.Vector3(v.x, v.y, v.z));
            vertex.isDeleted = v.isDeleted;
            if (v.c) vertex.color = new THREE.Color(v.c[0], v.c[1], v.c[2]);
            this.vertices.push(vertex);
            vertMap.set(v.id, vertex);
        });

        // 2. Recreate Half-Edges (stubs)
        data.halfEdges.forEach(e => {
            const he = new HalfEdge(e.id);
            he.isDeleted = e.isDeleted;
            this.halfEdges.push(he);
            heMap.set(e.id, he);
        });

        // 3. Recreate Faces
        data.faces.forEach(f => {
            const face = new Face(f.id);
            face.isDeleted = f.isDeleted;
            this.faces.push(face);
            faceMap.set(f.id, face);
        });

        // 4. Resolve Pointers via ID maps (NOT array indices)
        data.vertices.forEach((v, i) => {
            if (v.heId !== null) this.vertices[i].halfEdge = heMap.get(v.heId) || null;
        });

        data.faces.forEach((f, i) => {
            if (f.heId !== null) this.faces[i].halfEdge = heMap.get(f.heId) || null;
        });

        data.halfEdges.forEach((e, i) => {
            const he = this.halfEdges[i];
            if (e.vId !== null) he.vertex = vertMap.get(e.vId) || null;
            if (e.fId !== null) he.face = faceMap.get(e.fId) || null;
            if (e.nextId !== null) he.next = heMap.get(e.nextId) || null;
            if (e.prevId !== null) he.prev = heMap.get(e.prevId) || null;
            if (e.twinId !== null) he.twin = heMap.get(e.twinId) || null;
        });
    }
}

class FloatingMenu {
    constructor() {
        this.element = document.createElement('div');
        this.element.className = 'floating-menu';
        this.element.style.display = 'none';
        ROOT.appendChild(this.element);

        // Simple draggable logic
        this.isDragging = false;
        this.startX = 0;
        this.startY = 0;

        this.element.addEventListener('mousedown', (e) => {
            if (e.target !== this.element && !e.target.classList.contains('floating-menu-header')) return;
            this.isDragging = true;
            this.startX = e.clientX - this.element.offsetLeft;
            this.startY = e.clientY - this.element.offsetTop;
        });

        window.addEventListener('mousemove', (e) => {
            if (this.isDragging) {
                this.element.style.left = (e.clientX - this.startX) + 'px';
                this.element.style.top = (e.clientY - this.startY) + 'px';
            }
        });

        window.addEventListener('mouseup', () => this.isDragging = false);
    }

    show(x, y, content) {
        this.element.innerHTML = content;
        this.element.style.display = 'flex';
        this.element.style.left = x + 'px';
        this.element.style.top = y + 'px';
    }

    hide() {
        this.element.style.display = 'none';
    }
}

const MARKER_UI_SIZE = 15; // User-defined absolute pixel size

/**
 * SCENE OBJECT - Instance of a mesh in the scene
 */
class SceneObject {
    constructor(id, name, geometry, color = 0xcccccc) {
        this.id = id;
        this.name = name || `Mesh ${id}`;
        this.mesh = new HalfEdgeMesh();
        // Only build if geometry has actual data (skip during undo restore)
        if (geometry && geometry.getAttribute('position')) {
            this.mesh.buildFromGeometry(geometry);
        }
        this.displayMesh = null; // THREE.Mesh
        this.color = color;      // display colour (may be a palette fallback for distinction)
        // The colour the FILE actually specified, or null. Kept apart from `color` because the
        // display deliberately substitutes a palette colour for white materials to keep parts
        // apart — that palette colour must never be exported as if it were real data.
        this.sourceColor = null;
        this.visible = true;
        this.isLocked = false;

        // Connected-part ("loose part") cache. Recomputed lazily whenever the mesh is mutated;
        // hiddenParts holds part KEYS (stable face ids), not indices, so hiding survives a
        // re-detection after a neighbouring part was deleted.
        this._parts = null;
        this._faceToPart = null;
        this._partsDirty = true;
        this.hiddenParts = new Set();

        // Per-object transforms. Scale is uniform (one number) and applies from the object's
        // own 0,0,0 origin — a lopsided per-axis scale is never what a mesh prep pass wants.
        this.transforms = {
            rotation: new THREE.Euler(),
            position: new THREE.Vector3(),
            scale: 1
        };
    }
}

class MeshPrepApp {
    constructor() {
        this.container = $id('canvas-container');
        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.controls = null;
        this.grid = null;

        this.mesh = new HalfEdgeMesh();
        this.displayMesh = null;
        this.renderFaceMap = [];
        this.qualityShading = true; // New: High Quality Shading toggle
        this.shadingLights = {
            hemi: null,
            dir: null,
            ambient: null,
            classic: null
        };

        this.undoStack = [];
        this.redoStack = [];
        this.maxUndo = 20;

        this.raycaster = new THREE.Raycaster();
        this.mouse = new THREE.Vector2();
        this.selection = {
            mode: 'view',
            face: null,
            edge: null,
            vertex: null,
            part: null
        };

        // Loose-part selection: KEYS (see findConnectedParts) of the active object's parts.
        this.selectedParts = new Set();
        this.expandedObjects = new Set(); // scene-graph rows expanded to show their parts
        this._hoverPartKey = null;

        this.highlights = new THREE.Group();
        this.persistentHighlights = new THREE.Group();
        this.markers = new THREE.Group(); // New: Color-coded collapse markers
        this.partHighlights = new THREE.Group(); // selected loose parts
        this.partHover = new THREE.Group();      // hovered loose part

        this.floatingMenu = new FloatingMenu();

        // Vertex drag state
        this.drag = {
            active: false,
            vertex: null,
            plane: null,
            snapTarget: null,
            startPos: null,
            didMove: false,
            snapGroup: new THREE.Group()
        };

        this.objects = new Map(); // id -> SceneObject
        this.activeObjectId = null;
        this.objCounter = 0;

        this.init();

        // Cached texture for markers/dots
        this.dotTexture = this.createDotTexture();
    }

    createDotTexture() {
        const canvas = document.createElement('canvas');
        canvas.width = 64; canvas.height = 64;
        const ctx = canvas.getContext('2d');
        ctx.beginPath(); ctx.arc(32, 32, 30, 0, Math.PI * 2);
        ctx.fillStyle = 'white'; ctx.fill();
        return new THREE.CanvasTexture(canvas);
    }

    /** Capture current state as a snapshot (without pushing to any stack) */
    captureSnapshot() {
        const snapshot = {
            activeObjectId: this.activeObjectId,
            objects: []
        };

        this.objects.forEach(obj => {
            snapshot.objects.push({
                id: obj.id,
                name: obj.name,
                color: obj.color,
                sourceColor: obj.sourceColor ? obj.sourceColor.getHex() : null,
                visible: obj.visible,
                hiddenParts: [...obj.hiddenParts],
                transforms: {
                    position: obj.transforms.position.clone(),
                    rotation: obj.transforms.rotation.clone(),
                    scale: obj.transforms.scale ?? 1
                },
                meshData: obj.mesh.serialize()
            });
        });

        return snapshot;
    }

    /** Save current state before a destructive action */
    pushState() {
        this.undoStack.push(this.captureSnapshot());
        this.redoStack = [];
        if (this.undoStack.length > 30) this.undoStack.shift();
        this.updateUndoRedoUI();
    }

    undo() {
        if (this.undoStack.length === 0) return;

        // Save current state for redo BEFORE we restore
        this.redoStack.push(this.captureSnapshot());

        // Pop the pre-action state and restore it
        const prevState = this.undoStack.pop();
        this.applyState(prevState);
    }

    redo() {
        if (this.redoStack.length === 0) return;

        // Save current state for undo BEFORE we restore
        this.undoStack.push(this.captureSnapshot());

        // Pop the redo state and restore it
        const nextState = this.redoStack.pop();
        this.applyState(nextState);
    }

    applyState(snapshot) {
        // Clear current meshes from scene
        this.objects.forEach(obj => {
            if (obj.displayMesh) this.scene.remove(obj.displayMesh);
        });

        // 2. Restore active ID
        this.activeObjectId = snapshot.activeObjectId;

        // 3. Reconstruct
        const newObjects = new Map();
        snapshot.objects.forEach(data => {
            // Reconstruct perfectly from serialized state


            const obj = new SceneObject(data.id, data.name, new THREE.BufferGeometry(), data.color);
            obj.mesh.deserialize(data.meshData);
            obj.visible = data.visible;
            obj.sourceColor = (data.sourceColor === null || data.sourceColor === undefined)
                ? null : new THREE.Color(data.sourceColor);
            obj.hiddenParts = new Set(data.hiddenParts || []);
            obj.transforms.position.copy(data.transforms.position);
            obj.transforms.rotation.copy(data.transforms.rotation);
            obj.transforms.scale = data.transforms.scale ?? 1;

            newObjects.set(obj.id, obj);
        });

        this.objects = newObjects;

        // Ensure active mesh reference is updated
        if (this.activeObjectId !== null && this.objects.has(this.activeObjectId)) {
            this.mesh = this.objects.get(this.activeObjectId).mesh;
        } else {
            this.mesh = new HalfEdgeMesh(); // Empty fallback
        }

        // Clear selection to avoid ghosting
        this.clearSelection();
        this.highlights.clear();
        this.persistentHighlights.clear();
        this.markers.clear();
        this.clearGroup(this.partHighlights);
        this.clearGroup(this.partHover);
        this.floatingMenu.hide();

        // Finalize UI
        this.updateMeshDisplay();
        this.refreshSceneUI();
        this.updateUndoRedoUI();
        this.updateStats();
        this.syncTransformUI();
    }

    updateUndoRedoUI() {
        const btnUndo = $id('btn-undo');
        const btnRedo = $id('btn-redo');
        if (btnUndo) btnUndo.disabled = (this.undoStack.length === 0);
        if (btnRedo) btnRedo.disabled = (this.redoStack.length === 0);
    }

    init() {
        console.log("[MeshPrep] Initializing Mesh Optimizer...");

        // Scene
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x0a0a0a);

        // Camera
        const aspect = this.container.clientWidth / this.container.clientHeight;
        this.camera = new THREE.PerspectiveCamera(45, aspect, 0.1, 1000);
        // Default framing for the empty grid stage (no startup mesh). loadGeometry() re-frames
        // to the model's bounds on import, so this only affects the idle/empty view.
        this.camera.position.set(8, 6, 8);

        // Renderer
        this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
        this.renderer.setSize(this.container.clientWidth, this.container.clientHeight);
        this.renderer.setPixelRatio(window.devicePixelRatio);
        this.container.appendChild(this.renderer.domElement);

        // Controls
        this.controls = new OrbitControls(this.camera, this.renderer.domElement);
        this.controls.enableDamping = true;
        // Wheel zoom is MULTIPLICATIVE towards controls.target, so with the target parked at the
        // model centre every step shrinks as you approach it and you can never reach a detail on
        // the surface — the "zoom hits a wall" effect. zoomToCursor dollies towards whatever is
        // under the pointer and drags the target along, so zooming stays linear-feeling all the
        // way in. minDistance 0 keeps the last bit of travel available.
        this.controls.zoomToCursor = true;
        this.controls.minDistance = 0;

        // Enhanced Lighting
        this.shadingLights.ambient = new THREE.AmbientLight(0xffffff, 0.4);
        this.scene.add(this.shadingLights.ambient);

        this.shadingLights.hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 0.7);
        this.shadingLights.hemi.position.set(0, 20, 0);
        this.scene.add(this.shadingLights.hemi);

        this.shadingLights.dir = new THREE.DirectionalLight(0xffffff, 1.0);
        this.shadingLights.dir.position.set(10, 20, 10);
        this.shadingLights.dir.castShadow = true;
        this.shadingLights.dir.shadow.mapSize.width = 2048;
        this.shadingLights.dir.shadow.mapSize.height = 2048;
        this.scene.add(this.shadingLights.dir);

        // 3-Point Lighting Rig (Key + Fill + Rim)
        this.shadingLights.key = new THREE.DirectionalLight(0xffffff, 1.2);
        this.shadingLights.key.position.set(5, 8, 5);
        this.scene.add(this.shadingLights.key);

        this.shadingLights.fill = new THREE.DirectionalLight(0x8899bb, 0.5);
        this.shadingLights.fill.position.set(-5, 3, -3);
        this.scene.add(this.shadingLights.fill);

        this.shadingLights.rim = new THREE.DirectionalLight(0xaaaaff, 0.4);
        this.shadingLights.rim.position.set(0, 2, -8);
        this.scene.add(this.shadingLights.rim);
        this.lightAngle = 45; // degrees
        this.flatShading = true;
        this.showVertexColors = true;
        // In-game view: render display meshes single-sided (FrontSide) so inverted/inconsistent
        // face winding shows up as see-through holes, exactly as a backface-culling engine renders it.
        // Default off → DoubleSide, which is friendlier for editing/picking inverted faces.
        this.inGameView = false;
        this.updateLightAngle(45);

        // Grid (Standardized Blue Accent)
        this.grid = new THREE.GridHelper(20, 40, 0x3b82f6, 0x222222);
        this.grid.position.y = -0.01; // Avoid Z-fighting with meshes at 0
        this.scene.add(this.grid);

        // Highlights groups
        this.scene.add(this.highlights);
        this.scene.add(this.persistentHighlights);
        this.scene.add(this.markers);
        this.scene.add(this.partHighlights);
        this.scene.add(this.partHover);
        this.scene.add(this.drag.snapGroup);

        // No placeholder mesh on startup — an empty grid reads as a clean "stage" ready for
        // a drop/OPEN. A placeholder ball you can't actually edit just looked broken.

        // Use ResizeObserver for precise container-level resize tracking (immune to sidebar toggles)
        this._resizeObserver = new ResizeObserver(() => this.onWindowResize());
        if (this.container) this._resizeObserver.observe(this.container);
        this.setupUI();
        this.animate();
    }

    /**
     * TEXTURE → VERTEX COLOURS. A textured GLB carries no COLOR_0 attribute, so everything
     * downstream (preview toggle, extended-OBJ export) would arrive as a
     * white blob. Sample the base-colour texture once per vertex UV at load time and store
     * the result as a regular 'color' attribute — from there the existing vertex-colour
     * pipeline takes over unchanged. Values are stored in linear working space
     * (× baseColorFactor), exactly like GLTFLoader delivers real COLOR_0; the OBJ exporter
     * re-encodes to sRGB on the way out.
     */
    bakeTextureToVertexColors(geo, material) {
        if (geo.attributes.color) return false; // real vertex colours win over the texture
        const tex = material && material.map;   // multi-material arrays: first material, same as sourceColor
        const uv = geo.attributes.uv;
        const img = tex && tex.image;
        if (!tex || tex.isCompressedTexture || !uv || !img || !img.width || !img.height) return false;

        // Vertex colours are per-vertex anyway — sampling a ≤2K copy loses nothing but keeps
        // getImageData off 8K textures (that would be a 268 MB allocation).
        const scale = Math.min(1, 2048 / Math.max(img.width, img.height));
        const w = Math.max(1, Math.round(img.width * scale));
        const h = Math.max(1, Math.round(img.height * scale));
        let data;
        try {
            const canvas = document.createElement('canvas');
            canvas.width = w; canvas.height = h;
            const ctx = canvas.getContext('2d', { willReadFrequently: true });
            ctx.drawImage(img, 0, 0, w, h);
            data = ctx.getImageData(0, 0, w, h).data;
        } catch (err) {
            console.warn('[MeshPrep] Texture not readable for vertex-colour bake:', err);
            return false;
        }

        tex.updateMatrix(); // fold offset/repeat/rotation (KHR_texture_transform) into tex.matrix
        const base = material.color || new THREE.Color(1, 1, 1); // baseColorFactor, already linear
        const colors = new Float32Array(uv.count * 3);
        const p = new THREE.Vector2();
        const c = new THREE.Color();
        for (let i = 0; i < uv.count; i++) {
            p.fromBufferAttribute(uv, i).applyMatrix3(tex.matrix);
            const u = tex.wrapS === THREE.ClampToEdgeWrapping ? Math.min(Math.max(p.x, 0), 1) : p.x - Math.floor(p.x);
            let v = tex.wrapT === THREE.ClampToEdgeWrapping ? Math.min(Math.max(p.y, 0), 1) : p.y - Math.floor(p.y);
            if (tex.flipY) v = 1 - v; // glTF textures are flipY=false → v already runs top-down
            const o = (Math.min(h - 1, Math.floor(v * h)) * w + Math.min(w - 1, Math.floor(u * w))) * 4;
            c.setRGB(data[o] / 255, data[o + 1] / 255, data[o + 2] / 255, THREE.SRGBColorSpace);
            colors[i * 3] = c.r * base.r;
            colors[i * 3 + 1] = c.g * base.g;
            colors[i * 3 + 2] = c.b * base.b;
        }
        geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        return true;
    }

    async loadGeometry(bufferGeometry, originalObject = null) {
        console.log("[MeshPrep] Loading Geometry Hierarchy...");
        // Reset undo/redo on new file load (can't undo back to previous file)
        this.undoStack = [];
        this.redoStack = [];

        // Reset scene
        this.objects.forEach(obj => {
            if (obj.displayMesh) this.scene.remove(obj.displayMesh);
            this.disposePartGeometries(obj._parts);
        });
        this.objects.clear();
        this.expandedObjects.clear();
        this.selectedParts.clear();
        this.clearGroup(this.partHighlights);
        this.clearGroup(this.partHover);
        this._hoverPartKey = null;
        this.objCounter = 0;
        this.activeObjectId = null;

        // Traverse hierarchy
        const meshes = [];
        if (originalObject) {
            originalObject.updateMatrixWorld(true);
            originalObject.traverse(child => {
                if (child.isMesh) {
                    const geo = child.geometry.clone();
                    geo.applyMatrix4(child.matrixWorld);
                    child.__bakedGeo = geo;
                    meshes.push(child);
                }
            });
        } else {
            // Static geometry provided (e.g. from Drag & Drop)
            const tempMesh = new THREE.Mesh(bufferGeometry);
            meshes.push(tempMesh);
        }

        if (meshes.length === 0) {
            console.error("[MeshPrep] No meshes found in file.");
            return;
        }

        // Create SceneObjects
        for (const m of meshes) {
            const id = this.objCounter++;
            // NOT "Part N" — that now means a connected part INSIDE an object (see LOOSE PARTS).
            const name = m.name || `Mesh ${id + 1}`;

            // Generate a random-ish color if not present
            const colors = [0x38bdf8, 0xf87171, 0x4ade80, 0xfacc15, 0xc084fc, 0xf472b6];
            let color = colors[id % colors.length];

            // Try extracting material color
            const mat = Array.isArray(m.material) ? m.material[0] : m.material;
            let sourceColor = null;
            if (mat && mat.color) {
                sourceColor = mat.color.clone(); // remembered verbatim — this is what gets exported
                // Ignore raw white defaults to keep colorful UI distinctions
                if (mat.color.r < 0.99 || mat.color.g < 0.99 || mat.color.b < 0.99) {
                    color = mat.color.getHex();
                }
            }

            const geo = m.__bakedGeo || m.geometry;
            if (this.bakeTextureToVertexColors(geo, mat)) {
                console.log(`[MeshPrep] "${name}": baked texture → vertex colours.`);
            }
            const obj = new SceneObject(id, name, geo, color);
            obj.sourceColor = sourceColor;
            this.objects.set(id, obj);

            if (this.activeObjectId === null) this.activeObjectId = id;
        }

        console.log(`[MeshPrep] Scene loaded with ${this.objects.size} objects.`);

        // CRITICAL: Sync this.mesh to the active SceneObject's mesh
        if (this.activeObjectId !== null && this.objects.has(this.activeObjectId)) {
            this.mesh = this.objects.get(this.activeObjectId).mesh;
        }

        // Auto-repair winding on import: unify face winding + orient outward on EVERY object,
        // so inverted faces don't show as see-through holes in-game. Per-object because a
        // multi-material GLB imports as several objects.
        const rep = this.repairAllWinding();
        if (rep.totalFlips > 0 || rep.nonManifold > 0) {
            let msg = `[MeshPrep] Auto-repair: ${rep.totalFlips} face(s) flipped across ${rep.count} object(s).`;
            if (rep.nonManifold > 0) msg += ` ${rep.nonManifold} non-manifold edge(s) remain (doubled/overlapping geometry) — clean the source if holes persist.`;
            console.log(msg);
        }

        this.updateMeshDisplay();
        this.updateStats();
        this.refreshSceneUI();
        this.syncTransformUI();

        // Centralize camera
        const bbox = new THREE.Box3();
        this.objects.forEach(obj => {
            if (obj.displayMesh) bbox.expandByObject(obj.displayMesh);
        });
        const center = bbox.getCenter(new THREE.Vector3());
        const size = bbox.getSize(new THREE.Vector3());

        const maxDim = Math.max(size.x, size.y, size.z, 10); // Minimum scale floor
        
        // Dynamically adjust camera clipping to prevent large meshes from turning black/disappearing.
        // The near plane is the OTHER half of the zoom-limit problem: at maxDim*0.001 a 200-unit
        // model clips everything closer than 0.2 units, so close-ups vanish. Floor it well below
        // anything you'd inspect, but never below 0.001 (depth precision).
        this.camera.near = Math.max(maxDim * 0.0002, 0.001);
        this.camera.far = maxDim * 20;
        this.camera.updateProjectionMatrix();

        // Position camera to fit the bounding box
        this.camera.position.set(center.x + maxDim, center.y + maxDim, center.z + maxDim);
        this.controls.target.copy(center);
        
        // Scale directional light shadow camera to cover the new bounds
        if (this.shadingLights.dir) {
            this.shadingLights.dir.shadow.camera.left = -maxDim;
            this.shadingLights.dir.shadow.camera.right = maxDim;
            this.shadingLights.dir.shadow.camera.top = maxDim;
            this.shadingLights.dir.shadow.camera.bottom = -maxDim;
            this.shadingLights.dir.shadow.camera.updateProjectionMatrix();
        }

        this.controls.update();
    }

    updateMeshDisplay() {
        const showWire = $id('view-wire')?.checked ?? true;
        const showQuality = $id('view-quality')?.checked ?? false;

        this.renderFaceMap = []; // Reset global map for active mesh raycasting

        this.objects.forEach(obj => {
            if (obj.displayMesh) {
                this.scene.remove(obj.displayMesh);
                obj.displayMesh = null;
            }

            if (!obj.visible) return;

            const isActive = obj.id === this.activeObjectId;
            const skipFace = this.partFilterFor(obj); // hidden loose parts
            let geometry;
            let material;

            if (showQuality && isActive) {
                geometry = obj.mesh.toQualityGeometry(this.renderFaceMap, skipFace);
                material = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide });
            } else {
                geometry = obj.mesh.generateBufferGeometry(isActive ? this.renderFaceMap : null, skipFace);

                // Render every part OPAQUE. A model usually imports as several material-objects
                // (this GLB = 4), and dimming the non-active ones to 0.4 made half the model look
                // "semi-transparent". transparent:true also caused alpha depth-sort FLICKER with
                // DoubleSide as front/back faces re-sorted on rotation. The active object is already
                // marked by its wireframe overlay, so no opacity trick is needed.
                // DoubleSide (default) shows + lets the raycaster pick every face regardless of
                // winding; Single-sided view flips to FrontSide so winding holes appear exactly as a
                // backface-culling engine renders them.
                const side = this.inGameView ? THREE.FrontSide : THREE.DoubleSide;
                // Painted GLBs carry their colour per vertex. Show it (white base × vertex
                // colour) instead of the flat per-object colour, so the preview matches what
                // the exported file will actually look like. The toggle falls back to flat colours.
                const useVC = this.showVertexColors && obj.mesh.hasVertexColors;
                const baseColor = useVC ? 0xffffff : obj.color;
                if (this.qualityShading) {
                    material = new THREE.MeshStandardMaterial({
                        color: baseColor,
                        vertexColors: useVC,
                        roughness: 0.35,
                        metalness: 0.05,
                        flatShading: this.flatShading,
                        side: side
                    });
                } else {
                    material = new THREE.MeshPhongMaterial({
                        color: baseColor,
                        vertexColors: useVC,
                        shininess: 40,
                        flatShading: this.flatShading,
                        side: side
                    });
                }
            }

            geometry.computeVertexNormals();
            const mesh = new THREE.Mesh(geometry, material);
            mesh.castShadow = true;
            mesh.receiveShadow = true;

            mesh.rotation.copy(obj.transforms.rotation);
            mesh.position.copy(obj.transforms.position);
            mesh.scale.setScalar(obj.transforms.scale ?? 1);

            this.scene.add(mesh);
            obj.displayMesh = mesh;

            // Wireframe
            if (showWire && isActive) {
                const wireframe = new THREE.LineSegments(
                    new THREE.WireframeGeometry(geometry),
                    new THREE.LineBasicMaterial({ color: 0x000000, opacity: 0.4, transparent: true })
                );
                mesh.add(wireframe);
            }
        });

        if (this.controls) this.controls.update();
    }

    // Repair face winding on EVERY object and return an aggregate summary. A multi-material
    // GLB imports as several objects and the half-edge winding fix is per-object, so this loops
    // them all (the single-object RECALC was why fixing one material left the rest see-through).
    repairAllWinding() {
        let totalFlips = 0, nonManifold = 0, openShell = 0, count = 0;
        for (const obj of this.objects.values()) {
            const r = obj.mesh.recalcNormals();
            if (r && r.ok) {
                count++;
                totalFlips += r.flips || 0;
                if (r.nonManifold > 0) nonManifold += r.nonManifold;
                if (!r.oriented) openShell++;
            }
        }
        return { count, totalFlips, nonManifold, openShell };
    }

    updateShading() {
        const shadingToggle = $id('view-shading');
        this.qualityShading = shadingToggle ? shadingToggle.checked : true;

        if (this.shadingLights.hemi) this.shadingLights.hemi.visible = true;
        if (this.shadingLights.dir) this.shadingLights.dir.visible = this.qualityShading;

        // Update renderer shadow handling
        this.renderer.shadowMap.enabled = this.qualityShading;

        this.updateMeshDisplay();
    }

    updateLightAngle(degrees) {
        this.lightAngle = degrees;
        const rad = degrees * Math.PI / 180;
        const r = 10; // orbit radius

        // Key light (main): at the specified angle
        if (this.shadingLights.key) {
            this.shadingLights.key.position.set(
                Math.cos(rad) * r,
                8,
                Math.sin(rad) * r
            );
        }

        // Fill light: offset 135° from key, lower intensity, lower height
        if (this.shadingLights.fill) {
            const fillRad = rad + Math.PI * 0.75;
            this.shadingLights.fill.position.set(
                Math.cos(fillRad) * r * 0.6,
                3,
                Math.sin(fillRad) * r * 0.6
            );
        }

        // Rim light: offset 255° from key, behind the model
        if (this.shadingLights.rim) {
            const rimRad = rad + Math.PI * 1.42;
            this.shadingLights.rim.position.set(
                Math.cos(rimRad) * r * 0.8,
                2,
                Math.sin(rimRad) * r * 0.8
            );
        }
    }

    updateStats() {
        const statsEl = $id('mesh-stats');
        const obj = this.activeObject;
        if (!statsEl || !obj) {
            if (statsEl) statsEl.innerHTML = "No mesh selected";
            return;
        }

        const faces = obj.mesh.faces.filter(f => !f.isDeleted).length;
        const vertices = obj.mesh.vertices.filter(v => !v.isDeleted).length;
        const openEdges = obj.mesh.validateTopology(); // returns a number, not an array

        let slivers = 0;
        obj.mesh.faces.forEach(f => {
            if (f.isDeleted) return;
            const he = f.halfEdge;
            const a1 = obj.mesh.calculateAngle(he.prev.vertex.position, he.vertex.position, he.next.vertex.position);
            const a2 = obj.mesh.calculateAngle(he.vertex.position, he.next.vertex.position, he.prev.vertex.position);
            const a3 = obj.mesh.calculateAngle(he.next.vertex.position, he.prev.vertex.position, he.vertex.position);
            if (Math.min(a1, a2, a3) < 5.0) slivers++;
        });

        // Loose parts are only shown once known — never trigger an analysis from the stats line.
        const parts = (obj._parts && !obj._partsDirty) ? obj._parts.length : null;
        const partsInfo = parts === null ? '' :
            ` · <span style="color: ${parts > 1 ? 'var(--accent-warm-text)' : 'inherit'}"><b>Parts:</b> ${parts}</span>`;

        statsEl.innerHTML = `
            <b>F:</b> ${faces} · <b>V:</b> ${vertices} ·
            <span style="color: ${openEdges > 0 ? 'var(--danger-text)' : 'inherit'}"><b>Open:</b> ${openEdges}</span> ·
            <span style="color: ${slivers > 0 ? 'var(--danger-text)' : 'inherit'}"><b>Slivers:</b> ${slivers}</span>${partsInfo}
        `;
    }

    calculateAngle(p1, p2, p3) {
        const v1 = new THREE.Vector3().subVectors(p1, p2).normalize();
        const v2 = new THREE.Vector3().subVectors(p3, p2).normalize();
        return Math.acos(Math.max(-1, Math.min(1, v1.dot(v2)))) * (180 / Math.PI);
    }

    setupUI() {
        const safeListen = (id, event, callback) => {
            const el = $id(id);
            if (el) el.addEventListener(event, callback);
        };

        safeListen('file-input', 'change', (e) => this.handleFile(e));
        safeListen('btn-undo', 'click', () => this.undo());
        safeListen('btn-redo', 'click', () => this.redo());
        safeListen('btn-export', 'click', () => this.exportMesh());
        safeListen('btn-export-gltf', 'click', () => this.exportGltf());

        const toolGroup = $id('tool-group-selectors');
        if (toolGroup) {
            toolGroup.addEventListener('sac:change', (e) => {
                this.setSelectMode(e.detail.value);
            });
        }

        if (this.container) {
            this.container.addEventListener('mousemove', (e) => this.onMouseMove(e));
            this.container.addEventListener('mousedown', (e) => this.onMouseDown(e));
            this.container.addEventListener('mouseup', (e) => this.onMouseUp(e));
            this.container.addEventListener('click', (e) => this.onMouseClick(e));
        }

        window.addEventListener('keydown', (e) => {
            if (!IS_VISIBLE()) return; // a hidden view on a desktop must not answer another app's keys
            // Never hijack typing: without this, "v" in a rotation field switched to View Mode and
            // DEL in the part-threshold field deleted geometry. composedPath()[0] sees through the
            // shadow DOM of the kit components.
            const target = (e.composedPath && e.composedPath()[0]) || e.target;
            if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;

            if (e.ctrlKey && e.key.toLowerCase() === 'z') {
                if (e.shiftKey) this.redo();
                else this.undo();
            }
            if (e.ctrlKey && e.key.toLowerCase() === 'y') {
                this.redo();
            }
            if (e.key.toLowerCase() === 'v') this.setSelectMode('view');
            if (e.key === '1') this.setSelectMode('face');
            if (e.key === '2') this.setSelectMode('edge');
            if (e.key === '3') this.setSelectMode('vertex');
            if (e.key === '4') this.setSelectMode('part');
            if (e.key === 'Escape') this.clearSelection(); // global deselect
            if (e.key.toLowerCase() === 'f' && this.selection.part) this.focusPart(this.selection.part);

            if (e.key === 'Delete' || e.key === 'Backspace') {
                // Parts win whenever any are selected — they're visibly highlighted, so there's
                // no ambiguity about what DEL is about to remove.
                if (this.selectedParts.size) { this.deleteSelectedParts(); return; }
                if (this.selection.mode === 'edge') this.collapseSelectedEdge('CENTER');
                if (this.selection.mode === 'face' && this.selection.face) {
                    const face = this.selection.face;
                    const fh = face.halfEdge;
                    const fp1 = fh.prev.vertex.position;
                    const fp2 = fh.vertex.position;
                    const fp3 = fh.next.vertex.position;
                    const fa1 = this.calculateAngle(fp2, fp1, fp3);
                    const fa2 = this.calculateAngle(fp1, fp2, fp3);
                    const fa3 = this.calculateAngle(fp1, fp3, fp2);
                    const fmin = Math.min(fa1, fa2, fa3);
                    if (fmin < 15) {
                        if (fa1 <= fa2 && fa1 <= fa3) this.collapseSelectedFace('V1');
                        else if (fa2 <= fa1 && fa2 <= fa3) this.collapseSelectedFace('V2');
                        else this.collapseSelectedFace('V3');
                    } else {
                        this.collapseSelectedFace('CENTER');
                    }
                }
            }
        });

        safeListen('view-wire', 'sac:change', () => this.updateMeshDisplay());
        safeListen('view-quality', 'sac:change', () => this.updateMeshDisplay());
        safeListen('view-shading', 'sac:change', () => this.updateShading());
        safeListen('view-flat', 'sac:change', (e) => {
            this.flatShading = e.detail.value;
            this.updateMeshDisplay();
        });
        safeListen('view-ingame', 'sac:change', (e) => {
            this.inGameView = e.detail.value;
            this.updateMeshDisplay();
        });
        safeListen('view-vertex-colors', 'sac:change', (e) => {
            this.showVertexColors = e.detail.value;
            this.updateMeshDisplay();
        });

        const lightSlider = $id('light-angle-slider');
        if (lightSlider) {
            lightSlider.addEventListener('sac:input', (e) => {
                this.updateLightAngle(parseInt(e.detail.value));
            });
        }

        // Window Toggles (Standardized)
        const toggleWin = (btnId, winId) => {
            const btn = $id(btnId);
            const win = $id(winId);
            if (btn && win) {
                btn.addEventListener('click', () => {
                    if (typeof win.toggle === 'function') win.toggle();
                    else win.style.display = win.style.display === 'none' ? 'block' : 'none';
                });
            }
        };

        toggleWin('toolbar-help', 'window-help');
        toggleWin('toolbar-logs', 'window-logs');
        toggleWin('toolbar-scene', 'window-scene');
        toggleWin('toolbar-transforms', 'window-transforms');

        // Optimization UI
        const angleSlider = $id('planar-angle-slider');
        const angleVal = $id('planar-angle-val');
        if (angleSlider && angleVal) {
            angleSlider.addEventListener('input', () => {
                angleVal.innerText = angleSlider.value;
            });
        }

        safeListen('btn-slim-mesh', 'click', () => this.slimMesh());

        const qemSlider = $id('qem-reduction-slider');
        if (qemSlider) {
            qemSlider.addEventListener('input', (e) => {
                // Internal value display handled by component
            });
        }

        safeListen('btn-merge-all', 'click', () => { this.mergeAllObjects(); });

        safeListen('btn-qem-mesh', 'click', async () => {
            this.bakeTransforms();
            await this.qemSimplify();
        });

        // Engine selector: swap the hint and show the Density Balance slider only for QEM.
        const engineSel = $id('simplify-engine');
        const engineHint = $id('engine-hint');
        const densityWrap = $id('density-balance-wrap');
        const syncEngineUI = () => {
            const engine = engineSel?.value || 'density';
            const isDensity = engine === 'density';
            if (densityWrap) densityWrap.style.display = isDensity ? '' : 'none';
            if (engineHint) engineHint.textContent = isDensity
                ? 'Adaptive QEM — collapses nearby points & evens out over-dense areas.'
                : 'meshoptimizer (WASM) — highest quality, preserves form & sharp edges.';
        };
        if (engineSel) engineSel.addEventListener('sac:change', syncEngineUI);
        syncEngineUI();

        safeListen('btn-deselect-all', 'click', () => this.clearSelection());

        // --- Loose Parts (connected mesh groups) ---
        safeListen('btn-analyse-parts', 'click', () => {
            const obj = this.activeObject;
            if (!obj) { console.warn('[MeshPrep] No mesh loaded.'); return; }
            const t0 = performance.now();
            obj._partsDirty = true;
            const parts = this.getParts(obj, { force: true });
            this.expandedObjects.add(obj.id);
            this.refreshSceneUI();
            this.updateStats(); // the HUD only shows "Parts: N" once they're actually known
            console.log(`[MeshPrep] "${obj.name}": ${parts.length} connected part(s) — largest ${parts[0]?.faceCount.toLocaleString() ?? 0} faces, smallest ${parts[parts.length - 1]?.faceCount.toLocaleString() ?? 0} (${(performance.now() - t0).toFixed(0)} ms).`);
        });
        safeListen('btn-split-parts', 'click', () => this.splitPartsToObjects());
        safeListen('btn-keep-largest', 'click', () => this.keepLargestPart());
        safeListen('btn-delete-tiny', 'click', () => {
            const n = parseInt($id('parts-min-faces')?.value, 10);
            this.deleteTinyParts(Number.isFinite(n) && n > 0 ? n : 10);
        });

        safeListen('btn-fill-holes', 'click', () => {
            const obj = this.activeObject;
            if (!obj) return;
            this.pushState();
            const before = obj.mesh.validateTopology();
            obj.mesh.sealHoles();
            const after = obj.mesh.validateTopology();
            if (after < before) {
                this.markPartsDirty(obj);
                this.updateMeshDisplay();
                this.updateStats();
                this.refreshSceneUI();
                console.log(`[MeshPrep] Fill Holes: ${before} → ${after} open edges.`);
            } else {
                this.undoStack.pop(); // Nothing changed
                console.log(`[MeshPrep] Fill Holes: No holes found.`);
            }
        });

        safeListen('btn-recalc-normals', 'click', () => {
            if (!this.objects.size) return;
            this.pushState();
            const r = this.repairAllWinding();   // ALL objects, not just the active one
            // recalcNormals() rebuilds the half-edge structure from scratch → new face ids,
            // so part keys (and any hide state keyed on them) can't carry over.
            this.markAllPartsDirty({ resetHidden: true });
            this.updateMeshDisplay();
            this.updateStats();
            this.refreshSceneUI();
            let msg = `[MeshPrep] Recalc: ${r.totalFlips} face(s) flipped across ${r.count} object(s), winding unified outward.`;
            if (r.nonManifold > 0) msg += ` ⚠ ${r.nonManifold} non-manifold edge(s) (shared by >2 faces — doubled/overlapping geometry) couldn't be fully resolved; clean the source (Remove Duplicates) or simplify.`;
            if (r.openShell > 0) msg += ` ${r.openShell} open shell(s): "outward" undefined, orientation left as-is.`;
            console.log(msg);
            if (!this.inGameView) console.log('[MeshPrep] Tip: toggle "Single-sided view" to verify the result the way a backface-culling engine renders it.');
        });

        // Transforms UI
        const transformInputs = ['rot-x', 'rot-y', 'rot-z', 'pos-x', 'pos-y', 'pos-z', 'scale-uniform'];
        transformInputs.forEach(id => {
            safeListen(id, 'focus', () => this.pushState());
            safeListen(id, 'input', () => this.updateTransforms());
        });

        safeListen('btn-reset-transforms', 'click', () => {
            this.pushState();
            transformInputs.forEach(id => {
                const el = $id(id);
                if (el) el.value = (id === 'scale-uniform') ? 1 : 0;
            });
            this.updateTransforms();
        });

        // Quick scale multipliers — the usual "this model imported 100× too big/small" fix.
        ROOT.querySelectorAll('[data-scale-mul]').forEach(btn => {
            btn.addEventListener('click', () => {
                const el = $id('scale-uniform');
                if (!el || !this.activeObject) return;
                this.pushState();
                const cur = parseFloat(el.value) || 1;
                el.value = +(cur * parseFloat(btn.dataset.scaleMul)).toPrecision(6);
                this.updateTransforms();
            });
        });
    }

    get activeObject() {
        return this.objects.get(this.activeObjectId);
    }

    // The scene-graph rows report their HTML id, which is ALWAYS a string ("0"), while
    // this.objects is a Map keyed by NUMBER. objects.get("0") silently returned undefined, so
    // select / colour / visibility / delete from the graph all did nothing. Parse every id here.
    // Loose-part rows use "p:<objId>:<partKey>" and are routed separately.
    parseGraphId(raw) {
        const s = String(raw ?? '').replace(/^mo-/, '');
        if (s.startsWith('p:')) {
            const [, objId, key] = s.split(':');
            return { type: 'part', objId: Number(objId), key: Number(key) };
        }
        return { type: 'object', objId: Number(s) };
    }

    /** Selection bar above the scene graph — the global "what is selected / drop it" control. */
    refreshSelectionBar() {
        const info = $id('graph-sel-info');
        const btn = $id('btn-deselect-all');
        if (!info || !btn) return;
        const n = this.selectedParts.size;
        const sub = this.selection.face ? 'face' : this.selection.edge ? 'edge' : this.selection.vertex ? 'vertex' : null;
        if (n) {
            const faces = [...this.selectedParts].map(k => this.partByKey(k)).filter(Boolean)
                .reduce((s, p) => s + p.faceCount, 0);
            info.textContent = `${n} part${n === 1 ? '' : 's'} selected · ${faces.toLocaleString()} faces`;
        } else {
            info.textContent = sub ? `1 ${sub} selected` : 'Nothing selected';
        }
        btn.disabled = !n && !sub;
    }

    refreshSceneUI() {
        const container = $id('scene-graph');
        this.refreshPartsPanel();
        this.refreshSelectionBar();
        if (!container) return;

        if (this.objects.size === 0) {
            container.innerHTML = `<div class="item-label" style="opacity: 0.5; text-align: center; margin-top: 20px;">No meshes loaded</div>`;
            this.attachSceneGraphListeners(container);
            return;
        }

        container.innerHTML = '';
        this.objects.forEach(obj => {
            const isActive = obj.id === this.activeObjectId;
            const parts = this.getParts(obj);
            const item = document.createElement('sac-scene-item');
            const partLabel = parts.length > 1 ? ` · ${parts.length} parts` : ''; // labels are text, not HTML
            item.setAttribute('label', `${obj.name}${partLabel}`);
            item.setAttribute('id', `mo-${obj.id}`);
            if (obj.visible) item.setAttribute('visible', '');
            if (isActive) item.setAttribute('active', '');
            item.setAttribute('can-delete', '');
            item.setAttribute('color', `#${obj.color.toString(16).padStart(6, '0')}`);
            // Keep the chevron even before the parts are known, so a heavy mesh can be expanded
            // on demand instead of being analysed on every refresh.
            item.setAttribute('expandable', '');
            if (this.expandedObjects.has(obj.id)) item.setAttribute('expanded', '');

            // Nested rows: the connected mesh groups inside this one object.
            if (this.expandedObjects.has(obj.id)) {
                const list = this.getParts(obj, { force: true });
                const MAX_ROWS = 200; // a 900-island junk import must not build 900 DOM rows
                list.slice(0, MAX_ROWS).forEach(p => {
                    const row = document.createElement('sac-scene-item');
                    row.setAttribute('label', `Part ${p.index + 1} · ${p.faceCount.toLocaleString()} f`);
                    row.setAttribute('id', `mo-p:${obj.id}:${p.key}`);
                    if (!obj.hiddenParts.has(p.key)) row.setAttribute('visible', '');
                    if (isActive && this.selectedParts.has(p.key)) row.setAttribute('active', '');
                    row.setAttribute('can-delete', '');
                    item.appendChild(row);
                });
                if (list.length > MAX_ROWS) {
                    const more = document.createElement('div');
                    more.className = 'item-label';
                    more.style.cssText = 'opacity:.5; font-size:.65rem; padding:4px 8px;';
                    more.textContent = `+ ${list.length - MAX_ROWS} more — use the Loose Parts actions`;
                    item.appendChild(more);
                }
            }

            // Children must exist BEFORE the element is connected: sac-scene-item decides on
            // its chevron/slot layout in connectedCallback.
            container.appendChild(item);
        });

        this.attachSceneGraphListeners(container);
    }

    attachSceneGraphListeners(container) {
        if (this._sceneListenersAttached) return;

        container.addEventListener('sac:select', (e) => {
            const ref = this.parseGraphId(e.detail.id);
            if (ref.type === 'part') {
                if (ref.objId !== this.activeObjectId) this.setActiveObject(ref.objId);
                const part = this.partByKey(ref.key);
                if (part) this.selectPart(part, { additive: e.detail.additive, range: e.detail.range });
                return;
            }
            this.setActiveObject(ref.objId);
        });

        container.addEventListener('sac:expand', (e) => {
            const ref = this.parseGraphId(e.detail.id);
            if (ref.type !== 'object') return;
            if (e.detail.expanded) this.expandedObjects.add(ref.objId);
            else this.expandedObjects.delete(ref.objId);
            this.refreshSceneUI();
        });

        container.addEventListener('sac:visibility', (e) => {
            const ref = this.parseGraphId(e.detail.id);
            if (ref.type === 'part') {
                if (ref.objId !== this.activeObjectId) this.setActiveObject(ref.objId);
                this.togglePartVisibility(ref.key);
                return;
            }
            const obj = this.objects.get(ref.objId);
            if (obj) {
                this.pushState();
                obj.visible = e.detail.visible;
                this.updateMeshDisplay();
                this.refreshSceneUI();
            }
        });

        container.addEventListener('sac:recolor', (e) => {
            const ref = this.parseGraphId(e.detail.id);
            const obj = this.objects.get(ref.objId);
            if (obj) {
                this.pushState();
                obj.color = parseInt(e.detail.color.replace('#', ''), 16);
                // Picking a colour by hand is explicit intent → it becomes the exported colour.
                obj.sourceColor = new THREE.Color(obj.color);
                this.updateMeshDisplay();
            }
        });

        container.addEventListener('sac:delete', (e) => {
            const ref = this.parseGraphId(e.detail.id);
            if (ref.type === 'part') {
                if (ref.objId !== this.activeObjectId) this.setActiveObject(ref.objId);
                this.selectedParts = new Set([ref.key]);
                this.deleteSelectedParts();
                return;
            }
            const obj = this.objects.get(ref.objId);
            if (obj) {
                this.pushState();
                if (obj.displayMesh) this.scene.remove(obj.displayMesh);
                this.objects.delete(obj.id);
                this.expandedObjects.delete(obj.id);
                this.disposePartGeometries(obj._parts);
                if (this.activeObjectId === obj.id) {
                    this.activeObjectId = this.objects.keys().next().value ?? null;
                    this.mesh = this.activeObject ? this.activeObject.mesh : new HalfEdgeMesh();
                    this.selectedParts.clear();
                    this.clearGroup(this.partHighlights);
                }
                this.updateMeshDisplay();
                this.refreshSceneUI();
                this.updateStats();
            }
        });

        // Clicking dead space in the graph (not on a row) drops the selection, like a file list.
        container.addEventListener('click', (e) => {
            if (!e.target.closest || !e.target.closest('sac-scene-item')) this.clearSelection();
        });

        // Hovering a part row lights that mesh group up in the viewport — the whole point of
        // listing them: you see WHICH lump of geometry the row means before you delete it.
        container.addEventListener('mouseover', (e) => {
            const row = e.target.closest && e.target.closest('sac-scene-item');
            if (!row) return;
            const ref = this.parseGraphId(row.id);
            if (ref.type !== 'part' || ref.objId !== this.activeObjectId) { this.hoverPart(null); return; }
            this.hoverPart(ref.key);
        });
        container.addEventListener('mouseleave', () => this.hoverPart(null));

        this._sceneListenersAttached = true;
    }

    // Switch the ACTIVE object (from the scene list or a viewport click). NOTE: this was
    // previously also named selectObject(), which collided with the face/edge/vertex
    // selectObject(hit,...) below — the second definition silently overrode this one, so
    // switching the active object did nothing and multi-part meshes were uneditable.
    setActiveObject(id) {
        id = Number(id); // scene-graph rows hand back strings — see parseGraphId()
        if (Number.isNaN(id) || id === this.activeObjectId) return;
        const obj = this.objects.get(id);
        if (!obj) return;
        this.activeObjectId = id;
        this.mesh = obj.mesh; // sync this.mesh to the active SceneObject's mesh
        this.selectedParts.clear();
        this.selection.part = null;
        this._hoverPartKey = null;
        this.clearGroup(this.partHighlights);
        this.clearGroup(this.partHover);
        this.clearSelection();
        this.refreshSceneUI();
        this.updateStats();
        this.syncTransformUI();
        this.updateMeshDisplay();
    }

    syncTransformUI() {
        const obj = this.activeObject;
        if (!obj) return;

        $id('rot-x').value = Math.round(THREE.MathUtils.radToDeg(obj.transforms.rotation.x));
        $id('rot-y').value = Math.round(THREE.MathUtils.radToDeg(obj.transforms.rotation.y));
        $id('rot-z').value = Math.round(THREE.MathUtils.radToDeg(obj.transforms.rotation.z));
        $id('pos-x').value = obj.transforms.position.x.toFixed(2);
        $id('pos-y').value = obj.transforms.position.y.toFixed(2);
        $id('pos-z').value = obj.transforms.position.z.toFixed(2);
        const scaleEl = $id('scale-uniform');
        if (scaleEl) scaleEl.value = (obj.transforms.scale ?? 1).toFixed(3).replace(/\.?0+$/, '');
        this.updateScaleReadout();
    }

    updateTransforms() {
        const obj = this.activeObject;
        if (!obj || !obj.displayMesh) return;

        const rx = THREE.MathUtils.degToRad(parseFloat($id('rot-x').value) || 0);
        const ry = THREE.MathUtils.degToRad(parseFloat($id('rot-y').value) || 0);
        const rz = THREE.MathUtils.degToRad(parseFloat($id('rot-z').value) || 0);

        const px = parseFloat($id('pos-x').value) || 0;
        const py = parseFloat($id('pos-y').value) || 0;
        const pz = parseFloat($id('pos-z').value) || 0;

        // Uniform only, applied from the object's own 0,0,0 origin (THREE.Mesh.scale is
        // object-space), so the model grows evenly in every direction instead of shearing.
        let s = parseFloat($id('scale-uniform')?.value);
        if (!Number.isFinite(s) || s <= 0) s = 1;

        obj.transforms.rotation.set(rx, ry, rz);
        obj.transforms.position.set(px, py, pz);
        obj.transforms.scale = s;

        obj.displayMesh.rotation.copy(obj.transforms.rotation);
        obj.displayMesh.position.copy(obj.transforms.position);
        obj.displayMesh.scale.setScalar(s);

        // Highlights are drawn in scene space — keep them glued to the object.
        this.refreshPartHighlights();
        this.hoverPart(null);
        this.updateScaleReadout();
    }

    /** Show what the uniform scale actually does to the model's real-world size. */
    updateScaleReadout() {
        const el = $id('scale-readout');
        const obj = this.activeObject;
        if (!el) return;
        if (!obj || !obj.displayMesh) { el.textContent = ''; return; }
        const box = new THREE.Box3().setFromObject(obj.displayMesh);
        const size = box.getSize(new THREE.Vector3());
        el.textContent = `Size: ${size.x.toFixed(2)} × ${size.y.toFixed(2)} × ${size.z.toFixed(2)}`;
    }

    bakeTransforms() {
        const obj = this.activeObject;
        if (!obj) return;

        // Only bake if there are actual transforms
        const t = obj.transforms;
        if (t.rotation.x === 0 && t.rotation.y === 0 && t.rotation.z === 0 &&
            t.position.x === 0 && t.position.y === 0 && t.position.z === 0 &&
            (t.scale ?? 1) === 1) {
            return;
        }

        console.log(`[MeshPrep] Baking transforms into mesh: ${obj.name}`);
        this.pushState();
        this.applyBakeMatrix(obj);
        this.syncTransformUI();
        this.updateMeshDisplay();
    }

    slimMesh() {
        // Deprecated
    }

    async qemSimplify() {
        const obj = this.activeObject;
        if (!obj) return;

        const reductionPercent = parseFloat($id('qem-reduction-slider').value) || 50;
        const engine = $id('simplify-engine')?.value || 'density';
        const currentFaceCount = obj.mesh.faces.filter(f => !f.isDeleted).length;
        const targetFaceCount = Math.max(4, Math.floor(currentFaceCount * (1 - reductionPercent / 100)));

        console.log(`[MeshPrep] Simplify (${engine}) for ${obj.name}: ${currentFaceCount} → target ${targetFaceCount} faces`);
        this.pushState();

        let collapsed = 0;
        try {
            if (engine === 'quality') {
                // meshoptimizer WASM — feature-preserving, error-bounded, border-locked.
                collapsed = await obj.mesh.simplifyMeshopt(targetFaceCount);
            } else {
                // Density Balance 0..100% → exponent 0..1.5 (0 = pure feature-preserving QEM).
                const densityPct = parseFloat($id('qem-density-slider')?.value ?? 60);
                const densityBias = (densityPct / 100) * 1.5;
                collapsed = obj.mesh.simplify(targetFaceCount, { densityBias });
            }
        } catch (err) {
            console.error('[MeshPrep] Simplify failed:', err);
            this.undoStack.pop();
            return;
        }

        if (collapsed > 0) {
            // Simplify rebuilds face ids wholesale → part keys (and any hide state) are void.
            this.markPartsDirty(obj, { resetHidden: true });
            this.updateMeshDisplay();
            this.updateStats();
            this.refreshSceneUI();
            console.log(`[MeshPrep] Simplify complete (${engine}). Removed ${collapsed}.`);
        } else {
            this.undoStack.pop();
        }
    }

    // "Zusammen backen": fuse every visible object into ONE mesh. Coincident vertices across the
    // parts are welded by buildFromGeometry's position merge, then winding is re-unified so the
    // result stays solid. Do this before simplifying so QEM works on one connected shell.
    mergeAllObjects() {
        const vis = [...this.objects.values()].filter(o => o.visible);
        if (vis.length < 2) { console.log('[MeshPrep] Merge: need 2+ visible objects.'); return false; }
        this.pushState();
        // Bake EVERY visible object's transform (not just the active one — bakeTransforms() only
        // touches the active object, so rotated/offset parts used to fuse at the wrong place).
        vis.forEach(o => this.applyBakeMatrix(o));
        const parts = [];
        let totalFaces = 0;
        // mergeGeometries() needs an identical attribute set on every part, so once ANY object
        // carries colour they all must. This is also where a multi-material model keeps its
        // look: each flat material colour is baked into that part's vertex colours, otherwise
        // fusing 4 coloured meshes into 1 object would collapse them to a single colour.
        const anyColors = vis.some(o => o.mesh.hasVertexColors || o.sourceColor);
        vis.forEach(o => {
            const g = o.mesh.generateBufferGeometry(null, this.partFilterFor(o));
            const posAttr = g.getAttribute('position');
            if (!posAttr || posAttr.count === 0) return;
            const ng = g.index ? g.toNonIndexed() : g;
            const p = new THREE.BufferGeometry();
            const ngPos = ng.getAttribute('position');
            p.setAttribute('position', ngPos.clone());
            if (anyColors) {
                const col = ng.getAttribute('color');
                if (col) {
                    p.setAttribute('color', col.clone());
                } else {
                    const c = o.sourceColor;
                    const arr = new Float32Array(ngPos.count * 3);
                    for (let i = 0; i < ngPos.count; i++) {
                        arr[i * 3] = c ? c.r : 1;
                        arr[i * 3 + 1] = c ? c.g : 1;
                        arr[i * 3 + 2] = c ? c.b : 1;
                    }
                    p.setAttribute('color', new THREE.Float32BufferAttribute(arr, 3));
                }
            }
            parts.push(p);
            totalFaces += o.mesh.faces.filter(f => !f.isDeleted).length;
        });
        if (!parts.length) { this.undoStack.pop(); return false; }
        const merged = BufferGeometryUtils.mergeGeometries(parts, false);
        if (!merged) { this.undoStack.pop(); console.log('[MeshPrep] Merge failed (incompatible geometry).'); return false; }

        this.objects.forEach(o => { if (o.displayMesh) this.scene.remove(o.displayMesh); });
        this.objects.clear();
        this.expandedObjects.clear();
        this.selectedParts.clear();
        const id = this.objCounter++;
        const obj = new SceneObject(id, 'Merged', merged, 0x38bdf8);
        this.objects.set(id, obj);
        this.activeObjectId = id;
        this.mesh = obj.mesh;
        obj.mesh.recalcNormals(); // keep the fused shell winding-consistent

        this.updateMeshDisplay();
        this.updateStats();
        if (this.refreshSceneUI) this.refreshSceneUI();
        if (this.syncTransformUI) this.syncTransformUI();
        const after = obj.mesh.faces.filter(f => !f.isDeleted).length;
        console.log(`[MeshPrep] Baked ${vis.length} objects → 1 mesh (${totalFaces} → ${after} faces after welding).`);
        return true;
    }

    // ================================================================== LOOSE PARTS
    // "Connected objects" that are NOT separate objects in the file: one mesh can hold many
    // disjoint islands. Detect them, list them in the scene graph, pick one, delete it.

    /** Connected parts of an object (cached; recomputed only after the mesh was mutated). */
    getParts(obj, { force = false } = {}) {
        if (!obj) return [];
        if (obj._parts && !obj._partsDirty) return obj._parts;
        // Auto-detection is O(F+V) and cheap for normal meshes, but a raw multi-100k-face import
        // would stall every scene-graph refresh. Those only get analysed on demand (expand/part mode).
        const liveFaces = obj.mesh.faces.length;
        if (!force && liveFaces > 250000) return obj._parts || [];

        const { parts, faceToPart } = obj.mesh.findConnectedParts();
        this.disposePartGeometries(obj._parts);
        obj._parts = parts;
        obj._faceToPart = faceToPart;
        obj._partsDirty = false;
        return parts;
    }

    getFaceToPart(obj) {
        this.getParts(obj, { force: true });
        return obj._faceToPart || new Map();
    }

    /** Mark an object's part cache stale after a mesh mutation. */
    markPartsDirty(obj, { resetHidden = false } = {}) {
        if (!obj) return;
        obj._partsDirty = true;
        if (resetHidden) obj.hiddenParts.clear();
        if (obj.id === this.activeObjectId) {
            this.selectedParts.clear();
            this.selection.part = null;
            this._hoverPartKey = null;
            this.clearGroup(this.partHighlights);
            this.clearGroup(this.partHover);
        }
    }

    markAllPartsDirty(opts) {
        this.objects.forEach(o => this.markPartsDirty(o, opts));
    }

    disposePartGeometries(parts) {
        if (!parts) return;
        parts.forEach(p => { if (p._geo) { p._geo.dispose(); p._geo = null; } });
    }

    /** (face) => bool filter that hides the object's hidden parts from geometry + export. */
    partFilterFor(obj) {
        if (!obj || !obj.hiddenParts || obj.hiddenParts.size === 0) return null;
        const map = this.getFaceToPart(obj);
        const hidden = obj.hiddenParts;
        return (f) => {
            const p = map.get(f);
            return !!p && hidden.has(p.key);
        };
    }

    partByKey(key, obj = this.activeObject) {
        return this.getParts(obj, { force: true }).find(p => p.key === key) || null;
    }

    /** Resolve a raycast face index to the loose part it belongs to. */
    partAt(faceIndex) {
        const face = this.renderFaceMap[faceIndex];
        if (!face) return null;
        return this.getFaceToPart(this.activeObject).get(face) || null;
    }

    clearGroup(group) {
        group.children.forEach(c => { if (c.material) c.material.dispose(); });
        group.clear();
    }

    addPartOverlay(part, color, opacity, group) {
        const obj = this.activeObject;
        if (!obj) return;
        const mesh = new THREE.Mesh(
            obj.mesh.partGeometry(part),
            new THREE.MeshBasicMaterial({
                color, transparent: true, opacity,
                side: THREE.DoubleSide, depthTest: false, depthWrite: false
            })
        );
        // Overlays live in scene space, so mirror the object's live preview transform —
        // otherwise the highlight floats at the untransformed origin.
        mesh.position.copy(obj.transforms.position);
        mesh.rotation.copy(obj.transforms.rotation);
        mesh.scale.setScalar(obj.transforms.scale ?? 1);
        mesh.renderOrder = 998;
        group.add(mesh);
    }

    refreshPartHighlights() {
        this.clearGroup(this.partHighlights);
        const obj = this.activeObject;
        if (!obj) return;
        this.selectedParts.forEach(key => {
            const part = this.partByKey(key, obj);
            if (part) this.addPartOverlay(part, 0xfacc15, 0.5, this.partHighlights);
        });
    }

    /** Preview-highlight a part (scene-graph row hover or viewport hover in Part Mode). */
    hoverPart(key) {
        if (key === this._hoverPartKey) return;
        this._hoverPartKey = key;
        this.clearGroup(this.partHover);
        if (key === null || key === undefined) return;
        const part = this.partByKey(key);
        if (part && !this.selectedParts.has(key)) this.addPartOverlay(part, 0x3b82f6, 0.35, this.partHover);
    }

    /**
     * @param {object} part
     * @param {{additive?: boolean, range?: boolean}} mods
     *        additive (Ctrl) toggles one part, range (Shift) spans from the last anchor to the
     *        clicked one — same feel as a file list.
     */
    selectPart(part, mods = {}) {
        if (!part) return;
        // Back-compat: older call sites passed a plain boolean for "additive".
        if (typeof mods === 'boolean') mods = { additive: mods };
        const { additive = false, range = false } = mods;
        const list = this.getParts(this.activeObject, { force: true });

        if (range && this._partAnchorKey !== null && this._partAnchorKey !== undefined) {
            const from = list.findIndex(p => p.key === this._partAnchorKey);
            const to = list.findIndex(p => p.key === part.key);
            if (from !== -1 && to !== -1) {
                this.selectedParts.clear();
                const [lo, hi] = from <= to ? [from, to] : [to, from];
                for (let i = lo; i <= hi; i++) this.selectedParts.add(list[i].key);
            } else {
                this.selectedParts.add(part.key);
            }
        } else {
            if (!additive) this.selectedParts.clear();
            if (additive && this.selectedParts.has(part.key)) this.selectedParts.delete(part.key);
            else this.selectedParts.add(part.key);
            // A plain or Ctrl click moves the anchor; Shift keeps it so the range can be resized.
            this._partAnchorKey = part.key;
        }

        this.selection.part = this.selectedParts.size ? part : null;
        this._hoverPartKey = null;
        this.clearGroup(this.partHover);
        this.refreshPartHighlights();
        this.refreshSceneUI();
        this.updatePartHud();
    }

    updatePartHud() {
        if (!this.selectedParts.size) { this.updateSelectionSidebar(''); return; }
        let faces = 0;
        const parts = [...this.selectedParts].map(k => this.partByKey(k)).filter(Boolean);
        parts.forEach(p => faces += p.faceCount);
        const label = parts.length === 1 ? `Part ${parts[0].index + 1}` : `${parts.length} parts`;
        this.updateSelectionSidebar(
            `<b>${label}</b> · ${faces.toLocaleString()} faces <span style="opacity:.55">— DEL to delete</span>`
        );
    }

    /** Frame a part in the viewport — the only sane way to find a 12-face junk shell. */
    focusPart(part) {
        const obj = this.activeObject;
        if (!obj || !part) return;
        const s = obj.transforms.scale ?? 1;
        const center = part.center.clone().multiplyScalar(s)
            .applyEuler(obj.transforms.rotation)
            .add(obj.transforms.position);
        const dist = Math.max(part.diagonal * s * 1.8, 0.05);
        const dir = new THREE.Vector3().subVectors(this.camera.position, this.controls.target);
        if (dir.lengthSq() < 1e-9) dir.set(1, 1, 1);
        dir.normalize();

        this.controls.target.copy(center);
        this.camera.position.copy(center).add(dir.multiplyScalar(dist));
        // Only ever pull the near plane IN, so framing a tiny shell can't clip the rest away.
        this.camera.near = Math.min(this.camera.near, Math.max(dist * 0.01, 0.001));
        this.camera.updateProjectionMatrix();
        this.controls.update();
    }

    togglePartVisibility(key) {
        const obj = this.activeObject;
        if (!obj) return;
        if (obj.hiddenParts.has(key)) obj.hiddenParts.delete(key);
        else obj.hiddenParts.add(key);
        this.updateMeshDisplay();
        this.updateStats();
        this.refreshSceneUI();
    }

    deleteSelectedParts() {
        const obj = this.activeObject;
        if (!obj || !this.selectedParts.size) return;
        const all = this.getParts(obj, { force: true });
        const doomed = [...this.selectedParts].map(k => all.find(p => p.key === k)).filter(Boolean);
        if (!doomed.length) return;
        if (doomed.length >= all.length) {
            console.warn('[MeshPrep] That would delete every part of the mesh — remove the object in the Scene Graph instead.');
            return;
        }

        this.pushState();
        const res = obj.mesh.deleteParts(doomed);
        doomed.forEach(p => obj.hiddenParts.delete(p.key));
        console.log(`[MeshPrep] Deleted ${doomed.length} connected part(s): −${res.faces} faces, −${res.vertices} verts.`);

        this.floatingMenu.hide();
        this.markPartsDirty(obj);
        this.updateMeshDisplay();
        this.updateStats();
        this.refreshSceneUI();
    }

    /** Junk purge: drop every part below a face threshold, keep the real geometry. */
    deleteTinyParts(minFaces) {
        const obj = this.activeObject;
        if (!obj) return;
        const parts = this.getParts(obj, { force: true });
        const doomed = parts.filter(p => p.faceCount < minFaces);
        if (!doomed.length) { console.log(`[MeshPrep] No connected part under ${minFaces} faces.`); return; }
        if (doomed.length >= parts.length) { console.warn(`[MeshPrep] Every part is under ${minFaces} faces — nothing would be left.`); return; }
        this.selectedParts = new Set(doomed.map(p => p.key));
        this.deleteSelectedParts();
    }

    keepLargestPart() {
        const obj = this.activeObject;
        if (!obj) return;
        const parts = this.getParts(obj, { force: true });
        if (parts.length < 2) { console.log('[MeshPrep] Mesh is a single connected part.'); return; }
        this.selectedParts = new Set(parts.slice(1).map(p => p.key)); // sorted biggest-first
        this.deleteSelectedParts();
    }

    /**
     * Turn connected parts into real scene objects. With no argument every island of the active
     * object becomes its own object (the source is consumed); with a list, only those are split
     * off and the rest stays behind.
     */
    splitPartsToObjects(parts = null) {
        const src = this.activeObject;
        if (!src) return;
        const all = this.getParts(src, { force: true });
        if (all.length < 2) { console.log('[MeshPrep] Split: mesh is a single connected part.'); return; }

        const splitAll = !parts || !parts.length;
        const list = splitAll ? all : parts;
        if (splitAll && all.length > 60 &&
            !confirm(`Split "${src.name}" into ${all.length} separate objects?`)) return;

        this.pushState();
        // Split-off parts inherit the source's colours (they ARE that object's geometry);
        // the Loose Parts hover/highlight is what tells them apart now, not a random palette.
        const created = [];
        list.forEach((p, i) => {
            const id = this.objCounter++;
            const o = new SceneObject(id, `${src.name} #${i + 1}`, src.mesh.partGeometry(p), src.color);
            o.sourceColor = src.sourceColor ? src.sourceColor.clone() : null;
            o.transforms.position.copy(src.transforms.position);
            o.transforms.rotation.copy(src.transforms.rotation);
            o.transforms.scale = src.transforms.scale;
            created.push(o);
        });

        if (splitAll) {
            if (src.displayMesh) this.scene.remove(src.displayMesh);
            this.objects.delete(src.id);
            this.expandedObjects.delete(src.id);
            this.disposePartGeometries(src._parts);
        } else {
            src.mesh.deleteParts(list);
            list.forEach(p => src.hiddenParts.delete(p.key));
            this.markPartsDirty(src);
        }
        created.forEach(o => this.objects.set(o.id, o));

        this.activeObjectId = created.length ? created[0].id : (this.objects.keys().next().value ?? null);
        this.mesh = this.activeObject ? this.activeObject.mesh : new HalfEdgeMesh();
        this.clearSelection();
        this.updateMeshDisplay();
        this.updateStats();
        this.refreshSceneUI();
        this.syncTransformUI();
        console.log(`[MeshPrep] Split ${created.length} connected part(s) into separate objects.`);
    }

    /** Sidebar summary + bulk action availability. */
    refreshPartsPanel() {
        const summary = $id('parts-summary');
        const actions = $id('parts-actions');
        if (!summary) return;
        const obj = this.activeObject;
        if (!obj) {
            summary.textContent = 'No mesh loaded.';
            if (actions) actions.style.display = 'none';
            return;
        }
        const parts = this.getParts(obj);
        if (!parts.length) {
            summary.innerHTML = `<span style="opacity:.6">Large mesh — press ANALYSE to detect parts.</span>`;
            if (actions) actions.style.display = 'none';
            return;
        }
        const hidden = obj.hiddenParts.size;
        summary.innerHTML = parts.length === 1
            ? `<b>1</b> connected part in "${obj.name}" — nothing loose.`
            : `<b>${parts.length}</b> connected parts in "${obj.name}"${hidden ? ` · ${hidden} hidden` : ''}`;
        if (actions) actions.style.display = parts.length > 1 ? '' : 'none';
    }

    // Bake transforms of all visible objects into their vertices and serialize the scene to an
    // OBJ string for the file export.
    buildSceneOBJ() {
        // Bake all visible objects (without pushState to avoid cluttering undo)
        this.objects.forEach(obj => {
            if (obj.visible) this.applyBakeMatrix(obj);
        });

        let objContent = "# Mesh Optimizer scene export\n";
        let vOffset = 0;

        this.objects.forEach(obj => {
            if (!obj.visible) return;

            // Hidden loose parts are excluded from the export, exactly like an invisible object.
            const skipFace = this.partFilterFor(obj);

            const vMap = new Map();
            let vIdx = 1;
            const vLines = [];
            const fLines = [];

            // Colours ride along in the widely-used extended OBJ form "v x y z r g b"
            // (MeshLab/Blender/three.js all read it) — that's how a painted GLB keeps its
            // colours in an OBJ, which otherwise drops them.
            // OBJLoader decodes those as sRGB, so encode out of linear working space here or
            // everything comes back darkened.
            //
            // Two sources, in order: real vertex colours, else the object's own material
            // colour. Without the second case a multi-material GLB (colour per mesh, no vertex
            // colours) arrives as a single white blob, because an OBJ has no MTL and the
            // importer falls back to the default white material for every "o" group.
            const withColors = obj.mesh.hasVertexColors || !!obj.sourceColor;
            const flat = obj.mesh.hasVertexColors ? null : obj.sourceColor;
            const srgb = { r: 0, g: 0, b: 0 };

            // Two passes so hiding a part also drops its (now unused) vertices from the file.
            const useVertex = (v) => {
                let idx = vMap.get(v.id);
                if (idx === undefined) {
                    idx = vIdx++;
                    vMap.set(v.id, idx);
                    let line = `v ${v.position.x.toFixed(6)} ${v.position.y.toFixed(6)} ${v.position.z.toFixed(6)}`;
                    if (withColors) {
                        const c = flat || v.color;
                        if (c) c.getRGB(srgb, THREE.SRGBColorSpace);
                        else { srgb.r = 1; srgb.g = 1; srgb.b = 1; }
                        line += ` ${srgb.r.toFixed(4)} ${srgb.g.toFixed(4)} ${srgb.b.toFixed(4)}`;
                    }
                    vLines.push(line);
                }
                return idx;
            };

            obj.mesh.faces.forEach(f => {
                if (f.isDeleted) return;
                if (skipFace && skipFace(f)) return;
                const he = f.halfEdge;
                if (!he || !he.prev || !he.next) return;
                const i1 = useVertex(he.prev.vertex) + vOffset;
                const i2 = useVertex(he.vertex) + vOffset;
                const i3 = useVertex(he.next.vertex) + vOffset;
                fLines.push(`f ${i1} ${i2} ${i3}`);
            });

            if (!fLines.length) return;

            objContent += `o ${obj.name}\n${vLines.join('\n')}\n${fLines.join('\n')}\n`;
            vOffset += vMap.size;
        });

        return objContent;
    }

    /** Bake an object's live preview transform (pos + rot + uniform scale) into its vertices. */
    applyBakeMatrix(obj) {
        const s = obj.transforms.scale ?? 1;
        const quat = new THREE.Quaternion().setFromEuler(obj.transforms.rotation);
        const matrix = new THREE.Matrix4().compose(
            obj.transforms.position,
            quat,
            new THREE.Vector3(s, s, s)
        );
        obj.mesh.vertices.forEach(v => {
            if (!v.isDeleted) v.position.applyMatrix4(matrix);
        });
        obj.transforms.rotation.set(0, 0, 0);
        obj.transforms.position.set(0, 0, 0);
        obj.transforms.scale = 1;
        // Positions moved → cached part bounds/centres are stale (topology is not). Go through
        // markPartsDirty so any live highlight is dropped BEFORE its geometry gets disposed.
        this.markPartsDirty(obj);
    }

    exportMesh() {
        if (this.objects.size === 0) return;
        this.pushState();

        const objContent = this.buildSceneOBJ();

        const blob = new Blob([objContent], { type: 'text/plain' });
        const baseName = this.originalFileName ? this.originalFileName.replace(/\.[^/.]+$/, "") : "scene";
        saveFile(blob, `${baseName}_optimized.obj`, '.obj');

        this.updateMeshDisplay();
        this.syncTransformUI();
    }

    async exportGltf() {
        console.log("[MeshPrep] Exporting glTF Binary...");
        
        // Bake all visible objects before export
        this.objects.forEach(obj => {
            if (obj.visible) this.applyBakeMatrix(obj);
        });


        // Regenerate BufferGeometry with baked vertices
        this.updateMeshDisplay();

        const exportGroup = new THREE.Group();
        this.objects.forEach(obj => {
            if (obj.visible && obj.displayMesh) {
                // Clone DisplayMesh to avoid corrupting viewport interactions
                const meshClone = obj.displayMesh.clone();
                meshClone.children = []; // Remove wireframes etc.
                exportGroup.add(meshClone);
            }
        });

        if (exportGroup.children.length === 0) {
            console.warn("[MeshPrep] Nothing to export.");
            return;
        }

        try {
            // Dynamically import the Exporter via the mapped importmap
            const { GLTFExporter } = await import('https://cdn.jsdelivr.net/npm/three@0.170.0/examples/jsm/exporters/GLTFExporter.js/+esm');
            const exporter = new GLTFExporter();
            
            exporter.parse(
                exportGroup,
                (gltf) => {
                    // Non-binary GLTFExporter hands back a JSON *object* — it MUST be stringified.
                    // Without this, new Blob([object]) writes the literal "[object Object]" → the
                    // file is invalid JSON and can't be re-imported (GLTFLoader/JSON.parse fails).
                    const text = JSON.stringify(gltf);
                    const blob = new Blob([text], { type: 'model/gltf+json' });
                    const baseName = this.originalFileName ? this.originalFileName.replace(/\.[^/.]+$/, "") : "scene";
                    saveFile(blob, `${baseName}_optimized.gltf`, '.gltf');
                    console.log("[MeshPrep] GLTF Export complete.");
                },
                (error) => {
                    console.error("[MeshPrep] GLTF Export failed: ", error);
                }
                // Removed { binary: true } to strictly output standard JSON .gltf
            );
        } catch (err) {
            console.error("[MeshPrep] Failed to load GLTFExporter: ", err);
        }
    }

    collapseSelectedFace(mode = 'CENTER') {
        if (this.selection.mode !== 'face' || !this.selection.face) return;
        const face = this.selection.face;

        this.pushState();
        const result = this.mesh.collapseTriangle(face, mode);

        if (result) {
            console.log(`[MeshPrep] Face collapsed (Target: ${mode}).`);
            this.markPartsDirty(this.activeObject);
            this.updateMeshDisplay();
            this.updateStats();
            this.clearSelection();
            this.refreshSceneUI();
        } else {
            // ATOMIC ROLLBACK: Use the undo system to restore the previous geometry/topology
            this.undoStack.pop(); // Remove the "bad" newly pushed state
            const lastGeo = this.undoStack.pop();
            if (lastGeo) {
                this.loadGeometry(lastGeo, false);
                console.warn("[MeshPrep] Face collapse aborted: Topological safety violation.");
            }
            this.updateUndoRedoUI();
        }
    }

    collapseSelectedEdge(mode = 'CENTER') {
        if (this.selection.mode !== 'edge' || !this.selection.edge) {
            console.warn("[MeshPrep] No edge selected for collapse.");
            return;
        }

        const he = this.selection.edge;
        this.pushState();

        const result = this.mesh.collapseEdge(he, mode);

        if (result) {
            console.log(`[MeshPrep] Edge collapsed successfully (Target: ${mode}).`);
            this.markPartsDirty(this.activeObject);
            this.updateMeshDisplay();
            this.updateStats();
            this.clearSelection();
            this.refreshSceneUI();
        } else {
            this.undoStack.pop();
            const lastGeo = this.undoStack.pop();
            if (lastGeo) {
                this.loadGeometry(lastGeo, false);
                console.warn("[MeshPrep] Edge collapse aborted: Topological safety violation.");
            }
            this.updateUndoRedoUI();
        }
    }

    setSelectMode(mode) {
        const group = $id('tool-group-selectors');
        if (!group) return;

        const btn = group.querySelector(`button[data-value="${mode}"]`);
        if (btn) {
            group.value = mode; // silent — keyboard shortcuts land here too
            this.selection.mode = mode;
            this.clearSelection();
            this.clearHighlight();
            this.container.style.cursor = ''; // Part Mode leaves a pointer cursor behind
            if (mode === 'part' && this.activeObject) {
                // Analyse on entering the mode so the first click already knows the islands,
                // even on a mesh too big for the automatic scene-graph pass.
                const parts = this.getParts(this.activeObject, { force: true });
                console.log(`[MeshPrep] Part Mode: ${parts.length} connected part(s) in "${this.activeObject.name}".`);
                this.refreshSceneUI();
            }
            this.updateMeshDisplay();
        }
    }

    onMouseMove(e) {
        if (this.selection.mode === 'view') {
            this.clearHighlight();
            return;
        }
        const activeObj = this.activeObject;
        if (!activeObj || !activeObj.displayMesh) return;
        const rect = this.container.getBoundingClientRect();
        this.mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
        this.mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

        // --- PART MODE: highlight the whole connected mesh group under the cursor ---
        if (this.selection.mode === 'part') {
            this.raycaster.setFromCamera(this.mouse, this.camera);
            const hits = this.raycaster.intersectObject(activeObj.displayMesh, false);
            const part = hits.length ? this.partAt(hits[0].faceIndex) : null;
            this.hoverPart(part ? part.key : null);
            this.container.style.cursor = part ? 'pointer' : '';
            return;
        }

        // --- VERTEX DRAG MODE ---
        if (this.drag.active && this.drag.vertex) {
            this.drag.didMove = true;
            this.raycaster.setFromCamera(this.mouse, this.camera);

            // Intersect with drag plane to get new position
            const intersection = new THREE.Vector3();
            if (this.raycaster.ray.intersectPlane(this.drag.plane, intersection)) {
                this.drag.vertex.position.copy(intersection);
            }

            // Snap detection: find nearest snap-eligible vertex
            this.drag.snapGroup.clear();
            this.drag.snapTarget = null;

            const dragScreenPos = this.drag.vertex.position.clone().project(this.camera);
            let bestDist = Infinity;

            // In face mode, snap to face vertices; in vertex mode, snap to topological neighbors only
            const snapCandidates = this.drag.faceSnapTargets || this.drag.vertexSnapTargets || [];
            const snapThreshold = this.drag.faceSnapTargets ? 35 : 25; // larger zone for face markers

            snapCandidates.forEach(v => {
                if (v.isDeleted || v === this.drag.vertex) return;
                const screenPos = v.position.clone().project(this.camera);

                // Depth check: reject vertices that are at a very different depth
                // This prevents snapping "through" the mesh to back-face vertices
                const depthDiff = Math.abs(screenPos.z - dragScreenPos.z);
                if (depthDiff > 0.1) return; // Skip vertices far behind/in front

                const dx = (screenPos.x - dragScreenPos.x) * rect.width * 0.5;
                const dy = (screenPos.y - dragScreenPos.y) * rect.height * 0.5;
                const dist = Math.sqrt(dx * dx + dy * dy);

                if (dist < snapThreshold && dist < bestDist) {
                    bestDist = dist;
                    this.drag.snapTarget = v;
                }
            });

            // Visual feedback for snap
            if (this.drag.snapTarget) {
                // Snap line
                const lineGeo = new THREE.BufferGeometry().setFromPoints([
                    this.drag.vertex.position, this.drag.snapTarget.position
                ]);
                const lineMat = new THREE.LineBasicMaterial({ color: 0x22d3ee, depthTest: false });
                const line = new THREE.Line(lineGeo, lineMat);
                line.renderOrder = 1002;
                this.drag.snapGroup.add(line);

                // Snap target dot
                const dotGeo = new THREE.BufferGeometry().setFromPoints([this.drag.snapTarget.position]);
                const dotMat = new THREE.PointsMaterial({
                    color: 0x22d3ee, size: 12, sizeAttenuation: false,
                    depthTest: false, transparent: true
                });
                const dot = new THREE.Points(dotGeo, dotMat);
                dot.renderOrder = 1003;
                this.drag.snapGroup.add(dot);

                // Snap dragged vertex position to target
                this.drag.vertex.position.copy(this.drag.snapTarget.position);
            }

            // Live update the mesh display
            this.updateMeshDisplay();
            // Re-show drag dot
            this.persistentHighlights.clear();
            this.createVertexDot(this.drag.vertex, 0xfacc15, this.persistentHighlights);
            return;
        }

        // --- NORMAL HOVER ---
        this.raycaster.setFromCamera(this.mouse, this.camera);
        const intersects = this.raycaster.intersectObject(activeObj.displayMesh, false);

        this.clearHighlight();
        if (intersects.length > 0) {
            this.updateHighlight(intersects[0]);
        }
    }

    onMouseDown(e) {
        if (this.selection.mode === 'view') return;
        const activeObj = this.activeObject;
        if (!activeObj || !activeObj.displayMesh || e.button !== 0) return; // Left click only

        const rect = this.container.getBoundingClientRect();
        this.mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
        this.mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

        let vertex = null;

        if (this.selection.mode === 'vertex') {
            // VERTEX MODE: drag any vertex
            this.raycaster.setFromCamera(this.mouse, this.camera);
            const intersects = this.raycaster.intersectObject(activeObj.displayMesh, false);
            if (intersects.length === 0) return;

            const face = this.renderFaceMap[intersects[0].faceIndex];
            if (!face) return;

            vertex = this.findNearestVertex(face, intersects[0].point);

        } else if (this.selection.mode === 'face' && this.selection.face) {
            // FACE MODE: check if clicking near a face vertex marker
            const face = this.selection.face;
            const he = face.halfEdge;
            const faceVerts = [he.prev.vertex, he.vertex, he.next.vertex];

            // Find which marker vertex is closest to click in screen space
            let bestDist = Infinity;
            for (const v of faceVerts) {
                const screenPos = v.position.clone().project(this.camera);
                const sx = (screenPos.x * 0.5 + 0.5) * rect.width;
                const sy = (-screenPos.y * 0.5 + 0.5) * rect.height;
                const dx = (e.clientX - rect.left) - sx;
                const dy = (e.clientY - rect.top) - sy;
                const dist = Math.sqrt(dx * dx + dy * dy);

                if (dist < 20 && dist < bestDist) { // 20px hit zone
                    bestDist = dist;
                    vertex = v;
                }
            }

            if (vertex) {
                // Store the face vertices as the only valid snap targets
                this.drag.faceSnapTargets = faceVerts.filter(v => v !== vertex);
            }
        }

        if (!vertex) return;

        // Start drag
        this.pushState();
        this.drag.active = true;
        this.drag.vertex = vertex;
        this.drag.startPos = vertex.position.clone();
        this.drag.snapTarget = null;
        this.drag.didMove = false;

        // Compute topological 1-ring neighbors for safe snap targeting
        // Only adjacent vertices (sharing a face) are valid merge targets
        if (!this.drag.faceSnapTargets) {
            this.drag.vertexSnapTargets = this.mesh.getNeighborhood(vertex);
            console.log(`[SNAP DEBUG] Vertex mode: V${vertex.id} neighbors = [${this.drag.vertexSnapTargets.map(v => 'V' + v.id).join(', ')}]`);
        } else {
            console.log(`[SNAP DEBUG] Face mode: faceSnapTargets = [${this.drag.faceSnapTargets.map(v => 'V' + v.id).join(', ')}]`);
        }

        // Create camera-facing plane through vertex
        const camDir = this.camera.getWorldDirection(new THREE.Vector3());
        this.drag.plane = new THREE.Plane().setFromNormalAndCoplanarPoint(camDir, vertex.position);

        // Disable orbit
        this.controls.enabled = false;

        // Visual feedback: clear hover, hide menu, show snap target markers
        this.highlights.clear();
        this.markers.clear();
        this.floatingMenu.hide();

        // Show the snap target vertices as markers so user knows where to drag to
        if (this.drag.faceSnapTargets) {
            const colors = [0x10b981, 0xc084fc, 0x3b82f6]; // green, purple, blue
            this.drag.faceSnapTargets.forEach((v, i) => {
                this.createMarker(v.position, colors[i % colors.length]);
            });
        }

        // Show dragged vertex as yellow dot
        this.createVertexDot(vertex, 0xfacc15, this.persistentHighlights);
        this.updateSelectionSidebar(`Vertex #${vertex.id}<br>Dragging...`);

        this.container.style.cursor = 'grabbing';
    }

    onMouseUp(e) {
        if (!this.drag.active) return;

        const vertex = this.drag.vertex;
        const snapTarget = this.drag.snapTarget;

        // Clean up drag visuals
        this.drag.snapGroup.clear();
        this.drag.active = false;
        this.drag.faceSnapTargets = null;
        this.drag.vertexSnapTargets = null;
        this.controls.enabled = true;
        this.container.style.cursor = '';

        if (!this.drag.didMove) {
            // No movement — treat as a normal click/select (undo the pushState)
            this.undoStack.pop();
            this.updateUndoRedoUI();
            return;
        }

        if (snapTarget) {
            // MERGE: redirect all edges from dragged vertex to snap target
            console.log(`[MeshPrep] Merging V${vertex.id} → V${snapTarget.id}`);
            this.mesh.mergeVertices(snapTarget, vertex);
        }

        // Refresh display
        this.markPartsDirty(this.activeObject); // a vertex weld can fuse two islands into one
        this.updateMeshDisplay();
        this.updateStats();
        this.clearSelection();
        this.refreshSceneUI();
        this.updateUndoRedoUI();
    }

    onMouseClick(e) {
        if (this.selection.mode === 'view') return;
        // Skip click if we just finished a drag
        if (this.drag.didMove) {
            this.drag.didMove = false;
            return;
        }

        const rect = this.container.getBoundingClientRect();
        this.mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
        this.mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
        this.raycaster.setFromCamera(this.mouse, this.camera);

        // Raycast ALL visible objects so any part (even a dimmed, inactive one) is
        // clickable: clicking a different object first switches the active object to it,
        // so a multi-part mesh (e.g. body + fins) is fully reachable from the viewport.
        const meshes = [];
        this.objects.forEach(o => { if (o.displayMesh && o.visible) meshes.push(o.displayMesh); });
        const intersects = this.raycaster.intersectObjects(meshes, false);
        if (intersects.length === 0) { this.clearSelection(); return; }

        const hit = intersects[0];
        let hitObj = null;
        this.objects.forEach(o => { if (o.displayMesh === hit.object) hitObj = o; });
        if (hitObj && hitObj.id !== this.activeObjectId) {
            this.setActiveObject(hitObj.id); // clicked an inactive part → make it active first
            return;
        }

        if (this.selection.mode === 'part') {
            const part = this.partAt(hit.faceIndex);
            if (!part) { this.clearSelection(); return; }
            this.selectPart(part, { additive: e.ctrlKey || e.metaKey, range: e.shiftKey });
            this.showPartMenu(e.clientX, e.clientY);
            return;
        }

        this.selectObject(hit, e.clientX, e.clientY);
    }

    updateHighlight(hit) {
        const face = this.renderFaceMap[hit.faceIndex];
        if (!face) return;

        if (this.selection.mode === 'face') {
            this.createOverlay(face, 0x3b82f6, 0.4, this.highlights);
        } else if (this.selection.mode === 'edge') {
            const edge = this.findNearestEdge(face, hit.point);
            this.createEdgeLine(edge, 0x3b82f6, this.highlights);
        } else if (this.selection.mode === 'vertex') {
            const vertex = this.findNearestVertex(face, hit.point);
            this.createVertexDot(vertex, 0x3b82f6, this.highlights);
        }
    }

    selectObject(hit, screenX, screenY) {
        const face = this.renderFaceMap[hit.faceIndex];
        if (!face) return;

        this.clearSelection();

        if (this.selection.mode === 'face') {
            this.selection.face = face;
            this.createOverlay(face, 0xfacc15, 0.6, this.persistentHighlights);
            this.createMergeMarkers(face);
            this.showHideMergeMenu(screenX, screenY);
            const area = this.calculateFaceArea(face);
            this.updateSelectionSidebar(`<b>Face #${face.id}</b> · Area: ${area.toFixed(4)}`);
        } else if (this.selection.mode === 'edge') {
            const edge = this.findNearestEdge(face, hit.point);
            this.selection.edge = edge;
            this.createEdgeLine(edge, 0xfacc15, this.persistentHighlights);
            this.createMergeMarkers(edge);
            this.showHideMergeMenu(screenX, screenY);
            const len = edge.prev.vertex.position.distanceTo(edge.vertex.position);
            this.updateSelectionSidebar(`<b>Edge #${edge.id}</b> · Len: ${len.toFixed(4)}`);
        } else if (this.selection.mode === 'vertex') {
            const vertex = this.findNearestVertex(face, hit.point);
            this.selection.vertex = vertex;
            this.createVertexDot(vertex, 0xfacc15, this.persistentHighlights);
            this.updateSelectionSidebar(`<b>Vertex #${vertex.id}</b> · [${vertex.position.x.toFixed(2)}, ${vertex.position.y.toFixed(2)}]`);
        }
        this.refreshSelectionBar();
    }

    calculateFaceArea(face) {
        const p1 = face.halfEdge.prev.vertex.position;
        const p2 = face.halfEdge.vertex.position;
        const p3 = face.halfEdge.next.vertex.position;
        const v1 = new THREE.Vector3().subVectors(p2, p1);
        const v2 = new THREE.Vector3().subVectors(p3, p1);
        return new THREE.Vector3().crossVectors(v1, v2).length() * 0.5;
    }

    updateSelectionSidebar(html) {
        const el = $id('selection-info');
        if (el) el.innerHTML = html;
    }

    createMergeMarkers(item) {
        if (this.selection.mode === 'edge') {
            const he = item;
            const p1 = he.prev.vertex.position;
            const p2 = he.vertex.position;
            const mid = p1.clone().add(p2).multiplyScalar(0.5);
            const edgeLen = p1.distanceTo(p2);

            this.createMarker(p1, 0x3b82f6, edgeLen);
            this.createMarker(p2, 0x10b981, edgeLen);
            this.createMarker(mid, 0xffffff, edgeLen);
        } else if (this.selection.mode === 'face') {
            const face = item;
            const p1 = face.halfEdge.prev.vertex.position;
            const p2 = face.halfEdge.vertex.position;
            const p3 = face.halfEdge.next.vertex.position;
            const mid = p1.clone().add(p2).add(p3).divideScalar(3);
            const minLen = Math.min(p1.distanceTo(p2), p2.distanceTo(p3), p3.distanceTo(p1));

            this.createMarker(p1, 0x3b82f6, minLen);
            this.createMarker(p2, 0x10b981, minLen);
            this.createMarker(p3, 0xc084fc, minLen);
            this.createMarker(mid, 0xffffff, minLen);
        }
    }

    createMarker(pos, color) {
        const dotGeo = new THREE.BufferGeometry().setFromPoints([pos]);
        const dotMat = new THREE.PointsMaterial({
            color,
            size: MARKER_UI_SIZE,
            sizeAttenuation: false,
            map: this.dotTexture,
            transparent: true,
            alphaTest: 0.5,
            depthTest: false
        });

        const points = new THREE.Points(dotGeo, dotMat);
        points.renderOrder = 2000;
        this.markers.add(points);
    }


    deleteSelectedItem() {
        const mode = this.selection.mode;
        this.pushState();

        let result = false;
        if (mode === 'face' && this.selection.face) {
            result = this.mesh.deleteFace(this.selection.face);
        } else if (mode === 'edge' && this.selection.edge) {
            result = this.mesh.deleteEdge(this.selection.edge);
        } else if (mode === 'vertex' && this.selection.vertex) {
            result = this.mesh.deleteVertex(this.selection.vertex);
        }

        if (result) {
            console.log(`[MeshPrep] Item deleted (${mode}).`);
            this.mesh.validateTopology();
            this.markPartsDirty(this.activeObject);
            this.updateMeshDisplay();
            this.updateStats();
            this.clearSelection();
            this.refreshSceneUI();
        } else {
            this.undo(); // Rollback if failed
        }
    }

    dissolveSelectedItem() {
        const mode = this.selection.mode;
        if (mode !== 'vertex' || !this.selection.vertex) return;

        this.pushState();
        const result = this.mesh.dissolveVertex(this.selection.vertex);

        if (result) {
            console.log(`[MeshPrep] Vertex dissolved.`);
            this.mesh.validateTopology();
            this.markPartsDirty(this.activeObject);
            this.updateMeshDisplay();
            this.updateStats();
            this.clearSelection();
            this.refreshSceneUI();
        } else {
            console.warn("[MeshPrep] Dissolve failed (Boundary or complex valence).");
            this.undo();
        }
    }

    showHideMergeMenu(x, y) {
        let content = '';
        if (this.selection.mode === 'edge') {
            content = `
                <div class="floating-menu-header">Edge Control</div>
                <div class="merge-btn-group">
                    <button class="merge-btn p1" title="Merge to Blue">P1</button>
                    <button class="merge-btn center" title="Merge to Center">MID</button>
                    <button class="merge-btn p2" title="Merge to Green">P2</button>
                </div>
                <button class="btn btn-delete">DELETE EDGE</button>
                <div class="btn-cancel" id="btn-cancel-merge">CANCEL</div>
            `;
            const smartOffset = this.calculateSmartMenuOffset(x, y, this.selection.edge);
            this.floatingMenu.show(x + smartOffset.x, y + smartOffset.y, content);
            this.floatingMenu.element.querySelector('.p1').onclick = () => this.collapseSelectedEdge('P1');
            this.floatingMenu.element.querySelector('.center').onclick = () => this.collapseSelectedEdge('CENTER');
            this.floatingMenu.element.querySelector('.p2').onclick = () => this.collapseSelectedEdge('P2');
            this.floatingMenu.element.querySelector('.btn-delete').onclick = () => this.deleteSelectedItem();
        } else if (this.selection.mode === 'face') {
            const face = this.selection.face;
            const he = face.halfEdge;
            const p1 = he.prev.vertex.position;
            const p2 = he.vertex.position;
            const p3 = he.next.vertex.position;

            // Calculate angles at each vertex
            const a1 = this.calculateAngle(p2, p1, p3); // angle at V1
            const a2 = this.calculateAngle(p1, p2, p3); // angle at V2
            const a3 = this.calculateAngle(p1, p3, p2); // angle at V3
            const minAngle = Math.min(a1, a2, a3);
            const isSliver = minAngle < 15;

            // Find the sharpest vertex (smallest angle = the tip to collapse towards)
            let defaultTarget = 'center'; // CSS class
            if (isSliver) {
                if (a1 <= a2 && a1 <= a3) defaultTarget = 'p1';
                else if (a2 <= a1 && a2 <= a3) defaultTarget = 'p2';
                else defaultTarget = 'v3';
            }

            // Build buttons — hide MID for slivers
            const midBtn = isSliver ? '' : `<button class="merge-btn center" title="Collapse face to Midpoint">TO MID</button>`;
            const highlight = (cls) => cls === defaultTarget ? 'border-width: 2px; box-shadow: 0 0 6px var(--palette-teal);' : '';

            content = `
                <div class="floating-menu-header">Face Control${isSliver ? ' <span class="sliver-warning">⚠ SLIVER</span>' : ''}</div>
                <div class="merge-btn-group">
                    <button class="merge-btn p1" style="${highlight('p1')}" title="Collapse to V1 (${a1.toFixed(0)}°)">V1</button>
                    <button class="merge-btn p2" style="${highlight('p2')}" title="Collapse to V2 (${a2.toFixed(0)}°)">V2</button>
                    <button class="merge-btn v3" style="${highlight('v3')}" title="Collapse to V3 (${a3.toFixed(0)}°)">V3</button>
                    ${midBtn}
                </div>
                <button class="btn btn-delete">DELETE FACE</button>
                <div class="btn-cancel" id="btn-cancel-merge">CANCEL</div>
            `;
            const smartOffset = this.calculateSmartMenuOffset(x, y, this.selection.face);
            this.floatingMenu.show(x + smartOffset.x, y + smartOffset.y, content);
            this.floatingMenu.element.querySelector('.p1').onclick = () => this.collapseSelectedFace('V1');
            this.floatingMenu.element.querySelector('.p2').onclick = () => this.collapseSelectedFace('V2');
            this.floatingMenu.element.querySelector('.v3').onclick = () => this.collapseSelectedFace('V3');
            const centerBtn = this.floatingMenu.element.querySelector('.center');
            if (centerBtn) centerBtn.onclick = () => this.collapseSelectedFace('CENTER');
            this.floatingMenu.element.querySelector('.btn-delete').onclick = () => this.deleteSelectedItem();
        } else if (this.selection.mode === 'vertex') {
            content = `
                <div class="floating-menu-header">Vertex Control</div>
                <button class="btn btn-delete">DELETE VERTEX</button>
                <button class="btn btn-dissolve">DISSOLVE VERTEX</button>
                <div class="btn-cancel" id="btn-cancel-merge">CANCEL</div>
            `;
            const smartOffset = this.calculateSmartMenuOffset(x, y, this.selection.vertex);
            this.floatingMenu.show(x + smartOffset.x, y + smartOffset.y, content);
            this.floatingMenu.element.querySelector('.btn-delete').onclick = () => this.deleteSelectedItem();
            this.floatingMenu.element.querySelector('.btn-dissolve').onclick = () => this.dissolveSelectedItem();
        }
        this.floatingMenu.element.querySelector('#btn-cancel-merge').onclick = () => this.clearSelection();
    }

    /** Context menu for a picked connected part. */
    showPartMenu(x, y) {
        const n = this.selectedParts.size;
        if (!n) { this.floatingMenu.hide(); return; }
        const parts = [...this.selectedParts].map(k => this.partByKey(k)).filter(Boolean);
        const faces = parts.reduce((s, p) => s + p.faceCount, 0);

        this.floatingMenu.show(x + 20, y + 20, `
            <div class="floating-menu-header">${n > 1 ? `${n} Parts` : `Part ${parts[0] ? parts[0].index + 1 : '?'}`} · ${faces.toLocaleString()} f</div>
            <button class="btn btn-part-focus">FRAME</button>
            <button class="btn btn-part-split">SPLIT OFF</button>
            <button class="btn btn-delete">DELETE ${n > 1 ? 'PARTS' : 'PART'}</button>
            <div class="btn-cancel" id="btn-cancel-merge">CANCEL</div>
        `);
        this.floatingMenu.element.querySelector('.btn-part-focus').onclick = () => { if (parts[0]) this.focusPart(parts[0]); };
        this.floatingMenu.element.querySelector('.btn-part-split').onclick = () => { this.floatingMenu.hide(); this.splitPartsToObjects(parts); };
        this.floatingMenu.element.querySelector('.btn-delete').onclick = () => this.deleteSelectedParts();
        this.floatingMenu.element.querySelector('#btn-cancel-merge').onclick = () => this.clearSelection();
    }

    /**
     * Calculates an offset to avoid overlapping face vertices in screen space.
     */
    calculateSmartMenuOffset(clickX, clickY, item) {
        const rect = this.container.getBoundingClientRect();
        const verts = [];
        if (this.selection.mode === 'face') {
            const he = item.halfEdge;
            verts.push(he.prev.vertex.position, he.vertex.position, he.next.vertex.position);
        } else if (this.selection.mode === 'edge') {
            verts.push(item.prev.vertex.position, item.vertex.position);
        } else if (this.selection.mode === 'vertex') {
            verts.push(item.position);
        }

        // Project vertices to screen space relative to canvas
        const screenVerts = verts.map(p => {
            const v = p.clone().project(this.camera);
            return {
                x: (v.x * 0.5 + 0.5) * rect.width,
                y: (-v.y * 0.5 + 0.5) * rect.height
            };
        });

        const localX = clickX - rect.left;
        const localY = clickY - rect.top;

        // Try 4 quadrants: bottom-right, bottom-left, top-right, top-left
        const menuWidth = 160;
        const menuHeight = 120;
        const margin = 20;

        const candidates = [
            { x: margin, y: margin },                      // BR
            { x: -menuWidth - margin, y: margin },          // BL
            { x: margin, y: -menuHeight - margin },         // TR
            { x: -menuWidth - margin, y: -menuHeight - margin } // TL
        ];

        let bestCandidate = candidates[0];
        let maxMinDist = -1;

        candidates.forEach(c => {
            // Menu rect in local canvas coords
            const r = {
                left: localX + c.x,
                right: localX + c.x + menuWidth,
                top: localY + c.y,
                bottom: localY + c.y + menuHeight
            };

            // Calculate minimum distance from any vertex to this rect
            let minDist = Infinity;
            screenVerts.forEach(v => {
                const dx = Math.max(r.left - v.x, 0, v.x - r.right);
                const dy = Math.max(r.top - v.y, 0, v.y - r.bottom);
                const dist = Math.sqrt(dx * dx + dy * dy);
                if (dist < minDist) minDist = dist;
            });

            if (minDist > maxMinDist) {
                maxMinDist = minDist;
                bestCandidate = c;
            }
        });

        return bestCandidate;
    }

    findNearestEdge(face, point) {
        let nearest = null;
        let minDist = Infinity;
        let he = face.halfEdge;
        for (let i = 0; i < 3; i++) {
            const p1 = he.prev.vertex.position;
            const p2 = he.vertex.position;
            const line = new THREE.Line3(p1, p2);
            const closest = new THREE.Vector3();
            line.closestPointToPoint(point, true, closest);
            const d = point.distanceTo(closest);
            if (d < minDist) {
                minDist = d;
                nearest = he;
            }
            he = he.next;
        }
        return nearest;
    }

    findNearestVertex(face, point) {
        let nearest = null;
        let minDist = Infinity;
        let he = face.halfEdge;
        for (let i = 0; i < 3; i++) {
            const d = point.distanceTo(he.vertex.position);
            if (d < minDist) {
                minDist = d;
                nearest = he.vertex;
            }
            he = he.next;
        }
        return nearest;
    }

    createOverlay(face, color, opacity, targetGroup) {
        const geometry = new THREE.BufferGeometry();
        const he = face.halfEdge;
        const positions = new Float32Array([
            he.prev.vertex.position.x, he.prev.vertex.position.y, he.prev.vertex.position.z,
            he.vertex.position.x, he.vertex.position.y, he.vertex.position.z,
            he.next.vertex.position.x, he.next.vertex.position.y, he.next.vertex.position.z
        ]);
        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity, side: THREE.DoubleSide, depthTest: false, depthWrite: false });
        const mesh = new THREE.Mesh(geometry, mat);
        mesh.renderOrder = 999;
        targetGroup.add(mesh);
    }

    createEdgeLine(he, color, targetGroup) {
        const p1 = he.prev.vertex.position;
        const p2 = he.vertex.position;
        const geometry = new THREE.BufferGeometry().setFromPoints([p1, p2]);
        const mat = new THREE.LineBasicMaterial({ color, linewidth: 3, depthTest: false, depthWrite: false });
        const line = new THREE.Line(geometry, mat);
        line.renderOrder = 1000;
        targetGroup.add(line);
    }

    createVertexDot(vertex, color, targetGroup) {
        const dotGeo = new THREE.BufferGeometry().setFromPoints([vertex.position]);
        const dotMat = new THREE.PointsMaterial({
            color,
            size: MARKER_UI_SIZE * 0.8, // Selection dot slightly smaller
            sizeAttenuation: false,
            transparent: true,
            depthTest: false
        });
        const points = new THREE.Points(dotGeo, dotMat);
        points.renderOrder = 1001;
        targetGroup.add(points);
    }

    clearHighlight() {
        this.highlights.clear();
        this.hoverPart(null);
    }

    clearSelection() {
        this.selection.face = null;
        this.selection.edge = null;
        this.selection.vertex = null;
        this.persistentHighlights.clear();
        this.markers.clear();
        this.floatingMenu.hide();
        this.updateSelectionSidebar('');

        if (this.selection.part || this.selectedParts.size) {
            this.selection.part = null;
            this.selectedParts.clear();
            this.clearGroup(this.partHighlights);
            this.refreshSceneUI();
        }
        this.hoverPart(null);
        this._partAnchorKey = null;
        this.refreshSelectionBar(); // also covers face/edge/vertex deselect
    }

    async handleFile(e) {
        const file = e.target.files[0];
        if (!file) return;

        console.log(`[MeshPrep] Loading file: ${file.name} `);
        this.originalFileName = file.name;
        const extension = file.name.split('.').pop().toLowerCase();
        const reader = new FileReader();

        reader.onload = async (event) => {
            const contents = event.target.result;
            let geometry = null;

            try {
                if (extension === 'obj') {
                    const loader = new OBJLoader();
                    const group = loader.parse(contents);
                    this.loadGeometry(null, group);
                } else if (extension === 'stl') {
                    const loader = new STLLoader();
                    const geometry = loader.parse(contents);
                    this.loadGeometry(geometry);
                } else if (extension === 'glb' || extension === 'gltf') {
                    const loader = new GLTFLoader();
                    const gltf = await new Promise((resolve, reject) => {
                        loader.parse(contents, '', resolve, reject);
                    });
                    this.loadGeometry(null, gltf.scene);
                }
            } catch (err) {
                console.error("[MeshPrep] Failed to parse file:", err);
            }
        };

        if (extension === 'obj') reader.readAsText(file);
        else reader.readAsArrayBuffer(file);
    }

    mergeGroupGeometry(group) {
        const geometries = [];
        group.traverse(child => {
            if (child.isMesh) {
                let geo = child.geometry.clone();
                child.updateMatrixWorld();
                geo.applyMatrix4(child.matrixWorld);
                geometries.push(geo);
            }
        });

        if (geometries.length === 0) return null;
        if (geometries.length === 1) return geometries[0];

        return BufferGeometryUtils.mergeGeometries(geometries);
    }

    onWindowResize() {
        const width = this.container.clientWidth;
        const height = this.container.clientHeight;
        if (!width || !height) return; // off stage the box measures 0×0 — keep the last size
        this.camera.aspect = width / height;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(width, height);
    }

    animate() {
        if (this._disposed) return;
        this._raf = requestAnimationFrame(() => this.animate());
        if (!IS_VISIBLE()) return;
        this.controls.update();
        this.renderer.render(this.scene, this.camera);
    }
}

/**
 * Start the optimizer inside an app element. `root` holds the markup app.js built;
 * `host` supplies what the module cannot know: whether the app is on screen, and how
 * files are saved. Returns { app, openFile, dispose }.
 */
export function start(root, host) {
    ROOT = root;
    IS_VISIBLE = host.isVisible;
    saveFile = host.saveFile;
    const app = new MeshPrepApp();
    return {
        app,
        openFile: (file) => app.handleFile({ target: { files: [file] } }),
        dispose() {
            app._disposed = true;
            cancelAnimationFrame(app._raf);
            app._resizeObserver?.disconnect();
            app.renderer.dispose();
            app.renderer.domElement.remove();
            app.floatingMenu.element.remove();
        },
    };
}
