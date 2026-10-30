/**
 * Looks for the dice. Every preset is a full appearance; players start from one and change any part.
 *
 * style     pixel (chunky, crisp, bitmap numbers) or smooth (anti-aliased, gradients, glow)
 * material  gem, glass, metal or flat: how the body is shaded
 * body, edge, number, glow   colors
 * trail     what the dice leave behind while they fly
 * land      what happens when a die comes to rest
 * sound     the set of synthesized sounds
 * texture, accent, strength   the surface pattern, its second color and how strongly it shows
 * throw, from, settle, exit, popup   how the dice move (see the maps below)
 *
 * The Final Fantasy presets borrow each era's mood and colors only; nothing is copied from the games.
 */

export const STYLES = { pixel: 'Pixel art', smooth: 'Smooth' };
export const MATERIALS = { gem: 'Gem', glass: 'Glass', metal: 'Metal', flat: 'Flat' };
export const TRAILS = { none: 'None', sparkle: 'Sparkles', stars: 'Stars', fire: 'Flames', embers: 'Embers', ice: 'Ice shards', motes: 'Floating motes', feathers: 'Feathers', shards: 'Crystal shards' };
export const LANDINGS = { none: 'None', ring: 'Ring', burst: 'Burst', flash: 'Flash' };
export const SOUNDS = { chime: 'Chimes', crystal: 'Crystal', clack: 'Wooden clack', retro: '8-bit', none: 'Silent' };
export { TEXTURES } from './textures.mjs';

/* animation */
export const THROWS = { toss: 'Toss', drop: 'Drop from above', slam: 'Slam', roll: 'Roll along the table', summon: 'Summon (appear in place)' };
export const FROMS = { right: 'Bottom right', left: 'Bottom left', bottom: 'Bottom', top: 'Top', random: 'Anywhere' };
export const SETTLES = { none: 'Just stop', pop: 'Pop', glow: 'Glow', hop: 'Hop' };
export const EXITS = { fade: 'Fade', shrink: 'Shrink', sink: 'Sink', float: 'Float away', burst: 'Burst into sparks' };
export const POPUPS = { none: 'None', each: 'Each die', total: 'Total' };
const MOTION = { throw: 'toss', from: 'right', settle: 'pop', exit: 'fade', popup: 'none' };

