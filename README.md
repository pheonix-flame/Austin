# Austin Okezie — Portfolio

Personal portfolio for a Software Engineer (AppSecOps). It has a 3D hero, project notes, experience,
credentials and a **Have fun & explore** section with six browser games, each with a “How it’s built” panel.

| Page | What it is |
| --- | --- |
| `games/arena.html` | **Faceoff**: peer-to-peer multiplayer FPS (2–8 players). Room codes for friends on the same wifi, serverless quick match, practice vs bots; sniper/AR/SMG/shotgun, ammo pickups, health regen, first to 10/20/30. |
| `games/alien.html` | **Xeno Siege**: first-person alien survival. Endless waves, five animal-like alien types plus a boss, levels and perks, shop, cover, touch and gyro controls. |
| `games/warehouse.html` | **Floor Forward**: 3D warehouse simulation. Fix bottlenecks, handle anomalies on the floor, modernise without layoffs. |
| `games/quant.html` | **Market Lab**: live Deriv data or simulation for V75, V100, Step Index, EURUSD, GBPUSD, USDJPY, AUDUSD, XAUUSD, BTCUSD and ETHUSD. Monitor, backtest, risk & options (GARCH, Monte Carlo VaR/ES, Black–Scholes), or take the skill-or-luck challenge. |
| `games/marketmaker.html` | **Market Maker**: quote against noise and informed flow, manage inventory, beat an Avellaneda–Stoikov bot; markout analytics. |
| `games/quantgym.html` | **Quant Gym**: Kelly criterion, Bayesian estimation and a mental-math sprint. |

## Adding or editing projects

Open **`js/content.js`**. Every card in *Selected work* and every row in *Community development*
comes from the two lists in that file. To add a project, copy an existing `{ ... }` block,
change the text and save. Optional fields such as `status: 'Coming soon'` and `link` are documented
at the top of the file.

## Live market data

Market Lab uses Deriv's public WebSocket API, which needs no account for prices.
It uses Deriv's public test `app_id` (1089) by default. For production, register your own app at
https://api.deriv.com/ and set `DERIV_APP_ID` in `js/market/data.js`. If the connection fails, or a
market is closed (forex and gold at weekends), the page says so and either shows the last available
data or switches to a simulator calibrated to the instrument's typical volatility.

## Install as an app (PWA)

The site is a Progressive Web App. Visitors can install it from the browser menu, or with the
**Install app** button in the navigation where the browser supports it, and it then works offline.
`sw.js` precaches the site. Bump `VERSION` in `sw.js` when you deploy changes so returning
visitors get the new files straight away.

## Game controls

Both shooters have a **Controls** button in the top bar. On computers it rebinds every key. On
phones it lets players drag the on-screen buttons (and the movement stick) anywhere, and resize each
button on its own or all of them together. Settings are saved per device.

There are three ways to shoot:

| Input | Phone | Mouse | Key (default) |
| --- | --- | --- | --- |
| Hip fire (never aims) | **Hip fire** | — | `H` |
| Aim only | **Aim** | right click | `Z` |
| Aim + fire (aims while held) | **Aim + fire** | middle click | `V` |
| Fire (aimed if you are aiming) | — | left click | `F` |

On-screen messages (pickups, warnings, tips) can be set to all, important only or off, moved to the
top, middle or bottom, resized and shown for longer or shorter, from the pause menu or the Controls
panel. A repeated message such as "out of ammo" is shown once, not every shot. The code is in `js/notify.js`.

## Multiplayer (Faceoff)

Faceoff is peer-to-peer: the host's browser runs the match and other players connect to it over
WebRTC. A signalling server is only needed for the initial handshake. By default it uses the free
public PeerJS server, so there is nothing to deploy. To use your own, for example on a LAN with no
internet, run a PeerServer and add `?signal=host:port` to the game URL:

```bash
npx peer --port 9000
```

```
games/arena.html?signal=192.168.1.20:9000
```

Maps live in `js/arena/maps.js`: add an entry and it appears in the map picker.

## Stack

Plain HTML, CSS and JavaScript modules, with no build step. three.js r160 is vendored in `vendor/`.

```
index.html            portfolio page
js/content.js         ← your projects (edit me)
js/builds.js          ← “How it’s built” text for each game (edit me)
js/about.js           in-game “How it’s built” panel
js/marketmaker.js     Market Maker
js/arena/             Faceoff (maps.js, weapons.js, net.js, world.js, avatar.js, game.js)
js/gyro.js            shared gyro aiming + settings panel
js/controls.js        rebindable keys + phone button layout editor
js/notify.js          on-screen messages and their settings
js/stance.js          crouch / prone / slide
js/aim.js, js/sens.js aim mode and hip/aimed sensitivity
sw.js, manifest.webmanifest, js/pwa.js   installable offline app
js/main.js            hero scene, reveals, card tilt, game previews
js/siege.js           Xeno Siege
js/warehouse.js       Floor Forward
js/market/            Market Lab (data.js, math.js, app.js)
js/quantgym.js        Quant Gym
css/                  styles per page
vendor/               three.js and PeerJS (MIT)
```

## Run locally

ES modules must be served over HTTP:

```bash
python3 -m http.server 8000
```

Then open http://localhost:8000.

## Deploy

It is a static site, so any static host works.

- **Vercel**: import the repo, framework preset "Other", no build command, output directory `.`.
- **GitHub Pages**: Settings → Pages → deploy from branch, root folder.
- **Netlify**: connect the repo with no build command.
