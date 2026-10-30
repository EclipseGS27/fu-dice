import { appearanceOf } from './presets.mjs';
import { diceSound } from './sound.mjs';

/**
 * The dice tray: one canvas over the screen (or a given canvas, for the settings preview). Dice are thrown in from
 * an edge, fly in an arc, bounce, knock into each other, tumble through faces, and settle upright on their
 * result. Pixel dice are drawn at low resolution with hard edges and a bitmap font; smooth dice anti-aliased with
 * gradients and glow. It only animates while dice are moving.
 */

const TAU = Math.PI * 2;
const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const PIX = 4; // screen pixels per art pixel for pixel dice

/* ------------------------------------------------------------------ */
/*  Colors                                                             */
/* ------------------------------------------------------------------ */

function rgb(hex) {
	const n = parseInt(String(hex).replace('#', '').padEnd(6, '0').slice(0, 6), 16);
	return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function mix(a, b, k) {
	const A = rgb(a);
	const B = rgb(b);
	return `rgb(${A.map((v, i) => Math.round(v + (B[i] - v) * k)).join(',')})`;
}
const rgba = (hex, a) => `rgba(${rgb(hex).join(',')},${a})`;

/* ------------------------------------------------------------------ */
/*  Shapes: unit outlines (radius 1) and the facet lines inside them   */
/* ------------------------------------------------------------------ */

const poly = (n, start) => Array.from({ length: n }, (_, i) => [Math.cos(start + (i * TAU) / n), Math.sin(start + (i * TAU) / n)]);

const SHAPES = {
	2: { outline: null, facets: [], text: 0.62 },
	4: { outline: poly(3, -Math.PI / 2).map(([x, y]) => [x * 1.05, y * 1.05 + 0.12]), facets: [[[0, 0.18], [0, -0.93]], [[0, 0.18], [-0.91, 0.65]], [[0, 0.18], [0.91, 0.65]]], text: 0.5, ty: 0.22 },
	6: { outline: poly(4, Math.PI / 4).map(([x, y]) => [x * 1.08, y * 1.08]), facets: [], inset: 0.72, text: 0.7 },
	8: { outline: [[0, -1.05], [0.86, 0], [0, 1.05], [-0.86, 0]], facets: [[[-0.86, 0], [0.86, 0]]], text: 0.56 },
	10: { outline: [[0, -1.05], [0.95, -0.12], [0.62, 0.62], [0, 0.95], [-0.62, 0.62], [-0.95, -0.12]], facets: [[[0, -1.05], [-0.42, 0.38]], [[0, -1.05], [0.42, 0.38]], [[-0.42, 0.38], [0.42, 0.38]], [[-0.42, 0.38], [0, 0.95]], [[0.42, 0.38], [0, 0.95]]], text: 0.5, ty: 0.02 },
	12: { outline: poly(5, -Math.PI / 2).map(([x, y]) => [x * 1.05, y * 1.05]), facets: 'inner5', text: 0.52 },
	20: { outline: poly(6, -Math.PI / 2).map(([x, y]) => [x * 1.05, y * 1.05]), facets: 'tri', text: 0.5, ty: 0.08 },
};
const shapeOf = (faces) => SHAPES[faces] ?? (faces === 100 ? SHAPES[10] : faces > 12 ? SHAPES[20] : faces > 8 ? SHAPES[12] : SHAPES[6]);

function facetLines(shape) {
	if (Array.isArray(shape.facets)) return shape.facets;
	const o = shape.outline;
	if (shape.facets === 'inner5') {
		const inner = o.map(([x, y]) => [x * 0.55, y * 0.55]);
		return [...inner.map((p, i) => [p, inner[(i + 1) % 5]]), ...inner.map((p, i) => [p, o[i]])];
	}
	// d20: a triangle face in the middle, its corners to the outline
	const tri = [[0, -0.62], [0.56, 0.36], [-0.56, 0.36]];
	return [[tri[0], tri[1]], [tri[1], tri[2]], [tri[2], tri[0]], [tri[0], o[0]], [tri[1], o[2]], [tri[1], o[3]], [tri[2], o[3]], [tri[2], o[4]], [tri[0], o[5]], [tri[0], o[1]], [tri[1], o[1]], [tri[2], o[5]]];
}

/* ------------------------------------------------------------------ */
/*  A 3x5 bitmap font for pixel dice                                   */
/* ------------------------------------------------------------------ */

export const GLYPH = {
	0: '111101101101111', 1: '010110010010111', 2: '111001111100111', 3: '111001111001111', 4: '101101111001001',
	5: '111100111001111', 6: '111100111101111', 7: '111001010010010', 8: '111101111101111', 9: '111101111001111', '?': '111001011000010',
};

function pixelText(ctx, text, cx, cy, scale, color, outline) {
	const s = String(text);
	const w = s.length * 4 - 1;
	const x0 = Math.round(cx - (w * scale) / 2);
	const y0 = Math.round(cy - (5 * scale) / 2);
	const paint = (dx, dy, c) => {
		ctx.fillStyle = c;
		[...s].forEach((ch, i) => {
			const g = GLYPH[ch] ?? GLYPH['?'];
			for (let k = 0; k < 15; k++) if (g[k] === '1') ctx.fillRect(x0 + (i * 4 + (k % 3)) * scale + dx, y0 + Math.floor(k / 3) * scale + dy, scale, scale);
		});
	};
	if (outline) for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) paint(dx * scale, dy * scale, outline);
	paint(0, 0, color);
}

