import * as THREE from '../lib/three.module.min.js';
import * as CANNON from '../lib/cannon-es.js';
import { appearanceOf } from './presets.mjs';
import { diceSound } from './sound.mjs';
import { GLYPH } from './engine.mjs';

/**
 * 3D dice: real polyhedra (d4 to d20, d100 as two d10) rendered with three.js and thrown with cannon-es physics.
 *
 * Every throw is simulated first, in one go, and recorded. Then the numbers are laid out so the face that ends up
 * on top shows the actual result, and the recording is played back. So the dice always agree with the chat card.
 *
 * Smooth dice are shaded materials (gem, glass, metal, flat). Pixel dice are drawn into a low-resolution target
 * with banded toon shading and hard edges, then scaled up without smoothing, so they look like sprites.
 */

const TAU = Math.PI * 2;
const PIX = 3;
const FPS = 60;
const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const UP = new THREE.Vector3(0, 1, 0);

/* ------------------------------------------------------------------ */
/*  Shapes                                                             */
/* ------------------------------------------------------------------ */

const PHI = (1 + Math.sqrt(5)) / 2;
const V = (x, y, z) => new THREE.Vector3(x, y, z);

function d10Vertices() {
	const h = 1.05;
	const z = (h * (1 - Math.cos(Math.PI / 5))) / (1 + Math.cos(Math.PI / 5));
	const out = [V(0, h, 0), V(0, -h, 0)];
	for (let i = 0; i < 5; i++) {
		const a = (i * TAU) / 5;
		out.push(V(Math.cos(a), z, Math.sin(a)));
		out.push(V(Math.cos(a + Math.PI / 5), -z, Math.sin(a + Math.PI / 5)));
	}
	return out;
}

const VERTS = {
	4: () => [V(1, 1, 1), V(-1, -1, 1), V(-1, 1, -1), V(1, -1, -1)].map((v) => v.multiplyScalar(0.85)),
	6: () => [-1, 1].flatMap((x) => [-1, 1].flatMap((y) => [-1, 1].map((z) => V(x, y, z).multiplyScalar(0.72)))),
	8: () => [V(1, 0, 0), V(-1, 0, 0), V(0, 1, 0), V(0, -1, 0), V(0, 0, 1), V(0, 0, -1)].map((v) => v.multiplyScalar(1.05)),
	10: d10Vertices,
	12: () => {
		const a = 1 / PHI;
		const pts = [];
		for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1]) pts.push(V(x, y, z));
		for (const s of [-1, 1]) for (const t of [-1, 1]) pts.push(V(0, s * a, t * PHI), V(s * a, t * PHI, 0), V(s * PHI, 0, t * a));
		return pts.map((v) => v.multiplyScalar(0.62));
	},
	20: () => {
		const pts = [];
		for (const s of [-1, 1]) for (const t of [-1, 1]) pts.push(V(0, s, t * PHI), V(s, t * PHI, 0), V(s * PHI, 0, t));
		return pts.map((v) => v.multiplyScalar(0.6));
	},
};

/** The faces of a convex shape from its corners: every plane all the corners sit behind, its corners in order */
function hull(verts) {
	const faces = [];
	const n = verts.length;
	const center = verts.reduce((c, v) => c.add(v), V(0, 0, 0)).multiplyScalar(1 / n);
	for (let i = 0; i < n; i++)
		for (let j = i + 1; j < n; j++)
			for (let k = j + 1; k < n; k++) {
				const nrm = new THREE.Vector3().subVectors(verts[j], verts[i]).cross(new THREE.Vector3().subVectors(verts[k], verts[i]));
				if (nrm.lengthSq() < 1e-8) continue;
				nrm.normalize();
				let d = nrm.dot(verts[i]);
				if (nrm.dot(center) > d) {
					nrm.negate();
					d = -d;
				}
				if (verts.some((v) => nrm.dot(v) - d > 1e-4)) continue;
				// one face per plane (compare normals, not rounded strings: -0.000 and 0.000 differ as text)
				if (faces.some((f) => f.normal.dot(nrm) > 0.9999)) continue;
				const idx = verts.map((v, m) => (Math.abs(nrm.dot(v) - d) < 1e-4 ? m : -1)).filter((m) => m >= 0);
				const fc = idx.reduce((c, m) => c.add(verts[m]), V(0, 0, 0)).multiplyScalar(1 / idx.length);
				const u = new THREE.Vector3().subVectors(verts[idx[0]], fc).normalize();
				const w = new THREE.Vector3().crossVectors(nrm, u);
				idx.sort((a, b) => {
					const pa = new THREE.Vector3().subVectors(verts[a], fc);
					const pb = new THREE.Vector3().subVectors(verts[b], fc);
					return Math.atan2(pa.dot(w), pa.dot(u)) - Math.atan2(pb.dot(w), pb.dot(u));
				});
				faces.push({ idx, normal: nrm, center: fc, u, w });
			}
	return faces;
}

