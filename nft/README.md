# Teia OBJKT — Interactive Painting

Based on the [Teia html-p5js template](https://github.com/teia-community/teia-templates/tree/main/html-p5js-template).

## Mint

Zip the contents of this folder (not the folder itself):

- `index.html`
- `script.js`
- `style.css`
- `p5.min.js`
- `thumbnail.png`
- `assets/source-painting.png`

Requirements from Teia:

1. Entry file must be named `index.html`
2. Include a thumbnail (`thumbnail.png`) referenced in `index.html` via `og:image`
3. All dependencies must be bundled locally (no CDN or external API calls)
4. Canvas uses `windowWidth` / `windowHeight` with `windowResized()`

## Interaction

| Key | Action |
|-----|--------|
| W/S | Up/down drift |
| Q/E | Rotate |
| A/D | Tilt smudge |
| R | Reset |
| B | Debug overlay (dev) |

- **At rest** — subtle wave on load
- **Keyboard** — direct control after keypress
- **Auto** — gentle wave after 30s without keys

## Teia wallet params

After mint, Teia injects URL params (not available locally):

```js
const creator = new URLSearchParams(window.location.search).get("creator");
const viewer = new URLSearchParams(window.location.search).get("viewer");
```
