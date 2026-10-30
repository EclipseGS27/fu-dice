import { DiceStage } from './engine.mjs';
import { DiceStage3D, webglAvailable } from './engine3d.mjs';
import { DiceConfig, myAppearance } from './config.mjs';
import { appearanceOf } from './presets.mjs';

/**
 * Fabula Ultima Dice: every roll posted to chat is thrown across the screen in its roller's dice, and the card
 * waits until they land. Works with any system; with Project FU, criticals and fumbles get their flourish.
 */

const MODULE_ID = 'fu-dice';
const get = (k) => {
	try {
		return game.settings.get(MODULE_ID, k);
	} catch {
		return undefined;
	}
};

const stageSettings = () => ({ size: get('size'), speed: get('speed'), reduced: get('reduced'), volume: volume() });
const stages = {};
/** 3D dice (the default) or the lighter 2D ones; 2D when this browser has no WebGL */
export function useStage() {
	const mode = get('renderer') === '2d' || !webglAvailable() ? '2d' : '3d';
	if (!stages[mode]) {
		try {
			stages[mode] = mode === '3d' ? new DiceStage3D({ settings: stageSettings }) : new DiceStage({ settings: stageSettings });
		} catch (err) {
			console.warn(`${MODULE_ID} | 3D dice unavailable, using 2D`, err);
			stages[mode] = stages['2d'] ??= new DiceStage({ settings: stageSettings });
		}
	}
	return stages[mode];
}
const stage = { roll: (...a) => useStage().roll(...a), clear: () => Object.values(stages).forEach((s) => s.clear()) };

/** The module's volume, times Foundry's interface volume */
function volume() {
	let iface = 1;
	try {
		iface = Number(game.settings.get('core', 'globalInterfaceVolume') ?? 1);
	} catch {
		/* older core */
	}
	return (Number(get('volume')) || 0) * iface;
}

/* ------------------------------------------------------------------ */
/*  Settings                                                           */
/* ------------------------------------------------------------------ */

Hooks.once('init', () => {
	const reg = (key, data) => game.settings.register(MODULE_ID, key, { config: true, scope: 'client', ...data });
	reg('renderer', { name: 'Dice', hint: '3D: real dice with physics. 2D: flat dice, lighter on older computers.', type: String, choices: { '3d': '3D', '2d': '2D (lighter)' }, default: '3d', onChange: () => stage.clear() });
	reg('enabled', { name: 'Show dice', hint: 'Throw dice across the screen when a roll is posted to chat.', type: Boolean, default: true, onChange: (v) => !v && stage.clear() });
	reg('showOthers', { name: 'Whose rolls', type: String, choices: { all: 'Everyone’s', mine: 'Only mine', none: 'None' }, default: 'all' });
	reg('ownStyles', { name: 'Each player’s own dice', hint: 'Show other players’ rolls in the dice they picked. Off: every roll uses yours.', type: Boolean, default: true });
	reg('holdChat', { name: 'Wait for the dice', hint: 'A roll’s chat card shows once its dice have landed, so the result isn’t spoiled.', type: Boolean, default: true });
	reg('size', { name: 'Dice size', type: Number, range: { min: 0.5, max: 2, step: 0.1 }, default: 1 });
	reg('speed', { name: 'Dice speed', type: Number, range: { min: 0.5, max: 2, step: 0.1 }, default: 1 });
	reg('volume', { name: 'Dice volume', type: Number, range: { min: 0, max: 1, step: 0.05 }, default: 0.6 });
	reg('maxDice', { name: 'Most dice per roll', hint: 'Bigger rolls show this many dice; the chat card still has every result.', type: Number, range: { min: 1, max: 20, step: 1 }, default: 10 });
	reg('reduced', { name: 'Lighter effects', hint: 'No trails, dust or landing effects: the dice only. For slower computers.', type: Boolean, default: false });
	game.settings.register(MODULE_ID, 'deferToDsn', { name: 'Step aside for Dice So Nice', hint: 'When Dice So Nice is on, let it show the dice instead.', scope: 'world', config: true, type: Boolean, default: true });
	game.settings.registerMenu(MODULE_ID, 'appearance', { name: 'Your dice', label: 'Choose your dice', hint: 'Presets (JRPG eras, pixel or smooth), colors, trails, landing effects and sounds, with a live preview.', icon: 'fa-solid fa-dice-d20', type: DiceConfig, restricted: false });

	game.modules.get(MODULE_ID).api = {
		/** Throw dice yourself: dice = [{faces, value}] */
		roll: (dice, opts = {}) => stage.roll(dice, { appearance: opts.appearance ?? myAppearance(), ...opts }),
		/** A demo throw on this screen only */
		test: (appearance = myAppearance()) => {
			const v = (n) => 1 + Math.floor(Math.random() * n);
			return stage.roll([{ faces: 8, value: v(8) }, { faces: 10, value: v(10) }], { appearance, crit: Math.random() < 0.25 });
		},
		config: () => new DiceConfig().render({ force: true }),
		stage,
	};
});