/** Shape data per die size, built once: corners, faces, each face's corners in texture space */
const SHAPE_CACHE = new Map();
function shapeData(faces) {
	const key = VERTS[faces] ? faces : faces === 100 ? 10 : faces > 12 ? 20 : faces > 10 ? 12 : faces > 8 ? 10 : faces > 6 ? 8 : faces > 4 ? 6 : 4;
	if (SHAPE_CACHE.has(key)) return SHAPE_CACHE.get(key);
	const verts = VERTS[key]();
	const hf = hull(verts);
	for (const f of hf) {
		// the face's corners laid flat in a unit square, a little in from the edge
		const pts = f.idx.map((m) => {
			const p = new THREE.Vector3().subVectors(verts[m], f.center);
			return [p.dot(f.u), p.dot(f.w)];
		});
		const span = Math.max(...pts.map(([x, y]) => Math.max(Math.abs(x), Math.abs(y)))) * 2;
		f.uv = pts.map(([x, y]) => [0.5 + (x / span) * 0.92, 0.5 + (y / span) * 0.92]);
	}
	const data = { key, verts, faces: hf };
	SHAPE_CACHE.set(key, data);
	return data;
}

/** A mesh geometry with one material group per face */
function geometryOf(shape) {
	const pos = [];
	const uv = [];
	const g = new THREE.BufferGeometry();
	let start = 0;
	shape.faces.forEach((f, fi) => {
		for (let t = 1; t < f.idx.length - 1; t++) {
			for (const c of [0, t, t + 1]) {
				const v = shape.verts[f.idx[c]];
				pos.push(v.x, v.y, v.z);
				uv.push(f.uv[c][0], f.uv[c][1]);
			}
		}
		const count = (f.idx.length - 2) * 3;
		g.addGroup(start, count, fi);
		start += count;
	});
	g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
	g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
	g.computeVertexNormals();
	return g;
}

function bodyShape(shape) {
	return new CANNON.ConvexPolyhedron({ vertices: shape.verts.map((v) => new CANNON.Vec3(v.x, v.y, v.z)), faces: shape.faces.map((f) => [...f.idx]) });
}

/* ------------------------------------------------------------------ */
/*  Face textures                                                      */
/* ------------------------------------------------------------------ */

const TEX_CACHE = new Map();
const lookKey = (L) => [L.style, L.material, L.body, L.edge, L.number].join('|');

/**
 * A face: the body color, a rim along the face's edges, and its number (or, on a d4, a number at each corner).
 * @param {string[]} [corners] d4: the number at each corner of this face
 */
