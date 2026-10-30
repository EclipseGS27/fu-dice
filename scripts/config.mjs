import { DiceStage } from './engine.mjs';
import { DiceStage3D, webglAvailable } from './engine3d.mjs';
import { EXITS, FROMS, LANDINGS, MATERIALS, POPUPS, PRESETS, SETTLES, SOUNDS, STYLES, TEXTURES, THROWS, TRAILS, appearanceOf } from './presets.mjs';
import { surface } from './textures.mjs';

const MODULE_ID = 'fu-dice';
const { ApplicationV2 } = foundry.applications.api;

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);
const opts = (map, cur) => Object.entries(map).map(([k, l]) => `<option value="${k}" ${k === cur ? 'selected' : ''}>${esc(l)}</option>`).join('');

/** The player's own look, stored on their user so everyone sees their dice that way */
export function myAppearance() {
	return appearanceOf(game.user.getFlag(MODULE_ID, 'appearance'));
}

/**
 * Dice appearance: pick a preset, change any part of it, watch it roll in the preview.
 */
export class DiceConfig extends ApplicationV2 {
	static DEFAULT_OPTIONS = {
		id: 'fud-config',
		classes: ['fud-app'],
		window: { title: 'Your dice', icon: 'fa-solid fa-dice-d20', resizable: true },
		position: { width: 920, height: 720 },
		actions: {
			preset: DiceConfig.#onPreset,
			texture: DiceConfig.#onTexture,
			reroll: DiceConfig.#onReroll,
			screen: DiceConfig.#onScreen,
			save: DiceConfig.#onSave,
		},
	};

	constructor(options) {
		super(options);
		this.look = myAppearance();
	}

	async _renderHTML() {
		const L = this.look;
		const div = document.createElement('div');
		div.className = 'fud-cfg';
		const card = ([id, p]) => `<button type="button" class="fud-preset ${L.preset === id ? 'on' : ''}" data-action="preset" data-id="${id}">
			<span class="sw" style="--b:${p.body};--e:${p.edge};--g:${p.glow}"><i></i></span>
			<span class="t"><b>${esc(p.name)}</b><small>${esc(p.blurb)}</small></span>
			<em>${p.style === 'pixel' ? 'PIXEL' : ''}</em>
		</button>`;
		const color = (k, label) => `<label class="c"><span>${label}</span><input type="color" data-k="${k}" value="${esc(L[k])}"></label>`;
		div.innerHTML = `
			<aside class="fud-presets">${Object.entries(PRESETS).map(card).join('')}</aside>
			<section class="fud-edit">
				<div class="fud-stage"><canvas></canvas><div class="btns"><button type="button" data-action="reroll"><i class="fa-solid fa-dice"></i> Roll again</button><button type="button" data-action="screen" data-tooltip="Throw them across your screen"><i class="fa-solid fa-expand"></i> On screen</button></div></div>
				<h4>Look</h4>
				<div class="fud-grid">
					<label><span>Style</span><select data-k="style">${opts(STYLES, L.style)}</select></label>
					<label><span>Material</span><select data-k="material">${opts(MATERIALS, L.material)}</select></label>
					<label><span>Trail</span><select data-k="trail">${opts(TRAILS, L.trail)}</select></label>
					<label><span>Landing</span><select data-k="land">${opts(LANDINGS, L.land)}</select></label>
					<label><span>Sounds</span><select data-k="sound">${opts(SOUNDS, L.sound)}</select></label>
					<div class="colors">${color('body', 'Body')}${color('accent', 'Pattern')}${color('edge', 'Edges')}${color('number', 'Numbers')}${color('glow', 'Glow')}</div>
				</div>
				<h4>Surface</h4>
				<div class="fud-tex">${Object.entries(TEXTURES).map(([id, label]) => `<button type="button" data-action="texture" data-id="${id}" class="${L.texture === id ? 'on' : ''}"><canvas width="48" height="48"></canvas><span>${esc(label)}</span></button>`).join('')}</div>
				<label class="fud-strength"><span>Pattern strength</span><input type="range" data-k="strength" min="0" max="1" step="0.05" value="${esc(L.strength ?? 0.6)}"></label>
				<h4>Motion</h4>
				<div class="fud-grid">
					<label><span>Throw</span><select data-k="throw">${opts(THROWS, L.throw)}</select></label>
					<label><span>From</span><select data-k="from">${opts(FROMS, L.from)}</select></label>
					<label><span>On landing</span><select data-k="settle">${opts(SETTLES, L.settle)}</select></label>
					<label><span>Leaving</span><select data-k="exit">${opts(EXITS, L.exit)}</select></label>
					<label><span>Pop-up number</span><select data-k="popup">${opts(POPUPS, L.popup)}</select></label>
				</div>
				<p class="note">Everyone sees your dice this way. Size, speed, volume and which rolls you see are in the module settings.</p>
				<footer><span class="sp"></span><button type="button" class="gold" data-action="save"><i class="fa-solid fa-check"></i> Save</button></footer>
			</section>`;
		return div;
	}