/* ------------------------------------------------------------------ */
/*  Particles                                                          */
/* ------------------------------------------------------------------ */

function star(ctx, x, y, r, points = 4, inner = 0.38) {
	ctx.beginPath();
	for (let i = 0; i < points * 2; i++) {
		const a = -Math.PI / 2 + (i * Math.PI) / points;
		const rr = i % 2 ? r * inner : r;
		ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
	}
	ctx.closePath();
	ctx.fill();
}

const FIRE = ['#fff3a6', '#ffc23d', '#ff8a2a', '#f2561d', '#c9281f', '#4a1712'];

/** One particle of a kind, near (x, y), drifting with (vx, vy) */
function spawn(kind, x, y, look, vx = 0, vy = 0) {
	const p = { kind, x, y, vx: vx + rand(-30, 30), vy: vy + rand(-30, 30), age: 0, life: rand(0.4, 0.8), size: rand(3, 7), rot: rand(0, TAU), vr: rand(-6, 6), look };
	if (kind === 'fire') Object.assign(p, { vy: vy - rand(40, 90), life: rand(0.35, 0.6), size: rand(6, 11) });
	if (kind === 'embers') Object.assign(p, { vy: vy - rand(60, 140), vx: vx + rand(-60, 60), life: rand(0.4, 0.9), size: rand(2, 3.5) });
	if (kind === 'motes') Object.assign(p, { vy: -rand(20, 50), vx: rand(-15, 15), life: rand(0.9, 1.5), size: rand(2.5, 4.5) });
	if (kind === 'feathers') Object.assign(p, { vy: rand(10, 30), life: rand(0.9, 1.4), size: rand(6, 9) });
	if (kind === 'ice' || kind === 'shards') Object.assign(p, { vy: vy * 0.3 + rand(10, 40), life: rand(0.5, 0.9) });
	if (kind === 'dust') Object.assign(p, { vx: rand(-60, 60), vy: rand(-25, -5), life: rand(0.3, 0.5), size: rand(4, 8) });
	return p;
}