function faceTexture(shape, fi, label, L, corners = null) {
	const key = `${shape.key}|${fi}|${label}|${corners?.join('') ?? ''}|${lookKey(L)}`;
	if (TEX_CACHE.has(key)) return TEX_CACHE.get(key);
	const pixel = L.style === 'pixel';
	const S = pixel ? 48 : 192;
	const cv = document.createElement('canvas');
	cv.width = cv.height = S;
	const c = cv.getContext('2d');
	c.imageSmoothingEnabled = !pixel;
	const f = shape.faces[fi];
	c.fillStyle = L.body;
	c.fillRect(0, 0, S, S);
	// a soft lighter centre on gems and glass
	if (!pixel && (L.material === 'gem' || L.material === 'glass')) {
		const gr = c.createRadialGradient(S * 0.4, S * 0.38, S * 0.05, S / 2, S / 2, S * 0.6);
		gr.addColorStop(0, 'rgba(255,255,255,0.28)');
		gr.addColorStop(1, 'rgba(255,255,255,0)');
		c.fillStyle = gr;
		c.fillRect(0, 0, S, S);
	}
	c.strokeStyle = L.edge;
	c.lineWidth = pixel ? 2 : S * 0.035;
	c.beginPath();
	f.uv.forEach(([u, v], i) => (i ? c.lineTo(u * S, (1 - v) * S) : c.moveTo(u * S, (1 - v) * S)));
	c.closePath();
	c.stroke();
	const write = (text, x, y, size, rot = 0) => {
		if (pixel) return writePixel(text, x, y, size, rot);
		c.save();
		c.translate(x, y);
		c.rotate(rot);
		c.font = `700 ${Math.round(size)}px "FUD Antonio", "Antonio", "Arial Narrow", sans-serif`;
		c.textAlign = 'center';
		c.textBaseline = 'middle';
		c.lineWidth = Math.max(2, size * 0.14);
		c.strokeStyle = 'rgba(0,0,0,0.75)';
		c.strokeText(text, 0, 0);
		c.fillStyle = L.number;
		c.fillText(text, 0, 0);
		// 6 and 9 get a mark so they read the right way up
		if (text === '6' || text === '9') c.fillRect(-size * 0.18, size * 0.42, size * 0.36, Math.max(1, size * 0.07));
		c.restore();
	};
	// pixel dice: the 3x5 bitmap digits, hard-edged, with a dark outline
	const writePixel = (text, x, y, size, rot) => {
		const s = [...String(text)];
		const k = Math.max(1, Math.round(size / 5));
		const w = s.length * 4 - 1;
		c.save();
		c.translate(Math.round(x), Math.round(y));
		c.rotate(Math.round(rot / (Math.PI / 2)) * (Math.PI / 2));
		const paint = (dx, dy, col) => {
			c.fillStyle = col;
			s.forEach((ch, i) => {
				const g = GLYPH[ch] ?? GLYPH['?'];
				for (let q = 0; q < 15; q++) if (g[q] === '1') c.fillRect(Math.round((-w / 2 + i * 4 + (q % 3)) * k) + dx, Math.round((-2.5 + Math.floor(q / 3)) * k) + dy, k, k);
			});
		};
		for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) paint(dx * Math.max(1, k / 2), dy * Math.max(1, k / 2), 'rgba(0,0,0,0.85)');
		paint(0, 0, L.number);
		c.restore();
	};
	const cx = (f.uv.reduce((s, p) => s + p[0], 0) / f.uv.length) * S;
	const cy = (1 - f.uv.reduce((s, p) => s + p[1], 0) / f.uv.length) * S;
	if (corners) {
		f.uv.forEach(([u, v], i) => {
			const x = cx + (u * S - cx) * 0.55;
			const y = cy + ((1 - v) * S - cy) * 0.55;
			write(corners[i], x, y, S * 0.2, Math.atan2(y - cy, x - cx) + Math.PI / 2);
		});
	} else {
		const n = shape.faces[0].idx.length;
		const big = pixel ? (n === 3 ? 0.42 : 0.55) * (label.length > 1 ? 0.62 : 1) : (n === 3 ? 0.3 : n === 4 ? 0.42 : 0.36) * (label.length > 2 ? 0.75 : 1);
		write(label, cx, cy, S * big);
	}
	const tex = new THREE.CanvasTexture(cv);
	tex.colorSpace = THREE.SRGBColorSpace;
	if (pixel) tex.magFilter = tex.minFilter = THREE.NearestFilter;
	else tex.anisotropy = 4;
	TEX_CACHE.set(key, tex);
	if (TEX_CACHE.size > 600) TEX_CACHE.clear();
	return tex;
}

let toonRamp = null;
function toonGradient() {
	if (toonRamp) return toonRamp;
	const data = new Uint8Array([90, 170, 255]);
	toonRamp = new THREE.DataTexture(data, 3, 1, THREE.RedFormat);
	toonRamp.magFilter = toonRamp.minFilter = THREE.NearestFilter;
	toonRamp.needsUpdate = true;
	return toonRamp;
}

function material(L, map) {
	const glow = new THREE.Color(L.glow);
	if (L.style === 'pixel') return new THREE.MeshToonMaterial({ map, gradientMap: toonGradient(), transparent: true });
	const base = { map, transparent: true, emissive: glow, emissiveIntensity: 0.06 };
	if (L.material === 'metal') return new THREE.MeshStandardMaterial({ ...base, metalness: 0.55, roughness: 0.32 });
	if (L.material === 'glass') return new THREE.MeshPhysicalMaterial({ ...base, opacity: 0.86, roughness: 0.08, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.05, emissiveIntensity: 0.16 });
	if (L.material === 'gem') return new THREE.MeshPhysicalMaterial({ ...base, roughness: 0.18, metalness: 0.05, clearcoat: 0.8, emissiveIntensity: 0.1 });
	return new THREE.MeshStandardMaterial({ ...base, roughness: 0.75, metalness: 0 });
}

/* ------------------------------------------------------------------ */
/*  Particles and rings                                                */
/* ------------------------------------------------------------------ */

