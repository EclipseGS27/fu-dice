import * as THREE from '../lib/three.module.min.js';
import * as CANNON from '../lib/cannon-es.js';
import { appearanceOf } from './presets.mjs';
import { diceSound } from './sound.mjs';
import { faceSeed, surface } from './textures.mjs';
import { drawPixelTextAt } from './pixelfont.mjs';

/**
 * 3D dice: real polyhedra (d4 to d20, d100 as two d10) rendered with three.js and thrown with cannon-es physics.
 *
 * Every throw is simulated first, in one go, and recorded. Then the numbers are laid out so the face that ends up
 * on top shows the actual result, and the recording is played back. So the dice always agree with the chat card.
 *
 * Smooth dice are shaded materials (gem, glass, metal, flat) over a surface texture. Pixel dice follow how 3D
 * pixel art is usually made: drawn into a low-resolution target with three hard light bands and small flat-toned
 * textures, scaled up by whole pixels without smoothing, with a one-pixel dark outline and a hard shadow. Their
 * numbers are not painted on the faces (a rotated, shrunken bitmap number is unreadable): the number on top is
 * drawn upright over the die in a 5x7 pixel font, on the same pixel grid.
 */

const TAU = Math.PI * 2;
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
const lookKey = (L) => [L.style, L.material, L.body, L.edge, L.number, L.texture, L.accent, L.strength].join('|');

/**
 * A face: its surface, a rim along the face's edges and, on smooth dice, its number (on a d4, a number at each
 * corner). Pixel dice have no numbers on their faces: the top number is drawn upright over the die instead.
 * @param {string[]} [corners] d4: the number at each corner of this face
 */
function faceTexture(shape, fi, label, L, corners = null) {
	const pixel = L.style === 'pixel';
	const key = pixel ? `px|${shape.key}|${fi}|${lookKey(L)}` : `${shape.key}|${fi}|${label}|${corners?.join('') ?? ''}|${lookKey(L)}`;
	if (TEX_CACHE.has(key)) return TEX_CACHE.get(key);
	const S = pixel ? 32 : 192;
	// pixel faces are only a dozen pixels wide on screen: half as much pattern, twice as big, so it reads
	const cv = document.createElement('canvas');
	cv.width = cv.height = S;
	const c = cv.getContext('2d');
	c.imageSmoothingEnabled = false;
	const f = shape.faces[fi];
	c.drawImage(surface(L, { size: S, pixel, seed: faceSeed(fi), zoom: pixel ? 0.5 : 1 }), 0, 0);
	// a soft lighter centre on gems and glass
	if (!pixel && (L.material === 'gem' || L.material === 'glass')) {
		const gr = c.createRadialGradient(S * 0.4, S * 0.38, S * 0.05, S / 2, S / 2, S * 0.6);
		gr.addColorStop(0, 'rgba(255,255,255,0.28)');
		gr.addColorStop(1, 'rgba(255,255,255,0)');
		c.fillStyle = gr;
		c.fillRect(0, 0, S, S);
	}
	c.strokeStyle = L.edge;
	c.lineWidth = pixel ? 3 : S * 0.035;
	c.lineJoin = 'miter';
	c.beginPath();
	f.uv.forEach(([u, v], i) => (i ? c.lineTo(u * S, (1 - v) * S) : c.moveTo(u * S, (1 - v) * S)));
	c.closePath();
	c.stroke();
	if (!pixel) {
		const write = (text, x, y, size, rot = 0) => {
			c.save();
			c.translate(x, y);
			c.rotate(rot);
			c.font = `700 ${Math.round(size)}px "FUD Antonio", "Antonio", "Arial Narrow", sans-serif`;
			c.textAlign = 'center';
			c.textBaseline = 'middle';
			c.lineWidth = Math.max(2, size * 0.14);
			c.lineJoin = 'round';
			c.strokeStyle = inkFor(L.number) === INK ? 'rgba(0,0,0,0.75)' : 'rgba(255,248,232,0.85)';
			c.strokeText(text, 0, 0);
			c.fillStyle = L.number;
			c.fillText(text, 0, 0);
			// 6 and 9 get a mark so they read the right way up
			if (text === '6' || text === '9') c.fillRect(-size * 0.18, size * 0.42, size * 0.36, Math.max(1, size * 0.07));
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
			write(label, cx, cy, S * (n === 3 ? 0.3 : n === 4 ? 0.42 : 0.36) * (label.length > 2 ? 0.75 : 1));
		}
	}
	const tex = new THREE.CanvasTexture(cv);
	tex.colorSpace = THREE.SRGBColorSpace;
	if (pixel) {
		tex.magFilter = THREE.NearestFilter;
		tex.minFilter = THREE.NearestMipmapNearestFilter;
	} else tex.anisotropy = 4;
	TEX_CACHE.set(key, tex);
	if (TEX_CACHE.size > 600) TEX_CACHE.clear();
	return tex;
}

