/**
 * A 5x7 bitmap font for pixel dice. Pixel numbers stay readable when they are drawn upright, at a whole-number
 * scale, with a solid one-pixel dark outline: no rotation, no smoothing, no in-between sizes.
 */

const ROWS = {
	0: ['01110', '10001', '10011', '10101', '11001', '10001', '01110'],
	1: ['00100', '01100', '00100', '00100', '00100', '00100', '01110'],
	2: ['01110', '10001', '00001', '00010', '00100', '01000', '11111'],
	3: ['11111', '00010', '00100', '00010', '00001', '10001', '01110'],
	4: ['00010', '00110', '01010', '10010', '11111', '00010', '00010'],
	5: ['11111', '10000', '11110', '00001', '00001', '10001', '01110'],
	6: ['00110', '01000', '10000', '11110', '10001', '10001', '01110'],
	7: ['11111', '00001', '00010', '00100', '01000', '01000', '01000'],
	8: ['01110', '10001', '10001', '01110', '10001', '10001', '01110'],
	9: ['01110', '10001', '10001', '01111', '00001', '00010', '01100'],
	'?': ['01110', '10001', '00001', '00010', '00100', '00000', '00100'],
	'+': ['00000', '00100', '00100', '11111', '00100', '00100', '00000'],
	'-': ['00000', '00000', '00000', '11111', '00000', '00000', '00000'],
};

/** Lit cells per character, as [x, y] */
const CELLS = Object.fromEntries(Object.entries(ROWS).map(([ch, rows]) => [ch, rows.flatMap((r, y) => [...r].flatMap((b, x) => (b === '1' ? [[x, y]] : [])))]));

/** Width and height in font pixels (one pixel gap between characters), not counting the outline */
export const textSize = (text) => [Math.max(1, String(text).length * 6 - 1), 7];

/**
 * Draw text with its top-left at (x, y), each font pixel k by k, outlined.
 * @param {CanvasRenderingContext2D} c
 */
export function drawPixelText(c, text, x, y, k, color, ink = '#0a0710') {
	const chars = [...String(text)];
	const cells = chars.flatMap((ch, i) => (CELLS[ch] ?? CELLS['?']).map(([cx, cy]) => [cx + i * 6, cy]));
	c.fillStyle = ink;
	for (const [cx, cy] of cells) c.fillRect(x + (cx - 1) * k, y + (cy - 1) * k, k * 3, k * 3);
	c.fillStyle = color;
	for (const [cx, cy] of cells) c.fillRect(x + cx * k, y + cy * k, k, k);
}

/** Draw text centred on (x, y), snapped to a grid of k (offset by ox, oy) so it lines up with the dice's pixels */
export function drawPixelTextAt(c, text, x, y, k, color, ink, ox = 0, oy = 0) {
	const [w, h] = textSize(text);
	const left = ox + Math.round((x - (w * k) / 2 - ox) / k) * k;
	const top = oy + Math.round((y - (h * k) / 2 - oy) / k) * k;
	drawPixelText(c, text, left, top, k, color, ink);
}