const SPRITES = new Map();
function spriteTexture(kind, color) {
	const key = `${kind}|${color}`;
	if (SPRITES.has(key)) return SPRITES.get(key);
	const S = 32;
	const cv = document.createElement('canvas');
	cv.width = cv.height = S;
	const c = cv.getContext('2d');
	const col = kind === 'fire' ? '#ffb347' : kind === 'embers' ? '#ffc23d' : kind === 'ice' ? '#dff8ff' : kind === 'stars' ? '#ffe27a' : kind === 'feathers' ? '#ffffff' : color;
	c.fillStyle = col;
	if (kind === 'motes' || kind === 'fire') {
		const g = c.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
		g.addColorStop(0, '#ffffff');
		g.addColorStop(0.35, col);
		g.addColorStop(1, 'rgba(0,0,0,0)');
		c.fillStyle = g;
		c.fillRect(0, 0, S, S);
	} else {
		const pts = kind === 'stars' ? 5 : 4;
		const inner = kind === 'ice' || kind === 'shards' ? 0.25 : 0.38;
		c.beginPath();
		for (let i = 0; i < pts * 2; i++) {
			const a = -Math.PI / 2 + (i * Math.PI) / pts;
			const r = (i % 2 ? inner : 1) * (S / 2 - 1);
			c.lineTo(S / 2 + Math.cos(a) * r, S / 2 + Math.sin(a) * r);
		}
		c.closePath();
		c.fill();
	}
	const tex = new THREE.CanvasTexture(cv);
	tex.colorSpace = THREE.SRGBColorSpace;
	SPRITES.set(key, tex);
	return tex;
}

/* ------------------------------------------------------------------ */
/*  The stage                                                          */
/* ------------------------------------------------------------------ */

export function webglAvailable() {
	try {
		const c = document.createElement('canvas');
		return !!(c.getContext('webgl2') || c.getContext('webgl'));
	} catch {
		return false;
	}
}

export class DiceStage3D {
	/** @param {{canvas?: HTMLCanvasElement, settings?: () => object}} [opts] same as the 2D stage */
	constructor({ canvas = null, settings = () => ({}) } = {}) {
		this.own = !!canvas;
		this.canvas = canvas;
		this.settings = settings;
		this.throws = [];
		this.fx = [];
		this.raf = null;
	}