	_replaceHTML(result, content) {
		content.replaceChildren(result);
	}

	_onRender() {
		const root = this.element;
		const cv = root.querySelector('.fud-stage canvas');
		this.stage?.clear();
		const three = game.settings.get(MODULE_ID, 'renderer') !== '2d' && webglAvailable();
		this.stage = new (three ? DiceStage3D : DiceStage)({ canvas: cv, settings: () => ({ size: 1, speed: Number(game.settings.get(MODULE_ID, 'speed')) || 1, volume: Number(game.settings.get(MODULE_ID, 'volume')) || 0, reduced: game.settings.get(MODULE_ID, 'reduced') }) });
		root.querySelectorAll('[data-k]').forEach((el) =>
			el.addEventListener('change', () => {
				this.look[el.dataset.k] = el.type === 'range' ? Number(el.value) : el.value;
				this.#thumbs();
				this.#roll();
			}),
		);
		this.#thumbs();
		requestAnimationFrame(() => this.#roll());
	}

	/** Each texture's swatch, in this look's colors */
	#thumbs() {
		const pixel = this.look.style === 'pixel';
		for (const b of this.element.querySelectorAll('.fud-tex button')) {
			const c = b.querySelector('canvas').getContext('2d');
			c.imageSmoothingEnabled = false;
			c.drawImage(surface({ ...this.look, texture: b.dataset.id }, { size: pixel ? 24 : 48, pixel, seed: 3 }), 0, 0, 48, 48);
			b.classList.toggle('on', b.dataset.id === this.look.texture);
		}
	}

	#roll() {
		this.stage.clear();
		const v = (n) => 1 + Math.floor(Math.random() * n);
		this.stage.roll([{ faces: 10, value: v(10) }, { faces: 8, value: v(8) }, { faces: 20, value: v(20) }], { appearance: this.look });
	}

	static #onPreset(event, target) {
		this.look = appearanceOf({ preset: target.dataset.id });
		this.render();
	}

	static #onTexture(event, target) {
		this.look.texture = target.dataset.id;
		this.#thumbs();
		this.#roll();
	}

	static #onReroll() {
		this.#roll();
	}

	static #onScreen() {
		game.modules.get(MODULE_ID).api.test(this.look);
	}

	static async #onSave() {
		const base = appearanceOf({ preset: this.look.preset });
		// store only what differs from the preset, so a preset tweak later still reaches unchanged parts
		const diff = { preset: this.look.preset };
		for (const [k, v] of Object.entries(this.look)) if (k !== 'preset' && base[k] !== v) diff[k] = v;
		await game.user.setFlag(MODULE_ID, 'appearance', diff);
		ui.notifications.info('Your dice are saved. Everyone will see them this way.');
		this.close();
	}

	_onClose(options) {
		this.stage?.clear();
		return super._onClose?.(options);
	}
}