function drawParticle(ctx, p, k) {
	const t = p.age / p.life;
	const a = 1 - t;
	const L = p.look;
	switch (p.kind) {
		case 'sparkle':
			ctx.fillStyle = Math.sin(p.age * 30) > 0 ? '#ffffff' : L.glow;
			ctx.globalAlpha = a;
			star(ctx, p.x * k, p.y * k, p.size * k * (1 - t * 0.5));
			break;
		case 'stars':
			ctx.fillStyle = t < 0.3 ? '#ffffff' : '#ffe27a';
			ctx.globalAlpha = a;
			star(ctx, p.x * k, p.y * k, p.size * k * 1.1, 5, 0.45);
			break;
		case 'fire': {
			ctx.fillStyle = FIRE[Math.min(FIRE.length - 1, Math.floor(t * FIRE.length))];
			ctx.globalAlpha = a * 0.9;
			ctx.beginPath();
			ctx.arc(p.x * k, p.y * k, Math.max(0.5, p.size * (1 - t * 0.7)) * k, 0, TAU);
			ctx.fill();
			break;
		}
		case 'embers':
			ctx.fillStyle = Math.sin(p.age * 40) > -0.3 ? '#ffc23d' : '#ff6a1a';
			ctx.globalAlpha = a;
			ctx.fillRect(p.x * k, p.y * k, p.size * k, p.size * k);
			break;
		case 'motes':
			ctx.fillStyle = L.glow;
			ctx.globalAlpha = Math.sin(Math.PI * t) * 0.9;
			ctx.beginPath();
			ctx.arc(p.x * k, p.y * k, p.size * k, 0, TAU);
			ctx.fill();
			break;
		case 'feathers':
			ctx.save();
			ctx.translate(p.x * k, p.y * k);
			ctx.rotate(Math.sin(p.age * 5) * 0.8);
			ctx.fillStyle = '#ffffff';
			ctx.globalAlpha = a * 0.9;
			ctx.beginPath();
			ctx.ellipse(0, 0, p.size * k, p.size * 0.35 * k, 0, 0, TAU);
			ctx.fill();
			ctx.restore();
			break;
		case 'ice':
		case 'shards':
			ctx.save();
			ctx.translate(p.x * k, p.y * k);
			ctx.rotate(p.rot);
			ctx.fillStyle = p.kind === 'ice' ? (t < 0.4 ? '#ffffff' : '#bff2ff') : L.glow;
			ctx.globalAlpha = a;
			ctx.beginPath();
			ctx.moveTo(0, -p.size * k);
			ctx.lineTo(p.size * 0.45 * k, 0);
			ctx.lineTo(0, p.size * k);
			ctx.lineTo(-p.size * 0.45 * k, 0);
			ctx.closePath();
			ctx.fill();
			ctx.restore();
			break;
		case 'dust':
			ctx.fillStyle = 'rgba(200,205,220,1)';
			ctx.globalAlpha = a * 0.35;
			ctx.beginPath();
			ctx.arc(p.x * k, p.y * k, p.size * (0.6 + t) * k, 0, TAU);
			ctx.fill();
			break;
	}
	ctx.globalAlpha = 1;
}

/* ------------------------------------------------------------------ */
/*  The stage                                                          */
/* ------------------------------------------------------------------ */

export class DiceStage {
	/**
	 * @param {{canvas?: HTMLCanvasElement, settings?: () => object}} [opts] a canvas of its own (preview), else a
	 *   full-screen overlay; settings() returns { size, speed, reduced, volume }
	 */
	constructor({ canvas = null, settings = () => ({}) } = {}) {
		this.own = !!canvas;
		this.canvas = canvas;
		this.settings = settings;
		this.dice = [];
		this.parts = [];
		this.rings = [];
		this.banners = [];
		this.raf = null;
		this.last = 0;
	}