	#ensure() {
		if (!this.renderer) {
			if (!this.canvas) {
				this.canvas = document.createElement('canvas');
				this.canvas.className = 'fud-overlay';
				document.body.append(this.canvas);
			}
			const r = new THREE.WebGLRenderer({ canvas: this.canvas, alpha: true, antialias: true, powerPreference: 'high-performance' });
			r.setClearColor(0x000000, 0);
			r.shadowMap.enabled = true;
			r.shadowMap.type = THREE.PCFSoftShadowMap;
			r.outputColorSpace = THREE.SRGBColorSpace;
			this.renderer = r;
			this.scene = new THREE.Scene();
			this.camera = new THREE.PerspectiveCamera(32, 1, 1, 400);
			const hemi = new THREE.HemisphereLight(0xdfe8ff, 0x1b2030, 1.6);
			const sun = new THREE.DirectionalLight(0xffffff, 2.2);
			sun.position.set(-12, 30, 14);
			sun.castShadow = true;
			sun.shadow.mapSize.set(1024, 1024);
			Object.assign(sun.shadow.camera, { left: -30, right: 30, top: 30, bottom: -30, near: 1, far: 80 });
			for (const l of [hemi, sun]) l.layers.enableAll();
			sun.shadow.camera.layers.enableAll();
			this.scene.add(hemi, sun);
			const floor = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), new THREE.ShadowMaterial({ opacity: 0.32 }));
			floor.rotation.x = -Math.PI / 2;
			floor.receiveShadow = true;
			floor.layers.enableAll();
			this.scene.add(floor);
			// pixel dice: a low-resolution pass, scaled up crisp
			this.quadScene = new THREE.Scene();
			this.quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
			this.quad = new THREE.Mesh(
				new THREE.PlaneGeometry(2, 2),
				new THREE.ShaderMaterial({
					uniforms: { tex: { value: null } },
					transparent: true,
					depthTest: false,
					vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
					fragmentShader: 'uniform sampler2D tex; varying vec2 vUv; void main(){ vec4 c = texture2D(tex, vUv); if (c.a < 0.45) discard; gl_FragColor = linearToOutputTexel(vec4(c.rgb / max(c.a, 0.001), 1.0)); }',
				}),
			);
			this.quadScene.add(this.quad);
		}
		const W = this.own ? this.canvas.clientWidth || this.canvas.width : window.innerWidth;
		const H = this.own ? this.canvas.clientHeight || this.canvas.height : window.innerHeight;
		if (W !== this.W || H !== this.H) {
			this.W = W;
			this.H = H;
			this.renderer.setPixelRatio(Math.min(1.5, window.devicePixelRatio || 1));
			this.renderer.setSize(W, H, !this.own);
			this.camera.aspect = W / H;
			// looking down at the table at an angle
			this.camera.position.set(0, 42, 26);
			this.camera.lookAt(0, 0, 0);
			this.camera.updateProjectionMatrix();
			this.camera.updateMatrixWorld(true);
			this.rt?.dispose();
			this.rt = new THREE.WebGLRenderTarget(Math.ceil(W / PIX), Math.ceil(H / PIX), { magFilter: THREE.NearestFilter, minFilter: THREE.NearestFilter });
			this.quad.material.uniforms.tex.value = this.rt.texture;
			this.bounds = this.#tableBounds();
		}
		this.canvas.style.display = '';
	}

	/** Where the screen's edges meet the table (y = 0), so the dice stay in view */
	#tableBounds() {
		const pts = [[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([x, y]) => {
			const ray = new THREE.Raycaster();
			ray.setFromCamera(new THREE.Vector2(x, y), this.camera);
			const t = -ray.ray.origin.y / ray.ray.direction.y;
			return ray.ray.origin.clone().addScaledVector(ray.ray.direction, t);
		});
		const top = Math.max(pts[2].z, pts[3].z);
		const bottom = Math.min(pts[0].z, pts[1].z);
		// the near edge is the narrow one; on the full screen keep clear of the chat sidebar on the right
		const half = Math.min(Math.abs(pts[0].x), Math.abs(pts[1].x));
		return { minX: -half, maxX: this.own ? half : half * 0.62, minZ: top, maxZ: bottom };
	}

	/** World units per screen pixel at the middle of the table */
	#unitsPerPixel() {
		const dist = this.camera.position.length();
		return (2 * dist * Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2))) / this.H;
	}

	/**
	 * @param {{faces:number, value:?number}[]} list
	 * @param {{appearance?: object, crit?: boolean, fumble?: boolean}} [opts]
	 * @returns {Promise<void>} when the dice have landed
	 */
	roll(list, { appearance, crit = false, fumble = false } = {}) {
		this.#ensure();
		const L = appearanceOf(appearance);
		const set = this.settings();
		const px = (this.own ? Math.min(this.W, this.H) * 0.13 : 36) * clamp(Number(set.size) || 1, 0.5, 2);
		const scale = px * this.#unitsPerPixel();
		// d100: a tens die and a units die
		const dice = list.flatMap((d) => {
			if (d.faces !== 100) return [{ faces: d.faces, value: d.value }];
			if (d.value == null) return [{ faces: 100, value: null, tens: true }, { faces: 10, value: null }];
			const v = d.value % 100;
			return [{ faces: 100, value: Math.floor(v / 10) * 10, tens: true }, { faces: 10, value: v % 10 || 10, unitsOf100: true }];
		});
		const sim = this.#simulate(dice, scale);
		const group = { L, crit, fumble, dice: [], resolve: null, landedAt: null };
		const done = new Promise((res) => (group.resolve = res));
		sim.forEach((s, i) => group.dice.push(this.#makeDie(dice[i], s, L, scale)));
		group.frames = Math.max(...sim.map((s) => s.frames.length / 7));
		group.hits = sim.flatMap((s) => s.hits);
		group.t = 0;
		this.throws.push(group);
		diceSound(L.sound, 'throw', set.volume);
		this.#start();
		return done;
	}

	/** Run the whole throw now and record it: positions, rotations, bounces, and which face ends up on top */
	#simulate(dice, scale) {
		const world = new CANNON.World({ gravity: new CANNON.Vec3(0, -9.82 * 6 * scale, 0) });
		world.allowSleep = true;
		const mat = new CANNON.Material();
		world.addContactMaterial(new CANNON.ContactMaterial(mat, mat, { friction: 0.25, restitution: 0.38 }));
		const b = this.bounds;
		const wall = (pos, axis, angle) => {
			const body = new CANNON.Body({ mass: 0, material: mat, shape: new CANNON.Plane() });
			body.position.set(...pos);
			body.quaternion.setFromAxisAngle(new CANNON.Vec3(...axis), angle);
			world.addBody(body);
		};
		const m = scale * 1.1;
		wall([0, 0, 0], [1, 0, 0], -Math.PI / 2);
		wall([b.minX + m, 0, 0], [0, 1, 0], Math.PI / 2);
		wall([b.maxX - m, 0, 0], [0, 1, 0], -Math.PI / 2);
		wall([0, 0, b.minZ + m], [0, 1, 0], 0);
		wall([0, 0, b.maxZ - m], [0, 1, 0], Math.PI);
		const bodies = dice.map((d, i) => {
			const shape = shapeData(d.faces);
			const body = new CANNON.Body({ mass: 1, material: mat, linearDamping: 0.12, angularDamping: 0.12, allowSleep: true, sleepSpeedLimit: 0.12 * scale, sleepTimeLimit: 0.25 });
			body.addShape(bodyShape({ ...shape, verts: shape.verts.map((v) => v.clone().multiplyScalar(scale)) }));
			// thrown in from the lower right, toward the middle
			const sx = b.maxX - m * 2 - rand(0, scale * 2);
			const sz = b.maxZ * 0.55 - i * scale * 1.8 + rand(-scale, scale);
			body.position.set(sx, scale * rand(3, 5), sz);
			// land around the middle of the screen, a little low
			const tx = rand(-0.18, 0.04) * (b.maxX - b.minX);
			const tz = rand(0, 0.22) * (b.maxZ - b.minZ) * 0.5;
			const dir = new CANNON.Vec3(tx - sx, 0, tz - sz);
			dir.normalize();
			const speed = scale * rand(9, 12.5);
			body.velocity.set(dir.x * speed, scale * rand(2, 5), dir.z * speed);
			body.angularVelocity.set(rand(-18, 18), rand(-18, 18), rand(-18, 18));
			body.quaternion.setFromEuler(rand(0, TAU), rand(0, TAU), rand(0, TAU));
			world.addBody(body);
			return { body, shape, frames: [], hits: [] };
		});
		let frame = 0;
		for (const s of bodies) s.body.addEventListener('collide', (e) => {
			const v = Math.abs(e.contact.getImpactVelocityAlongNormal());
			if (v > scale * 3) s.hits.push({ frame, v: Math.min(1, v / (scale * 20)) });
		});
		const maxFrames = FPS * 6;
		for (; frame < maxFrames; frame++) {
			world.step(1 / FPS);
			for (const s of bodies) {
				const p = s.body.position;
				const q = s.body.quaternion;
				s.frames.push(p.x, p.y, p.z, q.x, q.y, q.z, q.w);
			}
			if (frame > 20 && bodies.every((s) => s.body.sleepState === CANNON.Body.SLEEPING)) break;
		}
		// which face (d4: which corner) ends up on top
		for (const s of bodies) {
			const n = s.frames.length;
			const q = new THREE.Quaternion(s.frames[n - 4], s.frames[n - 3], s.frames[n - 2], s.frames[n - 1]);
			if (s.shape.key === 4) {
				let best = 0;
				s.shape.verts.forEach((v, i) => {
					if (v.clone().applyQuaternion(q).y > s.shape.verts[best].clone().applyQuaternion(q).y) best = i;
				});
				s.top = best;
			} else {
				let best = 0;
				let bestDot = -2;
				s.shape.faces.forEach((f, i) => {
					const d = f.normal.clone().applyQuaternion(q).dot(UP);
					if (d > bestDot) (bestDot = d), (best = i);
				});
				s.top = best;
			}
		}
		return bodies;
	}

	/** The mesh, with its numbers laid out so the face that lands on top shows the result */
	#makeDie(d, sim, L, scale) {
		const shape = sim.shape;
		const nFaces = shape.faces.length;
		const labelOf = (v) => (d.tens ? String(v === 100 ? 0 : v).padStart(2, '0') : d.faces === 10 || d.unitsOf100 ? String(v % 10) : String(v));
		const values = Array.from({ length: shape.key === 4 ? 4 : nFaces }, (_, i) => (d.tens ? i * 10 : i + 1));
		const want = d.value ?? null;
		const top = sim.top;
		if (want != null) {
			const at = values.indexOf(want);
			if (at >= 0) [values[at], values[top]] = [values[top], values[at]];
		}
		let mats;
		if (shape.key === 4) {
			mats = shape.faces.map((f, fi) => material(L, faceTexture(shape, fi, '', L, f.idx.map((vi) => (want == null && vi === top ? '?' : labelOf(values[vi]))))));
		} else {
			mats = shape.faces.map((f, fi) => material(L, faceTexture(shape, fi, want == null && fi === top ? '?' : labelOf(values[fi]), L)));
		}
		const mesh = new THREE.Mesh(geometryOf(shape), mats);
		mesh.castShadow = true;
		mesh.layers.set(L.style === 'pixel' ? 2 : 1);
		this.scene.add(mesh);
		return { mesh, frames: sim.frames, L, scale, trailAt: 0 };
	}

	#start() {
		if (this.raf) return;
		let last = performance.now();
		const loop = (t) => {
			const dt = Math.min(0.05, (t - last) / 1000);
			last = t;
			const busy = this.#step(dt * clamp(Number(this.settings().speed) || 1, 0.5, 2));
			this.#render();
			if (busy) this.raf = requestAnimationFrame(loop);
			else this.#stop();
		};
		this.raf = requestAnimationFrame(loop);
	}

	#stop() {
		this.raf = null;
		if (!this.own && this.canvas) this.canvas.style.display = 'none';
	}

	#step(dt) {
		const set = this.settings();
		for (const g of this.throws) {
			const prev = Math.floor(g.t * FPS);
			g.t += dt;
			const f = Math.floor(g.t * FPS);
			for (const h of g.hits) if (h.frame > prev && h.frame <= f) diceSound(g.L.sound, 'bounce', set.volume * h.v);
			for (const d of g.dice) {
				const n = d.frames.length / 7;
				const i = Math.min(n - 1, f) * 7;
				const fr = d.frames;
				d.mesh.position.set(fr[i], fr[i + 1], fr[i + 2]);
				d.mesh.quaternion.set(fr[i + 3], fr[i + 4], fr[i + 5], fr[i + 6]);
				d.mesh.scale.setScalar(d.scale);
				// trail while it flies
				if (!set.reduced && d.L.trail !== 'none' && f < n - 10) {
					d.trailAt -= dt;
					const j = Math.max(0, i - 7);
					const speed = Math.hypot(fr[i] - fr[j], fr[i + 1] - fr[j + 1], fr[i + 2] - fr[j + 2]) * FPS;
					if (d.trailAt <= 0 && speed > d.scale * 3) {
						d.trailAt = 0.03;
						this.#spark(d.L, d.L.trail, d.mesh.position, d.scale, false);
					}
				}
			}
			if (g.landedAt == null && f >= g.frames - 1) this.#landed(g, set);
			if (g.landedAt != null) {
				const k = g.t - g.landedAt;
				const glow = k < 1.6 ? 0.35 * Math.sin(Math.min(1, k * 3) * Math.PI) + 0.12 : 0.12;
				const fade = clamp(1 - (k - 1.6) / 0.45, 0, 1);
				for (const d of g.dice)
					for (const m of d.mesh.material) {
						if ('emissiveIntensity' in m) m.emissiveIntensity = glow;
						m.opacity = fade * (m.isMeshPhysicalMaterial && d.L.material === 'glass' ? 0.86 : 1);
					}
				if (fade <= 0) g.gone = true;
			}
		}
		for (const g of this.throws.filter((x) => x.gone))
			for (const d of g.dice) {
				this.scene.remove(d.mesh);
				d.mesh.geometry.dispose();
				for (const m of d.mesh.material) m.dispose();
			}
		this.throws = this.throws.filter((x) => !x.gone);
		for (const p of this.fx) {
			p.age += dt;
			const t = p.age / p.life;
			if (p.ring) {
				p.obj.scale.setScalar(p.size * (0.6 + t * 2.2));
				p.obj.material.opacity = (1 - t) * 0.9;
			} else {
				p.obj.position.addScaledVector(p.vel, dt);
				p.vel.y += p.grav * dt;
				p.obj.material.opacity = 1 - t;
				p.obj.material.rotation += p.spin * dt;
				p.obj.scale.setScalar(p.size * (p.shrink ? 1 - t * 0.6 : 1));
			}
		}
		for (const p of this.fx.filter((x) => x.age >= x.life)) {
			this.scene.remove(p.obj);
			p.obj.material.dispose();
		}
		this.fx = this.fx.filter((x) => x.age < x.life);
		return this.throws.length > 0 || this.fx.length > 0;
	}

	#spark(L, kind, at, scale, burst) {
		if (this.fx.length > 300) return;
		const mat = new THREE.SpriteMaterial({ map: spriteTexture(kind, L.glow), transparent: true, depthWrite: false, blending: kind === 'feathers' ? THREE.NormalBlending : THREE.AdditiveBlending });
		const s = new THREE.Sprite(mat);
		s.position.copy(at).add(new THREE.Vector3(rand(-0.5, 0.5), rand(-0.3, 0.6), rand(-0.5, 0.5)).multiplyScalar(scale));
		s.layers.set(L.style === 'pixel' ? 2 : 1);
		const size = scale * (kind === 'fire' ? rand(0.7, 1.1) : kind === 'motes' ? rand(0.3, 0.5) : rand(0.3, 0.6));
		s.scale.setScalar(size);
		this.scene.add(s);
		const up = kind === 'fire' || kind === 'embers' || kind === 'motes' ? 1 : -0.4;
		const vel = burst ? new THREE.Vector3(rand(-1, 1), rand(0.4, 1.2), rand(-1, 1)).multiplyScalar(scale * 7) : new THREE.Vector3(rand(-0.6, 0.6), up * rand(0.5, 1.5), rand(-0.6, 0.6)).multiplyScalar(scale);
		this.fx.push({ obj: s, vel, grav: burst ? -scale * 10 : 0, age: 0, life: rand(0.4, 0.8) * (kind === 'motes' ? 1.6 : 1), size, spin: rand(-4, 4), shrink: kind === 'fire' });
	}

	#ring(L, at, scale, color = L.glow) {
		const geo = new THREE.RingGeometry(0.85, 1, 48);
		const m = new THREE.MeshBasicMaterial({ color: new THREE.Color(color), transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending });
		const ring = new THREE.Mesh(geo, m);
		ring.rotation.x = -Math.PI / 2;
		ring.position.set(at.x, 0.02, at.z);
		ring.layers.set(L.style === 'pixel' ? 2 : 1);
		this.scene.add(ring);
		this.fx.push({ obj: ring, ring: true, age: 0, life: 0.6, size: scale * 1.4 });
	}

	#landed(g, set) {
		g.landedAt = g.t;
		const L = g.L;
		if (!set.reduced) {
			for (const d of g.dice) {
				if (L.land === 'ring' || L.land === 'burst') this.#ring(L, d.mesh.position, d.scale);
				if (L.land === 'burst' || L.land === 'flash') for (let i = 0; i < (L.land === 'burst' ? 12 : 5); i++) this.#spark(L, L.trail === 'none' ? 'sparkle' : L.trail, d.mesh.position, d.scale, true);
			}
			if (g.crit || g.fumble)
				for (const d of g.dice) {
					this.#ring(L, d.mesh.position, d.scale * 1.8, g.crit ? '#ffd34d' : '#ff6b7a');
					for (let i = 0; i < 18; i++) this.#spark(L, g.crit ? 'stars' : 'embers', d.mesh.position, d.scale, true);
				}
		}
		if (g.crit || g.fumble) this.#banner(g.crit ? 'CRITICAL!' : 'FUMBLE', g.crit ? '#ffd34d' : '#ff6b7a', g);
		diceSound(L.sound, g.crit ? 'crit' : g.fumble ? 'fumble' : 'land', set.volume);
		g.resolve();
	}

	/** CRITICAL! / FUMBLE over the dice, as page text so it stays crisp */
	#banner(text, color, g) {
		const c = g.dice.reduce((s, d) => s.add(d.mesh.position), new THREE.Vector3()).multiplyScalar(1 / g.dice.length);
		c.y += g.dice[0].scale * 2.4;
		const p = c.project(this.camera);
		const rect = this.canvas.getBoundingClientRect();
		const el = document.createElement('div');
		el.className = `fud-banner ${g.L.style === 'pixel' ? 'px' : ''}`;
		el.textContent = text;
		el.style.setProperty('--c', color);
		el.style.left = `${rect.left + ((p.x + 1) / 2) * rect.width}px`;
		el.style.top = `${rect.top + ((1 - p.y) / 2) * rect.height}px`;
		document.body.append(el);
		setTimeout(() => el.remove(), 2000);
	}

	#render() {
		const r = this.renderer;
		r.autoClear = true;
		const anyPixel = this.throws.some((g) => g.L.style === 'pixel');
		if (anyPixel) {
			this.camera.layers.set(2);
			r.setRenderTarget(this.rt);
			r.setClearColor(0x000000, 0);
			r.clear();
			r.render(this.scene, this.camera);
		}
		r.setRenderTarget(null);
		this.camera.layers.set(1);
		this.camera.layers.enable(0);
		r.clear();
		r.render(this.scene, this.camera);
		if (anyPixel) {
			r.autoClear = false;
			r.render(this.quadScene, this.quadCam);
			r.autoClear = true;
		}
	}

	clear() {
		for (const g of this.throws) {
			g.resolve?.();
			for (const d of g.dice) this.scene.remove(d.mesh);
		}
		for (const p of this.fx) this.scene.remove(p.obj);
		this.throws = [];
		this.fx = [];
		if (this.renderer) this.#render();
	}
}
