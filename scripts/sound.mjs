/**
 * Dice sounds, synthesized with Web Audio: no files to download. Each set has a throw, a bounce, a landing,
 * and a fanfare for criticals (a sad fall for fumbles).
 */

let ac = null;
const audio = () => {
	if (!ac) {
		try {
			ac = new (window.AudioContext || window.webkitAudioContext)();
		} catch {
			return null;
		}
	}
	if (ac.state === 'suspended') ac.resume().catch(() => {});
	return ac;
};

function tone(c, { freq, type = 'sine', at = 0, dur = 0.15, vol = 0.2, slide = 0 }) {
	const t = c.currentTime + at;
	const o = c.createOscillator();
	const g = c.createGain();
	o.type = type;
	o.frequency.setValueAtTime(freq, t);
	if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq * slide), t + dur);
	g.gain.setValueAtTime(0.0001, t);
	g.gain.exponentialRampToValueAtTime(vol, t + 0.008);
	g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
	o.connect(g).connect(c.destination);
	o.start(t);
	o.stop(t + dur + 0.02);
}

function noise(c, { at = 0, dur = 0.06, vol = 0.25, freq = 1800, q = 1.2 }) {
	const t = c.currentTime + at;
	const len = Math.ceil(c.sampleRate * dur);
	const buf = c.createBuffer(1, len, c.sampleRate);
	const d = buf.getChannelData(0);
	for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 2;
	const src = c.createBufferSource();
	src.buffer = buf;
	const f = c.createBiquadFilter();
	f.type = 'bandpass';
	f.frequency.value = freq;
	f.Q.value = q;
	const g = c.createGain();
	g.gain.value = vol;
	src.connect(f).connect(g).connect(c.destination);
	src.start(t);
}

const NOTES = { C5: 523.25, E5: 659.25, G5: 783.99, C6: 1046.5, E6: 1318.5, G6: 1568, A4: 440, F4: 349.23, D4: 293.66 };

const SETS = {
	chime: {
		throw: (c, v) => noise(c, { dur: 0.18, vol: 0.12 * v, freq: 2600, q: 0.7 }),
		bounce: (c, v) => (noise(c, { vol: 0.22 * v, freq: 2200 }), tone(c, { freq: 2400 + Math.random() * 600, dur: 0.08, vol: 0.05 * v })),
		land: (c, v) => tone(c, { freq: NOTES.E6, dur: 0.5, vol: 0.12 * v }),
		crit: (c, v) => [NOTES.C5, NOTES.E5, NOTES.G5, NOTES.C6].forEach((f, i) => tone(c, { freq: f, at: i * 0.09, dur: 0.5, vol: 0.14 * v, type: 'triangle' })),
		fumble: (c, v) => [NOTES.A4, NOTES.F4, NOTES.D4].forEach((f, i) => tone(c, { freq: f, at: i * 0.14, dur: 0.4, vol: 0.13 * v, type: 'triangle' })),
	},
	crystal: {
		throw: (c, v) => tone(c, { freq: 2600, dur: 0.25, vol: 0.05 * v, slide: 1.6 }),
		bounce: (c, v) => (tone(c, { freq: 3000 + Math.random() * 1200, dur: 0.12, vol: 0.08 * v }), tone(c, { freq: 4400 + Math.random() * 800, dur: 0.09, vol: 0.05 * v })),
		land: (c, v) => [NOTES.G6, NOTES.C6].forEach((f, i) => tone(c, { freq: f, at: i * 0.06, dur: 0.7, vol: 0.09 * v })),
		crit: (c, v) => [NOTES.E5, NOTES.G5, NOTES.C6, NOTES.E6, NOTES.G6].forEach((f, i) => tone(c, { freq: f, at: i * 0.07, dur: 0.7, vol: 0.11 * v })),
		fumble: (c, v) => tone(c, { freq: 900, dur: 0.8, vol: 0.12 * v, slide: 0.4 }),
	},
	clack: {
		throw: (c, v) => noise(c, { dur: 0.12, vol: 0.1 * v, freq: 900, q: 0.8 }),
		bounce: (c, v) => noise(c, { dur: 0.05, vol: 0.4 * v, freq: 650 + Math.random() * 500, q: 4 }),
		land: (c, v) => noise(c, { dur: 0.07, vol: 0.35 * v, freq: 520, q: 5 }),
		crit: (c, v) => [NOTES.C5, NOTES.G5, NOTES.C6].forEach((f, i) => tone(c, { freq: f, at: 0.05 + i * 0.1, dur: 0.45, vol: 0.13 * v, type: 'sawtooth' })),
		fumble: (c, v) => tone(c, { freq: 220, dur: 0.6, vol: 0.14 * v, type: 'sawtooth', slide: 0.5 }),
	},
	retro: {
		throw: (c, v) => tone(c, { freq: 300, dur: 0.12, vol: 0.06 * v, type: 'square', slide: 2.2 }),
		bounce: (c, v) => tone(c, { freq: 180 + Math.random() * 120, dur: 0.05, vol: 0.08 * v, type: 'square' }),
		land: (c, v) => (tone(c, { freq: 660, dur: 0.06, vol: 0.07 * v, type: 'square' }), tone(c, { freq: 990, at: 0.07, dur: 0.1, vol: 0.07 * v, type: 'square' })),
		crit: (c, v) => [523, 659, 784, 1047, 784, 1047].forEach((f, i) => tone(c, { freq: f, at: i * 0.08, dur: 0.12, vol: 0.08 * v, type: 'square' })),
		fumble: (c, v) => [392, 330, 262, 196].forEach((f, i) => tone(c, { freq: f, at: i * 0.12, dur: 0.14, vol: 0.08 * v, type: 'square' })),
	},
};

/**
 * @param {string} set chime, crystal, clack, retro or none
 * @param {'throw'|'bounce'|'land'|'crit'|'fumble'} event
 * @param {number} volume 0..1
 */
export function diceSound(set, event, volume = 0.6) {
	const fn = SETS[set]?.[event];
	if (!fn || !(volume > 0.01)) return;
	const c = audio();
	if (!c) return;
	try {
		fn(c, Math.min(1, volume));
	} catch {
		/* audio not available */
	}
}