	#ensure() {
		if (!this.canvas) {
			this.canvas = document.createElement('canvas');
			this.canvas.className = 'fud-overlay';
			document.body.append(this.canvas);
		}
		const W = this.own ? this.canvas.clientWidth || this.canvas.width : window.innerWidth;
		const H = this.own ? this.canvas.clientHeight || this.canvas.height : window.innerHeight;
		const dpr = Math.min(2, window.devicePixelRatio || 1);
		if (this.W !== W || this.H !== H || this.dpr !== dpr) {
			this.W = W;
			this.H = H;
			this.dpr = dpr;
			this.canvas.width = Math.round(W * dpr);
			this.canvas.height = Math.round(H * dpr);
			this.lo = this.lo ?? document.createElement('canvas');
			this.lo.width = Math.ceil(W / PIX);
			this.lo.height = Math.ceil(H / PIX);
		}
		this.canvas.style.display = '';
	}

	/**
	 * Throw some dice.
	 * @param {{faces:number, value:?number}[]} list value null shows "?" (a roll you may not see)
	 * @param {{appearance?: object, crit?: boolean, fumble?: boolean}} [opts]
	 * @returns {Promise<void>} resolves when every die has landed
	 */
	roll(list, { appearance, crit = false, fumble = false } = {}) {
		this.#ensure();
		const look = appearanceOf(appearance);
		const set = this.settings();
		const size = clamp(Number(set.size) || 1, 0.5, 2);
		const r = (this.own ? Math.min(this.W, this.H) * 0.11 : 34) * size;
		const n = list.length;
		// thrown in from the lower right (where the chat is), landing around the middle of the lower half
		const cx = this.W * (this.own ? 0.5 : 0.47);
		const cy = this.H * (this.own ? 0.56 : 0.6);
		let resolve;
		const done = new Promise((res) => (resolve = res));
		const group = { pending: n, resolve, look, crit, fumble, dice: [] };
		list.forEach((d, i) => {
			const tx = cx + (i - (n - 1) / 2) * r * 2.4 + rand(-r * 0.6, r * 0.6);
			const ty = cy + rand(-r * 0.8, r * 0.8);
			const sx = this.W + r * 2 + rand(0, r * 2) - (this.own ? this.W * 0.15 : 0);
			const sy = this.H * (this.own ? 0.85 : 0.9) - i * r * 0.9 + rand(-r * 0.4, r * 0.4);
			const T = rand(0.55, 0.75);
			const die = {
				faces: d.faces,
				value: d.value,
				shape: shapeOf(d.faces),
				x: sx,
				y: sy,
				z: r * 0.6,
				vx: (tx - sx) / T,
				vy: (ty - sy) / T,
				vz: rand(380, 560),
				rot: rand(0, TAU),
				vr: rand(10, 18) * (Math.random() < 0.5 ? -1 : 1),
				tumble: 0,
				face: this.#randomFace(d.faces),
				faceAt: 0,
				r,
				look,
				group,
				settled: false,
				age: 0,
				settleT: 0,
				delay: i * 0.06,
			};
			group.dice.push(die);
			this.dice.push(die);
		});
		diceSound(look.sound, 'throw', set.volume);
		this.#start();
		return done;
	}

	#randomFace(faces) {
		return 1 + Math.floor(Math.random() * Math.max(2, faces));
	}

	#start() {
		if (this.raf) return;
		this.last = performance.now();
		const loop = (t) => {
			const dt = Math.min(0.05, (t - this.last) / 1000);
			this.last = t;
			const busy = this.#step(dt * clamp(Number(this.settings().speed) || 1, 0.5, 2));
			this.#draw();
			if (busy) this.raf = requestAnimationFrame(loop);
			else this.#stop();
		};
		this.raf = requestAnimationFrame(loop);
	}

	#stop() {
		this.raf = null;
		if (!this.own && this.canvas) this.canvas.style.display = 'none';
	}

	/** Advance everything; false when nothing is left to show */
	#step(dt) {
		const set = this.settings();
		const G = 1900;
		const floorTop = this.H * (this.own ? 0.15 : 0.3);
		for (const d of this.dice) {
			if (d.delay > 0) {
				d.delay -= dt;
				continue;
			}
			if (d.settled) {
				d.settleT += dt;
				d.rot += (Math.round(d.rot / TAU) * TAU - d.rot) * Math.min(1, dt * 14);
				continue;
			}
			d.age += dt;
			d.vz -= G * dt;
			d.z += d.vz * dt;
			if (d.z <= 0) {
				d.z = 0;
				if (Math.abs(d.vz) > 140) {
					diceSound(d.look.sound, 'bounce', set.volume * Math.min(1, Math.abs(d.vz) / 600));
					if (!set.reduced) for (let i = 0; i < 4; i++) this.parts.push(spawn('dust', d.x, d.y + d.r * 0.6, d.look));
				}
				d.vz = -d.vz * 0.42;
				if (Math.abs(d.vz) < 90) d.vz = 0;
			}
			const grounded = d.z === 0 && d.vz === 0;
			const drag = grounded ? 4.6 : 0.25;
			d.vx *= Math.max(0, 1 - drag * dt);
			d.vy *= Math.max(0, 1 - drag * dt);
			d.x += d.vx * dt;
			d.y += d.vy * dt;
			// walls
			const m = d.r * 1.1;
			if (d.x < m) (d.x = m), (d.vx = Math.abs(d.vx) * 0.6);
			if (d.x > this.W - m) (d.x = this.W - m), (d.vx = -Math.abs(d.vx) * 0.6);
			if (d.y < floorTop) (d.y = floorTop), (d.vy = Math.abs(d.vy) * 0.6);
			if (d.y > this.H - m) (d.y = this.H - m), (d.vy = -Math.abs(d.vy) * 0.6);
			const speed = Math.hypot(d.vx, d.vy);
			d.rot += d.vr * dt;
			d.vr *= Math.max(0, 1 - (grounded ? 4 : 0.6) * dt);
			d.tumble += (speed / (d.r * 2.2)) * dt * TAU * 0.5 + Math.abs(d.vz) * dt * 0.01;
			// the face flickers while it tumbles
			d.faceAt -= dt;
			if (d.faceAt <= 0) {
				d.face = this.#randomFace(d.faces);
				d.faceAt = 0.07;
			}
			// trail
			if (!set.reduced && d.look.trail !== 'none' && speed + Math.abs(d.vz) > 120 && Math.random() < dt * 40) this.parts.push(spawn(d.look.trail, d.x + rand(-d.r * 0.4, d.r * 0.4), d.y - d.z + rand(-d.r * 0.4, d.r * 0.4), d.look, -d.vx * 0.1, -d.vy * 0.1));
			if (grounded && speed < 30 && Math.abs(d.vr) < 2.5) this.#settle(d, set);
		}
		// dice knock into each other
		for (let i = 0; i < this.dice.length; i++) {
			for (let j = i + 1; j < this.dice.length; j++) {
				const a = this.dice[i];
				const b = this.dice[j];
				// fresh throws start bunched at the edge: let them spread out before they can bump
				if (a.delay > 0 || b.delay > 0 || a.age < 0.3 || b.age < 0.3) continue;
				const dx = b.x - a.x;
				const dy = b.y - a.y;
				const dist = Math.hypot(dx, dy) || 1;
				const min = (a.r + b.r) * 0.95;
				if (dist < min && Math.abs(a.z - b.z) < a.r) {
					const push = (min - dist) / 2;
					const nx = dx / dist;
					const ny = dy / dist;
					if (!a.settled) (a.x -= nx * push), (a.y -= ny * push);
					if (!b.settled) (b.x += nx * push), (b.y += ny * push);
					const rel = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
					if (rel < 0) {
						if (!a.settled) (a.vx += rel * nx * 0.8), (a.vy += rel * ny * 0.8);
						if (!b.settled) (b.vx -= rel * nx * 0.8), (b.vy -= rel * ny * 0.8);
						if (-rel > 120) diceSound(a.look.sound, 'bounce', set.volume * 0.6);
					}
				}
			}
		}
		for (const p of this.parts) {
			p.age += dt;
			p.x += p.vx * dt;
			p.y += p.vy * dt;
			p.rot += p.vr * dt;
			if (p.kind === 'fire' || p.kind === 'embers') p.vx *= 1 - dt * 2;
		}
		this.parts = this.parts.filter((p) => p.age < p.life).slice(-500);
		for (const g of this.rings) g.age += dt;
		this.rings = this.rings.filter((g) => g.age < g.life);
		for (const b of this.banners) b.age += dt;
		this.banners = this.banners.filter((b) => b.age < b.life);
		// a settled group stays a moment, then fades
		const hold = 1.6;
		this.dice = this.dice.filter((d) => !(d.settled && d.group.pending === 0 && d.settleT > hold + 0.45));
		return this.dice.length > 0 || this.parts.length > 0 || this.rings.length > 0 || this.banners.length > 0;
	}

	#settle(d, set) {
		d.settled = true;
		d.vx = d.vy = d.vr = 0;
		d.face = d.value ?? '?';
		const L = d.look;
		if (!set.reduced) {
			if (L.land === 'ring' || L.land === 'burst') this.rings.push({ x: d.x, y: d.y + d.r * 0.55, r: d.r, age: 0, life: 0.55, look: L, kind: 'ring' });
			if (L.land === 'flash' || L.land === 'burst') this.rings.push({ x: d.x, y: d.y, r: d.r, age: 0, life: 0.3, look: L, kind: 'flash' });
			if (L.land === 'burst') {
				const kind = L.trail === 'none' ? 'sparkle' : L.trail;
				for (let i = 0; i < 12; i++) {
					const a = (i / 12) * TAU;
					this.parts.push(spawn(kind, d.x, d.y, L, Math.cos(a) * 160, Math.sin(a) * 110 - 40));
				}
			}
		}
		const g = d.group;
		g.pending--;
		if (g.pending === 0) {
			// the whole throw has landed: the flourish, the sound, and the chat can show the result
			if (g.crit) this.#flourish(g, 'CRITICAL!', '#ffd34d', set);
			else if (g.fumble) this.#flourish(g, 'FUMBLE', '#ff6b7a', set);
			diceSound(L.sound, g.crit ? 'crit' : g.fumble ? 'fumble' : 'land', set.volume);
			g.resolve();
		}
	}

	#flourish(g, text, color, set) {
		const xs = g.dice.map((d) => d.x);
		const ys = g.dice.map((d) => d.y);
		const x = (Math.min(...xs) + Math.max(...xs)) / 2;
		const y = Math.min(...ys) - g.dice[0].r * 1.9;
		this.banners.push({ text, color, x, y, age: 0, life: 1.9, pixel: g.look.style === 'pixel' });
		if (set.reduced) return;
		for (const d of g.dice) {
			this.rings.push({ x: d.x, y: d.y, r: d.r * 1.6, age: 0, life: 0.7, look: { ...d.look, glow: color }, kind: 'ring' });
			for (let i = 0; i < 16; i++) {
				const a = (i / 16) * TAU;
				this.parts.push(spawn(g.crit ? 'stars' : 'embers', d.x, d.y, d.look, Math.cos(a) * 220, Math.sin(a) * 160 - 60));
			}
		}
	}

	/* ---------------------------- drawing ----------------------------- */

	#draw() {
		const { canvas, dpr, W, H } = this;
		const ctx = canvas.getContext('2d');
		ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
		ctx.clearRect(0, 0, W, H);
		const lo = this.lo.getContext('2d');
		lo.setTransform(1, 0, 0, 1, 0, 0);
		lo.clearRect(0, 0, this.lo.width, this.lo.height);
		let anyPixel = false;
		const visible = this.dice.filter((d) => d.delay <= 0).sort((a, b) => a.y - b.y);
		const pick = (look) => (look.style === 'pixel' ? ((anyPixel = true), [lo, 1 / PIX]) : [ctx, 1]);
		for (const g of this.rings) {
			const [c, k] = pick(g.look);
			this.#drawRing(c, g, k);
		}
		for (const d of visible) {
			const [c, k] = pick(d.look);
			this.#drawShadow(c, d, k);
		}
		for (const p of this.parts) {
			const [c, k] = pick(p.look);
			drawParticle(c, p, k);
		}
		for (const d of visible) {
			const [c, k] = pick(d.look);
			const fade = d.settled && d.group.pending === 0 ? clamp(1 - (d.settleT - 1.6) / 0.45, 0, 1) : 1;
			c.globalAlpha = fade;
			if (d.look.style === 'pixel') this.#drawPixelDie(c, d, k);
			else this.#drawSmoothDie(c, d);
			c.globalAlpha = 1;
		}
		if (anyPixel) {
			// hard edges: every art pixel is fully there or not at all
			const img = lo.getImageData(0, 0, this.lo.width, this.lo.height);
			const a = img.data;
			for (let i = 3; i < a.length; i += 4) a[i] = a[i] < 100 ? 0 : 255;
			lo.putImageData(img, 0, 0);
			ctx.imageSmoothingEnabled = false;
			ctx.drawImage(this.lo, 0, 0, this.lo.width * PIX, this.lo.height * PIX);
		}
		for (const b of this.banners) this.#drawBanner(ctx, b);
	}

	#drawShadow(c, d, k) {
		const s = 1 - Math.min(0.6, d.z / (d.r * 6));
		c.fillStyle = 'rgba(0,0,0,0.35)';
		c.beginPath();
		c.ellipse(d.x * k, (d.y + d.r * 0.85) * k, d.r * 0.95 * s * k, d.r * 0.32 * s * k, 0, 0, TAU);
		c.fill();
	}

	#drawRing(c, g, k) {
		const t = g.age / g.life;
		c.save();
		if (g.kind === 'flash') {
			c.fillStyle = rgba(g.look.glow, (1 - t) * 0.55);
			c.beginPath();
			c.arc(g.x * k, g.y * k, g.r * (1 + t * 1.4) * k, 0, TAU);
			c.fill();
		} else {
			c.strokeStyle = rgba(g.look.glow, 1 - t);
			c.lineWidth = Math.max(1, 3 * k * (1 - t) + (k < 1 ? 1 : 0));
			c.beginPath();
			c.ellipse(g.x * k, g.y * k, g.r * (0.8 + t * 1.6) * k, g.r * (0.3 + t * 0.55) * k, 0, 0, TAU);
			c.stroke();
		}
		c.restore();
	}

	/** The outline path, squashed sideways as the die tumbles */
	#path(c, d, x, y, R) {
		const squash = d.settled ? 1 : 0.72 + 0.28 * Math.abs(Math.cos(d.tumble));
		c.save();
		c.translate(x, y);
		c.rotate(d.rot);
		c.scale(squash, 1);
		c.beginPath();
		if (!d.shape.outline) c.arc(0, 0, R, 0, TAU);
		else d.shape.outline.forEach(([px, py], i) => (i ? c.lineTo(px * R, py * R) : c.moveTo(px * R, py * R)));
		c.closePath();
		return squash;
	}

	#drawSmoothDie(c, d) {
		const L = d.look;
		const R = d.r;
		const x = d.x;
		const y = d.y - d.z;
		const glowing = d.settled && d.group.pending === 0;
		this.#path(c, d, x, y, R);
		if (glowing || L.material === 'glass') {
			c.shadowColor = L.glow;
			c.shadowBlur = glowing ? 22 : 10;
		}
		let fill;
		if (L.material === 'gem') {
			fill = c.createRadialGradient(-R * 0.35, -R * 0.4, R * 0.1, 0, 0, R * 1.2);
			fill.addColorStop(0, mix(L.body, '#ffffff', 0.5));
			fill.addColorStop(0.45, L.body);
			fill.addColorStop(1, mix(L.body, '#000000', 0.55));
		} else if (L.material === 'metal') {
			fill = c.createLinearGradient(-R, -R, R, R);
			fill.addColorStop(0, mix(L.body, '#ffffff', 0.55));
			fill.addColorStop(0.35, L.body);
			fill.addColorStop(0.55, mix(L.body, '#ffffff', 0.25));
			fill.addColorStop(1, mix(L.body, '#000000', 0.5));
		} else if (L.material === 'glass') {
			fill = c.createRadialGradient(0, 0, R * 0.1, 0, 0, R * 1.1);
			fill.addColorStop(0, rgba(L.glow, 0.55));
			fill.addColorStop(0.6, rgba(L.body, 0.6));
			fill.addColorStop(1, rgba(L.body, 0.85));
		} else fill = L.body;
		c.fillStyle = fill;
		c.fill();
		c.shadowBlur = 0;
		// facets and rim
		c.strokeStyle = rgba(L.edge, 0.45);
		c.lineWidth = 1.2;
		c.beginPath();
		if (d.shape.inset) c.rect(-R * d.shape.inset, -R * d.shape.inset, R * d.shape.inset * 2, R * d.shape.inset * 2);
		for (const [[ax, ay], [bx, by]] of facetLines(d.shape)) {
			c.moveTo(ax * R, ay * R);
			c.lineTo(bx * R, by * R);
		}
		c.stroke();
		c.restore();
		this.#path(c, d, x, y, R);
		c.strokeStyle = L.edge;
		c.lineWidth = 2;
		c.stroke();
		// a highlight on the upper left
		c.fillStyle = 'rgba(255,255,255,0.35)';
		c.beginPath();
		c.ellipse(-R * 0.38, -R * 0.45, R * 0.22, R * 0.1, -0.6, 0, TAU);
		c.fill();
		c.restore();
		// the number stays upright
		const fs = Math.round(R * d.shape.text * 1.15);
		c.font = `700 ${fs}px "FUD Antonio", "Antonio", "Arial Narrow", sans-serif`;
		c.textAlign = 'center';
		c.textBaseline = 'middle';
		c.lineWidth = Math.max(2, fs * 0.14);
		c.strokeStyle = mix(L.body, '#000000', 0.7);
		const ty = y + (d.shape.ty ?? 0) * R;
		c.strokeText(String(d.face), x, ty);
		c.fillStyle = L.number;
		c.fillText(String(d.face), x, ty);
	}

	#drawPixelDie(c, d, k) {
		const L = d.look;
		const R = d.r * k;
		const x = d.x * k;
		const y = (d.y - d.z) * k;
		this.#path(c, d, x, y, R);
		c.fillStyle = L.body;
		c.fill();
		// two-tone shading: the lower right half darker
		c.save();
		c.clip();
		c.fillStyle = mix(L.body, '#000000', 0.35);
		c.beginPath();
		c.moveTo(-R * 2, R * 0.4);
		c.lineTo(R * 2, -R * 0.6);
		c.lineTo(R * 2, R * 2);
		c.lineTo(-R * 2, R * 2);
		c.fill();
		c.fillStyle = mix(L.body, '#ffffff', 0.45);
		c.fillRect(-R * 0.55, -R * 0.6, Math.max(1, R * 0.22), Math.max(1, R * 0.12));
		c.restore();
		c.restore();
		this.#path(c, d, x, y, R);
		c.strokeStyle = L.edge;
		c.lineWidth = 1.2;
		c.stroke();
		c.restore();
		const scale = Math.max(1, Math.floor(R / 9));
		pixelText(c, d.face, x, y + (d.shape.ty ?? 0) * R, scale, L.number, mix(L.body, '#000000', 0.65));
	}

	#drawBanner(c, b) {
		const t = b.age / b.life;
		const pop = t < 0.12 ? 0.6 + (t / 0.12) * 0.55 : t < 0.2 ? 1.15 - ((t - 0.12) / 0.08) * 0.15 : 1;
		const a = t > 0.8 ? 1 - (t - 0.8) / 0.2 : 1;
		c.save();
		c.globalAlpha = a;
		c.translate(b.x, b.y - t * 18);
		c.scale(pop, pop);
		c.textAlign = 'center';
		c.textBaseline = 'middle';
		c.font = `700 ${b.pixel ? 30 : 40}px "FUD Antonio", "Antonio", "Arial Narrow", sans-serif`;
		c.lineWidth = 7;
		c.strokeStyle = '#140a04';
		c.strokeText(b.text, 0, 0);
		c.shadowColor = b.color;
		c.shadowBlur = 18;
		c.fillStyle = b.color;
		c.fillText(b.text, 0, 0);
		c.restore();
	}

	/** Clear everything at once (scene change, setting off) */
	clear() {
		this.dice = [];
		this.parts = [];
		this.rings = [];
		this.banners = [];
		if (this.canvas) this.canvas.getContext('2d').clearRect(0, 0, this.canvas.width, this.canvas.height);
	}
}
