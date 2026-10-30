# Fabula Ultima Dice

JRPG dice for Foundry VTT v13. Every roll posted to chat is thrown across the screen as real 3D dice: they tumble, bounce off each other and roll to a stop with the result on top, leaving a trail and a landing effect. Pixel-art or smooth, and every player picks their own.

![3D dice: pixel Esper and 8-bit dice next to smooth Materia, Storybook, Eikon and Vana'diel dice](docs/3d.png)

| | |
|---|---|
| ![3D pixel dice](docs/pixel.png) | ![2D smooth dice with textures and pop-up numbers](docs/smooth.png) |
| Pixel dice: outlined, three light bands, the number upright in a pixel font | The lighter 2D dice, with textures and pop-up numbers |

## Install
In Foundry: **Add-on Modules → Install Module**, paste this Manifest URL and click Install:
`https://github.com/EclipseGS27/fu-dice/releases/latest/download/module.json`

Then enable **Fabula Ultima Dice** in your world. It works with any system; with Project FU, criticals and fumbles get their own flourish. It needs no other module and no downloads: the dice, effects and sounds are all drawn and synthesized in code.

## Your dice
Settings → **Choose your dice** opens a window with every preset on the left and a live preview on the right. Pick a preset, then change any part of it; **Roll again** replays the preview, **On screen** throws them across your screen. Save, and everyone sees your rolls in your dice.

![Choosing your dice](docs/config.png)

- **Style**: pixel art (low resolution, hard light bands, a dark outline, numbers in a 5x7 pixel font) or smooth (anti-aliased, with shading and glow).
- **Material**: gem, glass, metal or flat.
- **Surface**: plain, marble, wood, stone, brushed metal, crystal, nebula, starfield, runes, scales, magma, circuit or stripes, each shown as a swatch in your colors. A pattern color and a strength slider tune it. Pixel dice get a flat-toned version of each, with no noise.
- **Colors**: body, pattern, edges, numbers and glow.
- **Trail**: sparkles, stars, flames, embers, ice shards, floating motes, feathers, crystal shards or none.
- **Landing**: a ring, a burst, a flash or nothing.
- **Sounds**: chimes, crystal, wooden clack, 8-bit or silent.
- **Motion**:
  - **Throw**: toss, drop from above, slam, roll along the table, or summon (the dice appear in place).
  - **From**: bottom right, bottom left, bottom, top or anywhere.
  - **On landing**: pop, glow, hop or just stop.
  - **Leaving**: fade, shrink, sink, float away or burst into sparks.
  - **Pop-up number**: none, one over each die, or the total over the throw.

### Presets
Battle UI (navy glass and gold, to match Fabula Ultima Battle UI), 8-bit, Ember pixel, and one for every Final Fantasy from VI to XVI: Esper (VI, runes), Materia (VII, nebula), Gunblade (VIII, brushed steel), Storybook (IX, marble), Pyrefly (X, nebula), Vana'diel (XI, stone), Ivalice (XII, runes), Crystal (XIII, crystal), Aether (XIV, marble), Royal Arms (XV, crystal) and Eikon (XVI, magma, slammed down and bursting away). Each comes with its own surface and some with their own motion. They take each era's mood and colors; nothing is copied from the games.

## How it plays
- **Real 3D dice**: d4, d6, d8, d10, d12 and d20 as true polyhedra (d100 as a tens and a units d10), thrown with real physics. Each throw is worked out the moment it starts, and the numbers are laid on the dice so the face that lands on top is the actual result: what you see always matches the chat card. Pixel dice follow how 3D pixel art is usually made. They are rendered at low resolution with three hard light bands and flat-toned textures, scaled up by whole pixels with no smoothing, and given a one-pixel dark outline and a hard shadow. Their numbers aren't painted on the faces, where a turned, shrunken bitmap number can't be read. Instead, the number on top is drawn upright over the die in a 5x7 pixel font with an outline, on the same pixel grid.
- **2D dice** (setting): flat dice that bounce and tumble on a 2D canvas, for older computers. Without WebGL the module uses them on its own.
- **Every roll in chat**: the dice of each roll fly in (from the side you chose) and land in the middle of the screen. Big rolls show up to a set number of dice; the chat card still has every result.
- **The card waits**: a roll's chat card appears once its dice have landed, so the result isn't spoiled (setting; never more than a few seconds).
- **Each player's own dice**: rolls show in the dice their roller chose (setting: or always yours).
- **Rolls you may not see**: a blind or private roll you can't read still throws its dice, with "?" on them. Rolls whispered to others don't show.
- **Project FU**: a critical success flashes CRITICAL! with a burst of stars and a fanfare; a fumble shows FUMBLE.
- **Light on the computer**: one canvas that only draws while dice are moving and hides when they're gone; the physics of a throw is worked out once, up front. Lighter effects turns off trails, dust and landing effects; 2D dice are lighter still.
- **Dice So Nice**: when it is on, this module steps aside (world setting).

## Settings
Client (each player for themselves): 3D or 2D dice, show dice, whose rolls (everyone's, only mine, none), each player's own dice, wait for the dice, dice size, dice speed, dice volume (times Foundry's interface volume), most dice per roll, lighter effects. World: step aside for Dice So Nice.

## For macros
`game.modules.get('fu-dice').api.roll([{ faces: 20, value: 17 }])` throws dice on your screen; `.test()` throws a demo pair; `.config()` opens the dice window.

## Credits
- 3D: three.js (MIT, © three.js authors) and cannon-es (MIT, © cannon.js authors), included in `lib/` with their licenses.
- Font: Antonio, SIL Open Font License (see `fonts/`).
