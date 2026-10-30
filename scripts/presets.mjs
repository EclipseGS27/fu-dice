/**
 * Looks for the dice. Every preset is a full appearance; players start from one and change any part.
 *
 * style     pixel (chunky, crisp, bitmap numbers) or smooth (anti-aliased, gradients, glow)
 * material  gem, glass, metal or flat: how the body is shaded
 * body, edge, number, glow   colors
 * trail     what the dice leave behind while they fly
 * land      what happens when a die comes to rest
 * sound     the set of synthesized sounds
 *
 * The Final Fantasy presets borrow each era's mood and colors only; nothing is copied from the games.
 */

export const STYLES = { pixel: 'Pixel art', smooth: 'Smooth' };
export const MATERIALS = { gem: 'Gem', glass: 'Glass', metal: 'Metal', flat: 'Flat' };
export const TRAILS = { none: 'None', sparkle: 'Sparkles', stars: 'Stars', fire: 'Flames', embers: 'Embers', ice: 'Ice shards', motes: 'Floating motes', feathers: 'Feathers', shards: 'Crystal shards' };
export const LANDINGS = { none: 'None', ring: 'Ring', burst: 'Burst', flash: 'Flash' };
export const SOUNDS = { chime: 'Chimes', crystal: 'Crystal', clack: 'Wooden clack', retro: '8-bit', none: 'Silent' };

export const PRESETS = {
	battle: { name: 'Battle UI', blurb: 'Navy glass, gold numbers, sky-blue sparkles.', style: 'smooth', material: 'glass', body: '#16284d', edge: '#9fd0ff', number: '#f2c45a', glow: '#5aa9ff', trail: 'sparkle', land: 'ring', sound: 'chime' },
	retro: { name: '8-bit', blurb: 'Plain white pixel dice with black pips of numbers. Old-school.', style: 'pixel', material: 'flat', body: '#f4f4f4', edge: '#1a1a1a', number: '#1a1a1a', glow: '#ffffff', trail: 'none', land: 'flash', sound: 'retro' },
	ff6: { name: 'Esper · FF6', blurb: 'Magicite pinks and violets in 16-bit pixels.', style: 'pixel', material: 'gem', body: '#7a2a8c', edge: '#ff9df0', number: '#ffffff', glow: '#ff8ce6', trail: 'sparkle', land: 'burst', sound: 'retro' },
	ff7: { name: 'Materia · FF7', blurb: 'Glowing green orbs of glass, sparks of the Lifestream.', style: 'smooth', material: 'glass', body: '#1f8a45', edge: '#b8ffcf', number: '#ffffff', glow: '#6dff9e', trail: 'motes', land: 'ring', sound: 'crystal' },
	ff8: { name: 'Gunblade · FF8', blurb: 'Brushed steel with a cold blue edge.', style: 'smooth', material: 'metal', body: '#4b5568', edge: '#c9d6ea', number: '#eaf2ff', glow: '#7fb2ff', trail: 'embers', land: 'flash', sound: 'clack' },
	ff9: { name: 'Storybook · FF9', blurb: 'Warm parchment and gold, a fairy-tale shine.', style: 'smooth', material: 'gem', body: '#c9973d', edge: '#fff1c4', number: '#4a2a0c', glow: '#ffd77a', trail: 'stars', land: 'burst', sound: 'chime' },
	ff10: { name: 'Pyrefly · FF10', blurb: 'Translucent sea-blue dice trailing drifting lights.', style: 'smooth', material: 'glass', body: '#1c6fa8', edge: '#bdf4ff', number: '#ffffff', glow: '#7ff0ff', trail: 'motes', land: 'ring', sound: 'crystal' },
	ff12: { name: 'Ivalice · FF12', blurb: 'Bronze and amber, sun-worn and ornate.', style: 'smooth', material: 'metal', body: '#8a5a2b', edge: '#ffd59a', number: '#fff4dc', glow: '#ffb347', trail: 'sparkle', land: 'flash', sound: 'clack' },
	ff13: { name: 'Crystal · FF13', blurb: 'Ice-clear crystal shards and a frozen landing.', style: 'smooth', material: 'glass', body: '#5fb7e6', edge: '#ffffff', number: '#0f2a44', glow: '#bff2ff', trail: 'ice', land: 'burst', sound: 'crystal' },
	ff14: { name: 'Aether · FF14', blurb: 'Deep blue gems humming with aether.', style: 'smooth', material: 'gem', body: '#22357a', edge: '#8fe9ff', number: '#e8fbff', glow: '#5fe0ff', trail: 'motes', land: 'ring', sound: 'chime' },
	ff15: { name: 'Royal Arms · FF15', blurb: 'Spectral violet glass, crystal shards in its wake.', style: 'smooth', material: 'glass', body: '#3b2a7a', edge: '#c9b8ff', number: '#ffffff', glow: '#9f8cff', trail: 'shards', land: 'flash', sound: 'crystal' },
	ff16: { name: 'Eikon · FF16', blurb: 'Charred black with molten edges, trailing flame.', style: 'smooth', material: 'metal', body: '#1d1412', edge: '#ff8a3d', number: '#ffd27a', glow: '#ff6a1a', trail: 'fire', land: 'burst', sound: 'clack' },
	ember: { name: 'Ember pixel', blurb: 'Pixel dice of red-hot iron, sparks flying.', style: 'pixel', material: 'gem', body: '#8c1f17', edge: '#ffc23d', number: '#fff3a6', glow: '#ff8a2a', trail: 'embers', land: 'burst', sound: 'retro' },
};

export const DEFAULT_PRESET = 'battle';

/** A full appearance from whatever was stored: missing parts come from its preset, then the default */
export function appearanceOf(stored) {
	const base = PRESETS[stored?.preset] ?? PRESETS[DEFAULT_PRESET];
	const out = { preset: stored?.preset in PRESETS ? stored.preset : DEFAULT_PRESET, ...base, ...(stored ?? {}) };
	delete out.name;
	delete out.blurb;
	return out;
}