export const PRESETS = {
	battle: { name: 'Battle UI', blurb: 'Navy glass, gold numbers, sky-blue sparkles.', style: 'smooth', material: 'glass', body: '#16284d', edge: '#9fd0ff', number: '#f2c45a', glow: '#5aa9ff', trail: 'sparkle', land: 'ring', sound: 'chime', texture: 'plain', accent: '#9fd0ff', strength: 0.5 },
	retro: { name: '8-bit', blurb: 'Plain white pixel dice with black pips of numbers. Old-school.', style: 'pixel', material: 'flat', body: '#f4f4f4', edge: '#1a1a1a', number: '#1a1a1a', glow: '#ffffff', trail: 'none', land: 'flash', sound: 'retro', texture: 'plain', accent: '#cccccc', strength: 0.5, settle: 'hop' },
	ff6: { name: 'Esper · FF6', blurb: 'Magicite pinks and violets in 16-bit pixels.', style: 'pixel', material: 'gem', body: '#7a2a8c', edge: '#ff9df0', number: '#ffffff', glow: '#ff8ce6', trail: 'sparkle', land: 'burst', sound: 'retro', texture: 'runes', accent: '#ff9df0', strength: 0.5 },
	ff7: { name: 'Materia · FF7', blurb: 'Glowing green orbs of glass, sparks of the Lifestream.', style: 'smooth', material: 'glass', body: '#1f8a45', edge: '#b8ffcf', number: '#ffffff', glow: '#6dff9e', trail: 'motes', land: 'ring', sound: 'crystal', texture: 'nebula', accent: '#b8ffcf', strength: 0.7, settle: 'glow' },
	ff8: { name: 'Gunblade · FF8', blurb: 'Brushed steel with a cold blue edge.', style: 'smooth', material: 'metal', body: '#4b5568', edge: '#c9d6ea', number: '#eaf2ff', glow: '#7fb2ff', trail: 'embers', land: 'flash', sound: 'clack', texture: 'brushed', accent: '#c9d6ea', strength: 0.7 },
	ff9: { name: 'Storybook · FF9', blurb: 'Warm parchment and gold, a fairy-tale shine.', style: 'smooth', material: 'gem', body: '#c9973d', edge: '#fff1c4', number: '#4a2a0c', glow: '#ffd77a', trail: 'stars', land: 'burst', sound: 'chime', texture: 'marble', accent: '#fff1c4', strength: 0.6 },
	ff10: { name: 'Pyrefly · FF10', blurb: 'Translucent sea-blue dice trailing drifting lights.', style: 'smooth', material: 'glass', body: '#1c6fa8', edge: '#bdf4ff', number: '#ffffff', glow: '#7ff0ff', trail: 'motes', land: 'ring', sound: 'crystal', texture: 'nebula', accent: '#7ff0ff', strength: 0.6, exit: 'float', settle: 'glow' },
	ff11: { name: "Vana'diel · FF11", blurb: 'Weathered stone with gold flecks, an old adventurer’s set.', style: 'smooth', material: 'flat', body: '#6b6458', edge: '#e6cf8a', number: '#f6eedb', glow: '#d9b45a', trail: 'motes', land: 'ring', sound: 'clack', texture: 'stone', accent: '#d9b45a', strength: 0.7 },
	ff12: { name: 'Ivalice · FF12', blurb: 'Bronze and amber, sun-worn and ornate.', style: 'smooth', material: 'metal', body: '#8a5a2b', edge: '#ffd59a', number: '#fff4dc', glow: '#ffb347', trail: 'sparkle', land: 'flash', sound: 'clack', texture: 'runes', accent: '#ffd59a', strength: 0.55 },
	ff13: { name: 'Crystal · FF13', blurb: 'Ice-clear crystal shards and a frozen landing.', style: 'smooth', material: 'glass', body: '#5fb7e6', edge: '#ffffff', number: '#0f2a44', glow: '#bff2ff', trail: 'ice', land: 'burst', sound: 'crystal', texture: 'crystal', accent: '#ffffff', strength: 0.6, exit: 'burst' },
	ff14: { name: 'Aether · FF14', blurb: 'Deep blue gems humming with aether.', style: 'smooth', material: 'gem', body: '#22357a', edge: '#8fe9ff', number: '#e8fbff', glow: '#5fe0ff', trail: 'motes', land: 'ring', sound: 'chime', texture: 'marble', accent: '#8fe9ff', strength: 0.6, throw: 'summon' },
	ff15: { name: 'Royal Arms · FF15', blurb: 'Spectral violet glass, crystal shards in its wake.', style: 'smooth', material: 'glass', body: '#3b2a7a', edge: '#c9b8ff', number: '#ffffff', glow: '#9f8cff', trail: 'shards', land: 'flash', sound: 'crystal', texture: 'crystal', accent: '#c9b8ff', strength: 0.6 },
	ff16: { name: 'Eikon · FF16', blurb: 'Charred black with molten edges, trailing flame.', style: 'smooth', material: 'metal', body: '#1d1412', edge: '#ff8a3d', number: '#ffd27a', glow: '#ff6a1a', trail: 'fire', land: 'burst', sound: 'clack', texture: 'magma', accent: '#ff6a1a', strength: 0.85, throw: 'slam', exit: 'burst' },
	ember: { name: 'Ember pixel', blurb: 'Pixel dice of red-hot iron, sparks flying.', style: 'pixel', material: 'gem', body: '#8c1f17', edge: '#ffc23d', number: '#fff3a6', glow: '#ff8a2a', trail: 'embers', land: 'burst', sound: 'retro', texture: 'magma', accent: '#ffc23d', strength: 0.8 },
};

export const DEFAULT_PRESET = 'battle';

/** A full appearance from whatever was stored: missing parts come from its preset, then the default */
export function appearanceOf(stored) {
	const base = PRESETS[stored?.preset] ?? PRESETS[DEFAULT_PRESET];
	const out = { preset: stored?.preset in PRESETS ? stored.preset : DEFAULT_PRESET, ...MOTION, ...base, ...(stored ?? {}) };
	delete out.name;
	delete out.blurb;
	return out;
}