let toonRamp = null;
/** Three hard light bands: shadow, mid, lit */
function toonGradient() {
	if (toonRamp) return toonRamp;
	toonRamp = new THREE.DataTexture(new Uint8Array([70, 150, 255]), 3, 1, THREE.RedFormat);
	toonRamp.magFilter = toonRamp.minFilter = THREE.NearestFilter;
	toonRamp.needsUpdate = true;
	return toonRamp;
}

function material(L, map) {
	const glow = new THREE.Color(L.glow);
	let m;
	// pixel dice are opaque and dissolve (dithered) when they leave, so no soft edges reach the pixel pass
	if (L.style === 'pixel') m = new THREE.MeshToonMaterial({ map, gradientMap: toonGradient(), emissive: glow, emissiveIntensity: 0, alphaHash: true });
	else {
		const base = { map, transparent: true, emissive: glow, emissiveIntensity: 0.06 };
		if (L.material === 'metal') m = new THREE.MeshStandardMaterial({ ...base, metalness: 0.55, roughness: 0.32 });
		else if (L.material === 'glass') m = new THREE.MeshPhysicalMaterial({ ...base, opacity: 0.86, roughness: 0.08, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.05, emissiveIntensity: 0.16 });
		else if (L.material === 'gem') m = new THREE.MeshPhysicalMaterial({ ...base, roughness: 0.18, metalness: 0.05, clearcoat: 0.8, emissiveIntensity: 0.1 });
		else m = new THREE.MeshStandardMaterial({ ...base, roughness: 0.75, metalness: 0 });
	}
	m.userData.glow = m.emissiveIntensity;
	m.userData.opacity = m.opacity;
	return m;
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

/** The dark outline around pixel dice and their numbers */
const INK = '#0d0a14';
/** The outline for a number: dark, unless the number itself is dark */
const inkFor = (hex) => {
	const n = parseInt(String(hex).replace('#', '').slice(0, 6), 16) || 0;
	return 0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255) < 110 ? '#f4f1ea' : INK;
};
const easeOutBack = (t) => 1 + 2.7 * Math.pow(t - 1, 3) + 1.7 * Math.pow(t - 1, 2);
const easeOut = (t) => 1 - Math.pow(1 - t, 3);

/*
 * The pixel pass, upscaled: every low-resolution texel becomes a P x P block of screen pixels (whole pixels, so
 * the grid never wobbles). An empty texel next to a die becomes outline; a dark see-through one is shadow.
 */
