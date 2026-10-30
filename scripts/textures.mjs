/**
 * Dice surfaces, generated in code from two colors (the body and an accent) and a strength.
 * Smooth dice get a detailed texture; pixel dice a small one in three flat tones, with no dithering noise,
 * so faces stay clean at sprite size.
 */

export const TEXTURES = {
	plain: 'Plain',
	marble: 'Marble',
	wood: 'Wood',
	stone: 'Stone',
	brushed: 'Brushed',
	crystal: 'Crystal',
	nebula: 'Nebula',
	starfield: 'Starfield',
	runes: 'Runes',
	scales: 'Scales',
	magma: 'Magma',
	circuit: 'Circuit',
	stripes: 'Stripes',
};

/* ------------------------------------------------------------------ */
/*  Noise                                                              */
/* ------------------------------------------------------------------ */

function rng(seed) {
	let s = seed >>> 0 || 1;
	return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

function hash(x, y, seed) {
	// 32-bit integer maths (Math.imul): plain multiplication loses the low bits on numbers this big
	let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(seed | 0, -2048144777)) | 0;
	h = Math.imul(h ^ (h >>> 13), 1274126177);
	return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

const smooth = (t) => t * t * (3 - 2 * t);

function vnoise(x, y, seed) {
	const xi = Math.floor(x);
	const yi = Math.floor(y);
	const xf = smooth(x - xi);
	const yf = smooth(y - yi);
	const a = hash(xi, yi, seed);
	const b = hash(xi + 1, yi, seed);
	const c = hash(xi, yi + 1, seed);
	const d = hash(xi + 1, yi + 1, seed);
	return a + (b - a) * xf + (c - a) * yf + (a - b - c + d) * xf * yf;
}

function fbm(x, y, seed, oct = 4) {
	let v = 0;
	let amp = 0.5;
	let f = 1;
	for (let i = 0; i < oct; i++) {
		v += vnoise(x * f, y * f, seed + i * 17) * amp;
		f *= 2;
		amp *= 0.5;
	}
	return v / (1 - Math.pow(0.5, oct));
}

/** Distance to the nearest and second nearest of some scattered points (cells, cracks, facets) */
function cells(x, y, n, seed) {
	const xi = Math.floor(x * n);
	const yi = Math.floor(y * n);
	let d1 = 9;
	let d2 = 9;
	let id = 0;
	for (let j = -1; j <= 1; j++)
		for (let i = -1; i <= 1; i++) {
			const cx = (xi + i + hash(xi + i, yi + j, seed)) / n;
			const cy = (yi + j + hash(xi + i, yi + j, seed + 7)) / n;
			const d = Math.hypot(x - cx, y - cy) * n;
			if (d < d1) {
				d2 = d1;
				d1 = d;
				id = hash(xi + i, yi + j, seed + 3);
			} else if (d < d2) d2 = d;
		}
	return { d1, d2, id };
}

/* ------------------------------------------------------------------ */
/*  Colors                                                             */
/* ------------------------------------------------------------------ */

const rgb = (hex) => {
	const n = parseInt(String(hex).replace('#', '').padEnd(6, '0').slice(0, 6), 16);
	return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const lerp = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
const shade = (c, k) => (k < 0 ? lerp(c, [0, 0, 0], -k) : lerp(c, [255, 255, 255], k));

/* ------------------------------------------------------------------ */
/*  Patterns: each returns, per pixel, how much accent (0..1) and a light/dark shift (-1..1)  */
/* ------------------------------------------------------------------ */

const PATTERNS = {
	plain: () => [0, 0],
	marble: (x, y, s, w) => {
		const v = Math.abs(Math.sin((x * 3 + y * 2) * 3.2 + fbm(x * 3, y * 3, s) * 7));
		return [Math.pow(1 - v, 6 / w), (fbm(x * 5, y * 5, s + 9) - 0.5) * 0.35];
	},
	wood: (x, y, s, w) => {
		const r = Math.hypot(x - 0.15, (y - 1.3) * 0.35) * 9 + fbm(x * 4, y * 4, s) * 2.2;
		const ring = r - Math.floor(r);
		return [ring > 1 - 0.28 * w ? 0.85 : 0, (fbm(x * 30, y * 3, s + 5) - 0.5) * 0.3];
	},
	stone: (x, y, s) => {
		const n = fbm(x * 5, y * 5, s);
		const speck = hash(Math.floor(x * 40), Math.floor(y * 40), s) > 0.95 ? 1 : 0;
		return [speck * 0.9, (n - 0.5) * 1.3];
	},
	brushed: (x, y, s) => [0, (fbm(x * 2, y * 40, s) - 0.5) * 0.9 + (y < 0.35 ? 0.15 : 0)],
	crystal: (x, y, s, w) => {
		const c = cells(x, y, 4, s);
		const edge = c.d2 - c.d1 < 0.08 * w ? 1 : 0;
		return [edge * 0.9, (c.id - 0.5) * 0.6];
	},
	nebula: (x, y, s) => {
		const n = fbm(x * 3, y * 3, s);
		const star = hash(Math.floor(x * 48), Math.floor(y * 48), s + 4) > 0.975 ? 1 : 0;
		return [Math.min(1, Math.max(0, (n - 0.5) * 3.2) + star), (fbm(x * 4, y * 4, s + 2) - 0.5) * 0.8];
	},
	starfield: (x, y, s) => {
		const h = hash(Math.floor(x * 40), Math.floor(y * 40), s);
		return [h > 0.965 ? 1 : h > 0.93 ? 0.5 : 0, -0.2];
	},
	runes: (x, y, s, w) => {
		// a grid of little engraved marks
		const gx = x * 4;
		const gy = y * 4;
		const cx = gx - Math.floor(gx);
		const cy = gy - Math.floor(gy);
		const k = Math.floor(hash(Math.floor(gx), Math.floor(gy), s) * 6);
		const line = (a) => (a < 0.08 * w ? 1 : 0);
		const marks = [line(Math.abs(cx - 0.5)) * (cy > 0.2 && cy < 0.8), line(Math.abs(cy - 0.5)) * (cx > 0.2 && cx < 0.8), line(Math.abs(cx - cy)) * (cx > 0.2 && cx < 0.8), line(Math.abs(cx + cy - 1)) * (cx > 0.2 && cx < 0.8), line(Math.abs(Math.hypot(cx - 0.5, cy - 0.5) - 0.28)), 0];
		const v = marks[k] || (k === 5 ? marks[0] + marks[1] : 0);
		return [Math.min(1, v) * 0.9, (fbm(x * 5, y * 5, s) - 0.5) * 0.2];
	},
	scales: (x, y, s, w) => {
		const row = Math.floor(y * 7);
		const sx = x * 7 + (row % 2) * 0.5;
		const fx = sx - Math.floor(sx) - 0.5;
		const fy = y * 7 - row;
		const d = Math.hypot(fx, fy * 1.1);
		return [d > 0.52 - 0.1 * w && d < 0.52 ? 0.9 : 0, -fy * 0.45 + 0.15];
	},
	magma: (x, y, s, w) => {
		const c = cells(x, y, 3.2, s);
		const crack = Math.max(0, 1 - ((c.d2 - c.d1) * 7) / w);
		return [Math.pow(crack, 1.5), (fbm(x * 6, y * 6, s) - 0.5) * 0.35 - 0.1];
	},
	circuit: (x, y, s, w) => {
		const g = 10;
		const cx = Math.floor(x * g);
		const cy = Math.floor(y * g);
		const fx = x * g - cx;
		const fy = y * g - cy;
		const h = hash(cx, cy, s);
		const hor = h < 0.45 && Math.abs(fy - 0.5) < 0.12 * w;
		const ver = h > 0.55 && Math.abs(fx - 0.5) < 0.12 * w;
		const node = h > 0.86 && Math.hypot(fx - 0.5, fy - 0.5) < 0.24;
		return [hor || ver || node ? 1 : 0, 0];
	},
	stripes: (x, y) => [Math.sin((x + y) * 18) > 0.35 ? 0.8 : 0, 0],
};

const CACHE = new Map();

/**
 * A square of surface.
 * @param {{texture:string, body:string, accent:string, strength:number}} L
 * @param {{size?:number, pixel?:boolean, seed?:number, zoom?:number}} [o] zoom below 1 shows less of the pattern, bigger
 * @returns {HTMLCanvasElement}
 */
export function surface(L, { size = 192, pixel = false, seed = 1, zoom = 1 } = {}) {
	const kind = PATTERNS[L.texture] ? L.texture : 'plain';
	const strength = Math.max(0, Math.min(1, Number(L.strength ?? 0.6)));
	const key = `${kind}|${L.body}|${L.accent}|${strength}|${size}|${pixel}|${seed}|${zoom}`;
	if (CACHE.has(key)) return CACHE.get(key);
	const cv = document.createElement('canvas');
	cv.width = cv.height = size;
	const c = cv.getContext('2d');
	const img = c.createImageData(size, size);
	const body = rgb(L.body);
	const accent = rgb(L.accent ?? L.edge ?? '#ffffff');
	const fn = PATTERNS[kind];
	// pixel dice: three tones of the body and one of the accent, nothing in between
	const tones = [shade(body, -0.32), body, shade(body, 0.22)];
	for (let y = 0; y < size; y++)
		for (let x = 0; x < size; x++) {
			const [a, l] = fn((x / size) * zoom, (y / size) * zoom, seed, pixel ? 2.2 : 1);
			let col;
			if (pixel) {
				if (a * strength > 0.35) col = accent;
				else col = tones[l * strength < -0.08 ? 0 : l * strength > 0.08 ? 2 : 1];
			} else {
				col = lerp(shade(body, l * strength), accent, Math.min(1, a * strength));
			}
			const i = (y * size + x) * 4;
			img.data[i] = col[0];
			img.data[i + 1] = col[1];
			img.data[i + 2] = col[2];
			img.data[i + 3] = 255;
		}
	c.putImageData(img, 0, 0);
	if (CACHE.size > 120) CACHE.clear();
	CACHE.set(key, cv);
	return cv;
}

/** A seed per face so faces don't all look the same */
export const faceSeed = (fi) => 1 + fi * 7919;
export { rng };