Hooks.once('ready', () => {
	if (dsnTakesOver() && game.user.isGM) ui.notifications.info('Fabula Ultima Dice is resting while Dice So Nice is on (see its settings to change that).');
});

const dsnTakesOver = () => !!game.modules.get('dice-so-nice')?.active && get('deferToDsn') !== false;

/* ------------------------------------------------------------------ */
/*  Chat: throw the dice of every roll                                 */
/* ------------------------------------------------------------------ */

/** message ids whose cards wait for their dice */
const pending = new Set();

function diceOf(msg) {
	const out = [];
	for (const roll of msg.rolls ?? []) {
		for (const term of roll.dice ?? []) {
			const faces = Number(term.faces) || 6;
			for (const r of term.results ?? []) if (r.active !== false && !r.discarded) out.push({ faces, value: r.result });
		}
	}
	return out;
}

function setPending(id, on) {
	for (const el of document.querySelectorAll(`.chat-message[data-message-id="${id}"]`)) el.classList.toggle('fud-pending', on);
}

function reveal(id) {
	if (!pending.delete(id)) return;
	setPending(id, false);
	try {
		ui.chat?.scrollBottom?.({ waitImages: false });
	} catch {
		/* older core */
	}
}

Hooks.on('createChatMessage', (msg) => {
	if (get('enabled') === false || dsnTakesOver() || !msg.rolls?.length) return;
	if (msg.visible === false) return; // whispered to someone else
	const author = msg.author ?? game.users.get(msg.user?.id ?? msg.user);
	const mine = author?.id === game.user.id;
	const show = get('showOthers') ?? 'all';
	if (show === 'none' || (show === 'mine' && !mine)) return;
	let dice = diceOf(msg);
	if (!dice.length) return;
	dice = dice.slice(0, Math.max(1, Number(get('maxDice')) || 10));
	// a roll you may not see: the dice still fly, with "?" on them
	if (msg.isContentVisible === false) dice = dice.map((d) => ({ ...d, value: null }));
	const appearance = get('ownStyles') !== false && author ? appearanceOf(author.getFlag(MODULE_ID, 'appearance')) : myAppearance();
	const check = msg.getFlag?.('projectfu', 'Check');
	const visible = msg.isContentVisible !== false;
	if (get('holdChat') !== false) {
		pending.add(msg.id);
		setPending(msg.id, true);
		// never hold a card for long, whatever happens
		setTimeout(() => reveal(msg.id), 6000);
	}
	stage
		.roll(dice, { appearance, crit: visible && !!check?.critical, fumble: visible && !!check?.fumble })
		.catch((err) => console.warn(`${MODULE_ID} | roll`, err))
		.finally(() => reveal(msg.id));
});

/* the card may render after the hook above: keep it hidden until the dice land */
Hooks.on('renderChatMessageHTML', (msg, html) => {
	if (pending.has(msg.id)) html?.classList?.add('fud-pending');
});

Hooks.on('canvasTearDown', () => stage.clear());