const QUAD_FRAG = `
uniform sampler2D tex; uniform vec2 size; uniform float px; uniform vec3 ink;
void main() {
	vec2 uv = (floor(gl_FragCoord.xy / px) + 0.5) / size;
	vec4 c = texture2D(tex, uv);
	if (c.a >= 0.5) { gl_FragColor = linearToOutputTexel(vec4(c.rgb / c.a, 1.0)); return; }
	vec2 d = 1.0 / size;
	float n = max(max(texture2D(tex, uv + vec2(d.x, 0.0)).a, texture2D(tex, uv - vec2(d.x, 0.0)).a), max(texture2D(tex, uv + vec2(0.0, d.y)).a, texture2D(tex, uv - vec2(0.0, d.y)).a));
	if (n >= 0.5) { gl_FragColor = vec4(ink, 1.0); return; }
	if (c.a > 0.12 && max(c.r, max(c.g, c.b)) < 0.03) { gl_FragColor = vec4(0.0, 0.0, 0.0, 0.34); return; }
	discard;
}`;

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

	/** How big a die is on screen, in CSS pixels */
	#diePx() {
		return (this.own ? Math.min(this.W, this.H) * 0.13 : 36) * clamp(Number(this.settings().size) || 1, 0.5, 2);
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
			this.sun = sun;
			this.scene.add(hemi, sun);
			const floor = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), new THREE.ShadowMaterial({ opacity: 0.32 }));
			floor.rotation.x = -Math.PI / 2;
			floor.receiveShadow = true;
			floor.layers.enableAll();
			this.scene.add(floor);
			this.quadScene = new THREE.Scene();
			this.quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
			this.quad = new THREE.Mesh(
				new THREE.PlaneGeometry(2, 2),
				new THREE.ShaderMaterial({
					uniforms: { tex: { value: null }, size: { value: new THREE.Vector2(1, 1) }, px: { value: 3 }, ink: { value: new THREE.Color(INK) } },
					transparent: true,
					depthTest: false,
					vertexShader: 'void main(){ gl_Position = vec4(position.xy, 0.0, 1.0); }',
					fragmentShader: QUAD_FRAG,
				}),
			);
			this.quadScene.add(this.quad);
			// numbers and pop-ups, drawn as crisp 2D on top
			this.labels = document.createElement('canvas');
			this.labels.className = `fud-labels${this.own ? '' : ' fixed'}`;
			if (this.own) this.canvas.after(this.labels);
			else document.body.append(this.labels);
			this.lctx = this.labels.getContext('2d');
		}
		const W = this.own ? this.canvas.clientWidth || this.canvas.width : window.innerWidth;
		const H = this.own ? this.canvas.clientHeight || this.canvas.height : window.innerHeight;
		const resized = W !== this.W || H !== this.H;
		this.W = W;
		this.H = H;
		const dpr = Math.min(1.5, window.devicePixelRatio || 1);
		// pixel dice come out about 26 art pixels across, the size sprite dice are drawn at
		const P = clamp(Math.round((2.1 * this.#diePx() * dpr) / 26), 2, 8);
		if (resized) {
			this.renderer.setPixelRatio(dpr);
			this.renderer.setSize(W, H, !this.own);
			this.camera.aspect = W / H;
			// looking down at the table at an angle
			this.camera.position.set(0, 42, 26);
			this.camera.lookAt(0, 0, 0);
			this.camera.updateProjectionMatrix();
			this.camera.updateMatrixWorld(true);
			this.bounds = this.#tableBounds();
			const { width, height } = this.renderer.domElement;
			this.labels.width = width;
			this.labels.height = height;
			if (this.own) Object.assign(this.labels.style, { width: `${W}px`, height: `${H}px` });
		}
		if (resized || P !== this.P) {
			this.P = P;
			const { width, height } = this.renderer.domElement;
			this.rt?.dispose();
			this.rt = new THREE.WebGLRenderTarget(Math.ceil(width / P), Math.ceil(height / P), { magFilter: THREE.NearestFilter, minFilter: THREE.NearestFilter });
			const u = this.quad.material.uniforms;
			u.tex.value = this.rt.texture;
			u.size.value.set(this.rt.width, this.rt.height);
			u.px.value = P;
		}
		this.canvas.style.display = '';
		this.labels.style.display = '';
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
		const scale = this.#diePx() * this.#unitsPerPixel();
		// d100: a tens die and a units die; its pop-up number sits over the tens die
		const dice = list.flatMap((d) => {
			if (d.faces !== 100) return [{ faces: d.faces, value: d.value, show: d.value }];
			if (d.value == null) return [{ faces: 100, value: null, tens: true, show: null }, { faces: 10, value: null }];
			const v = d.value % 100;
			return [{ faces: 100, value: Math.floor(v / 10) * 10, tens: true, show: d.value }, { faces: 10, value: v % 10 || 10, unitsOf100: true }];
		});
		const sim = this.#simulate(dice, scale, L);
		const total = list.some((d) => d.value == null) ? '?' : String(list.reduce((s, d) => s + d.value, 0));
		const group = { L, crit, fumble, dice: [], resolve: null, landedAt: null, total, hold: L.popup && L.popup !== 'none' ? 2.2 : 1.6 };
		const done = new Promise((res) => (group.resolve = res));
		sim.forEach((s, i) => group.dice.push(this.#makeDie(dice[i], s, L, scale)));
		group.frames = Math.max(...sim.map((s) => s.frames.length / 7));
		group.hits = sim.flatMap((s) => s.hits);
		group.t = 0;
		if (L.throw === 'summon' && !set.reduced) for (const d of group.dice) this.#ring(L, new THREE.Vector3(d.frames[0], 0, d.frames[2]), scale, L.glow, 0.5);
		this.throws.push(group);
		diceSound(L.sound, 'throw', set.volume);
		this.#start();
		return done;
	}

	/**
	 * Run the whole throw now and record it: positions, rotations, bounces, and which face ends up on top.
	 * How the dice start depends on the look's throw (toss, drop, slam, roll, summon) and side (from).
	 */
	#simulate(dice, scale, L) {
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
		const W = b.maxX - b.minX;
		const D = b.maxZ - b.minZ;
		const n = dice.length;
		// land around the middle of the screen, a little low (and, on the full screen, a little left of the chat)
		const cx = this.own ? 0 : -0.07 * W;
		const cz = 0.055 * D;
		const kind = THROW_KINDS.has(L.throw) ? L.throw : 'toss';
		const side = L.from === 'random' || !SIDES.includes(L.from) ? (L.from === 'random' ? SIDES[Math.floor(Math.random() * 4)] : 'right') : L.from;
		const cols = Math.ceil(Math.sqrt(n));
		const rows = Math.ceil(n / cols);
		const inX = (v) => clamp(v, b.minX + m * 2, b.maxX - m * 2);
		const inZ = (v) => clamp(v, b.minZ + m * 2, b.maxZ - m * 2);
		const bodies = dice.map((d, i) => {
			const shape = shapeData(d.faces);
			const body = new CANNON.Body({ mass: 1, material: mat, linearDamping: 0.12, angularDamping: 0.12, allowSleep: true, sleepSpeedLimit: 0.12 * scale, sleepTimeLimit: 0.25 });
			body.addShape(bodyShape({ ...shape, verts: shape.verts.map((v) => v.clone().multiplyScalar(scale)) }));
			let spin = 18;
			if (kind === 'drop' || kind === 'summon') {
				// straight down onto a loose grid, so the dice don't start inside each other
				const tx = inX(cx + ((i % cols) - (cols - 1) / 2) * scale * 2.6 + rand(-0.3, 0.3) * scale);
				const tz = inZ(cz + (Math.floor(i / cols) - (rows - 1) / 2) * scale * 2.6 + rand(-0.3, 0.3) * scale);
				body.position.set(tx, kind === 'drop' ? scale * rand(9, 13) : scale * rand(1.4, 1.8), tz);
				body.velocity.set(rand(-1, 1) * scale, kind === 'drop' ? -scale * rand(2, 4) : scale * rand(1, 2), rand(-1, 1) * scale);
				spin = kind === 'drop' ? 10 : 5;
			} else {
				const off = (i - (n - 1) / 2) * scale * 1.9;
				let sx;
				let sz;
				if (side === 'right' || side === 'left') {
					sx = side === 'right' ? b.maxX - m * 2 - rand(0, scale * 2) : b.minX + m * 2 + rand(0, scale * 2);
					sz = inZ(b.maxZ * 0.45 + off * 0.8 + rand(-scale, scale));
				} else {
					sx = inX(cx + off + rand(-0.5, 0.5) * scale);
					sz = side === 'bottom' ? b.maxZ - m * 2 - rand(0, scale) : b.minZ + m * 2 + rand(0, scale);
				}
				const tx = cx + rand(-0.11, 0.11) * W;
				const tz = cz + rand(-0.055, 0.055) * D;
				const dir = new CANNON.Vec3(tx - sx, 0, tz - sz);
				dir.normalize();
				const speed = scale * (kind === 'slam' ? rand(10, 13) : kind === 'roll' ? rand(12, 15) : rand(9, 12.5));
				body.position.set(sx, scale * (kind === 'slam' ? rand(6, 8) : kind === 'roll' ? 1.3 : rand(3, 5)), sz);
				body.velocity.set(dir.x * speed, kind === 'slam' ? -scale * rand(14, 18) : kind === 'roll' ? 0 : scale * rand(2, 5), dir.z * speed);
				if (kind === 'slam') spin = 25;
				if (kind === 'roll') {
					// spinning the way it travels, so it tumbles along the table
					const w = speed / scale;
					body.angularVelocity.set(dir.z * w + rand(-3, 3), rand(-3, 3), -dir.x * w + rand(-3, 3));
					spin = 0;
				}
			}
			if (spin) body.angularVelocity.set(rand(-spin, spin), rand(-spin, spin), rand(-spin, spin));
			body.quaternion.setFromEuler(rand(0, TAU), rand(0, TAU), rand(0, TAU));
			world.addBody(body);
			return { body, shape, frames: [], hits: [] };
		});
		let frame = 0;
		for (const s of bodies)
			s.body.addEventListener('collide', (e) => {
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
		for (const s of bodies) {
			const n7 = s.frames.length;
			s.top = topOf(s.shape, new THREE.Quaternion(s.frames[n7 - 4], s.frames[n7 - 3], s.frames[n7 - 2], s.frames[n7 - 1])).index;
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
		// per face (d4: per corner), what it reads
		const labels = values.map((v, i) => (want == null && i === top ? '?' : labelOf(v)));
		const mats = shape.faces.map((f, fi) => material(L, faceTexture(shape, fi, shape.key === 4 ? '' : labels[fi], L, shape.key === 4 ? f.idx.map((vi) => labels[vi]) : null)));
		const mesh = new THREE.Mesh(geometryOf(shape), mats);
		mesh.castShadow = true;
		mesh.layers.set(L.style === 'pixel' ? 2 : 1);
		this.scene.add(mesh);
		return { mesh, frames: sim.frames, L, scale, trailAt: 0, shape, labels, show: d.show, mul: 1, alpha: 1 };
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
		if (!this.own && this.canvas) {
			this.canvas.style.display = 'none';
			this.labels.style.display = 'none';
		}
	}

	#step(dt) {
		const set = this.settings();
		for (const g of this.throws) {
			const prev = Math.floor(g.t * FPS);
			g.t += dt;
			const f = Math.floor(g.t * FPS);
			for (const h of g.hits) if (h.frame > prev && h.frame <= f) diceSound(g.L.sound, 'bounce', set.volume * h.v);
			const L = g.L;
			const k = g.landedAt == null ? -1 : g.t - g.landedAt;
			const exitLen = L.exit === 'burst' ? 0.18 : 0.45;
			const e = k < 0 ? 0 : clamp((k - g.hold) / exitLen, 0, 1);
			for (const d of g.dice) {
				const n = d.frames.length / 7;
				const i = Math.min(n - 1, f) * 7;
				const fr = d.frames;
				let mul = 1;
				let lift = 0;
				let alpha = 1;
				if (L.throw === 'summon') mul *= easeOutBack(clamp(g.t / 0.35, 0, 1));
				if (k >= 0) {
					if (L.settle === 'pop' && k < 0.3) mul *= 1 + 0.2 * Math.sin((Math.PI * k) / 0.3);
					if (L.settle === 'hop' && k < 0.4) lift += d.scale * 0.8 * Math.sin((Math.PI * k) / 0.4);
					if (e > 0) {
						if (L.exit === 'shrink' || L.exit === 'burst') mul *= 1 - e * e;
						else if (L.exit === 'sink') (lift -= d.scale * 2.2 * e), (alpha = 1 - e * e);
						else if (L.exit === 'float') (lift += d.scale * 3 * easeOut(e)), (alpha = 1 - e);
						else alpha = 1 - e;
						if (L.exit === 'burst' && !d.burst && !set.reduced) {
							d.burst = true;
							for (let s = 0; s < 14; s++) this.#spark(L, L.trail === 'none' ? 'sparkle' : L.trail, d.mesh.position, d.scale, true);
						}
					}
				}
				d.mesh.position.set(fr[i], fr[i + 1] + lift, fr[i + 2]);
				d.mesh.quaternion.set(fr[i + 3], fr[i + 4], fr[i + 5], fr[i + 6]);
				d.mesh.scale.setScalar(d.scale * Math.max(0.001, mul));
				d.mul = mul;
				d.alpha = alpha;
				d.mesh.castShadow = alpha > 0.5 && mul > 0.5;
				const glow = L.settle === 'glow' && k >= 0 && k < 1.4 ? 0.65 * Math.sin(Math.PI * Math.min(1, k / 1.4)) : 0;
				for (const mt of d.mesh.material) {
					mt.emissiveIntensity = mt.userData.glow + glow;
					mt.opacity = alpha * mt.userData.opacity;
				}
				// trail while it flies
				if (!set.reduced && L.trail !== 'none' && f < n - 10) {
					d.trailAt -= dt;
					const j = Math.max(0, i - 7);
					const speed = Math.hypot(fr[i] - fr[j], fr[i + 1] - fr[j + 1], fr[i + 2] - fr[j + 2]) * FPS;
					if (d.trailAt <= 0 && speed > d.scale * 3) {
						d.trailAt = 0.03;
						this.#spark(L, L.trail, d.mesh.position, d.scale, false);
					}
				}
			}
			if (g.landedAt == null && f >= g.frames - 1) this.#landed(g, set);
			if (e >= 1) g.gone = true;
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

	#ring(L, at, scale, color = L.glow, life = 0.6) {
		const geo = new THREE.RingGeometry(0.85, 1, 48);
		const m = new THREE.MeshBasicMaterial({ color: new THREE.Color(color), transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending });
		const ring = new THREE.Mesh(geo, m);
		ring.rotation.x = -Math.PI / 2;
		ring.position.set(at.x, 0.02, at.z);
		ring.layers.set(L.style === 'pixel' ? 2 : 1);
		this.scene.add(ring);
		this.fx.push({ obj: ring, ring: true, age: 0, life, size: scale * 1.4 });
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
		c.y += g.dice[0].scale * (g.L.popup === 'total' ? 3.6 : 2.4);
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
		const shadowLayers = this.sun.shadow.camera.layers;
		r.autoClear = true;
		const anyPixel = this.throws.some((g) => g.L.style === 'pixel');
		if (anyPixel) {
			// the pixel pass casts only the pixel dice's shadows, and draws them hard-edged
			shadowLayers.set(2);
			this.camera.layers.set(2);
			r.setRenderTarget(this.rt);
			r.setClearColor(0x000000, 0);
			r.clear();
			r.render(this.scene, this.camera);
		}
		shadowLayers.set(1);
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
		this.#drawLabels();
	}

	/** Device-pixel position of a world point */
	#toScreen(v) {
		const p = v.clone().project(this.camera);
		return [((p.x + 1) / 2) * this.labels.width, ((1 - p.y) / 2) * this.labels.height];
	}

	/**
	 * Pixel dice: the number on top, upright, in the 5x7 font, lined up with the dice's pixel grid.
	 * Any dice: the pop-up numbers once they land.
	 */
	#drawLabels() {
		const c = this.lctx;
		const cw = this.labels.width;
		const ch = this.labels.height;
		c.clearRect(0, 0, cw, ch);
		const P = this.P;
		const oy = ch % P;
		const dpr = this.renderer.getPixelRatio();
		for (const g of this.throws) {
			const L = g.L;
			const pixel = L.style === 'pixel';
			const rise = g.landedAt == null ? -1 : easeOut(clamp((g.t - g.landedAt) / 0.5, 0, 1));
			for (const d of g.dice) {
				if (d.alpha <= 0.02 || d.mul < 0.5) continue;
				c.globalAlpha = d.alpha;
				if (pixel) {
					const top = topOf(d.shape, d.mesh.quaternion);
					if (d.shape.key === 4 || top.dot > 0.55) {
						const local = d.shape.key === 4 ? d.shape.verts[top.index] : d.shape.faces[top.index].center;
						const [x, y] = this.#toScreen(d.mesh.localToWorld(local.clone()));
						drawPixelTextAt(c, d.labels[top.index], x, y + (d.shape.key === 4 ? P * 5 : 0), P, L.number, inkFor(L.number), 0, oy);
					}
				}
				if (rise >= 0 && L.popup === 'each' && d.show != null) {
					const [x, y] = this.#toScreen(d.mesh.position.clone().add(new THREE.Vector3(0, d.scale * 1.4, 0)));
					this.#popup(c, String(d.show), x, y - rise * 18 * dpr, L, P, oy, 1, rise);
				}
			}
			if (rise >= 0 && L.popup === 'total' && g.dice.length) {
				const at = g.dice.reduce((s, d) => s.add(d.mesh.position), new THREE.Vector3()).multiplyScalar(1 / g.dice.length);
				at.y += g.dice[0].scale * 1.6;
				const [x, y] = this.#toScreen(at);
				c.globalAlpha = Math.min(...g.dice.map((d) => d.alpha));
				this.#popup(c, g.total, x, y - rise * 26 * dpr, L, P, oy, 2, rise);
			}
		}
		c.globalAlpha = 1;
	}

	#popup(c, text, x, y, L, P, oy, big, rise) {
		if (L.style === 'pixel') return drawPixelTextAt(c, text, x, y, P * big, L.number, inkFor(L.number), 0, oy);
		const size = Math.round((big > 1 ? 0.95 : 0.6) * this.#diePx() * this.renderer.getPixelRatio() * (0.8 + 0.2 * easeOutBack(rise)));
		c.font = `700 ${size}px "FUD Antonio", "Antonio", "Arial Narrow", sans-serif`;
		c.textAlign = 'center';
		c.textBaseline = 'middle';
		c.lineJoin = 'round';
		c.lineWidth = Math.max(3, size * 0.16);
		c.strokeStyle = inkFor(L.number) === INK ? 'rgba(5,8,18,0.9)' : 'rgba(244,241,234,0.95)';
		c.shadowColor = L.glow;
		c.shadowBlur = size * 0.4;
		c.strokeText(text, x, y);
		c.shadowBlur = 0;
		c.fillStyle = L.number;
		c.fillText(text, x, y);
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

const THROW_KINDS = new Set(['toss', 'drop', 'slam', 'roll', 'summon']);
const SIDES = ['right', 'left', 'bottom', 'top'];

/** Which face (d4: which corner) points most nearly up, and how nearly */
function topOf(shape, q) {
	let index = 0;
	let dot = -2;
	if (shape.key === 4) {
		shape.verts.forEach((v, i) => {
			const y = v.clone().applyQuaternion(q).y;
			if (y > dot) (dot = y), (index = i);
		});
		return { index, dot: 1 };
	}
	shape.faces.forEach((f, i) => {
		const dd = f.normal.clone().applyQuaternion(q).dot(UP);
		if (dd > dot) (dot = dd), (index = i);
	});
	return { index, dot };
}
