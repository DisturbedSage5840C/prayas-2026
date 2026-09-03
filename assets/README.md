# Assets

## The backdrop ground

The live backdrop is **not** a tiled image. The emblems sit on a polar lattice
centred on the dancer — rings ~108px apart, ~150px of arc between neighbours,
alternate rings offset half a step, each emblem leaning toward its own radius.
That geometry has to be laid out, so `buildWeave()` in `js/prayas.js` builds it
at boot and on resize. Retune it through `CONFIG.weave` there, not here.

## `bg-scatter.webp` — the no-JS fallback only

A 516×516 seamless tile holding sixteen small copies of `bg-motif.webp`,
Poisson-spaced on the torus so it repeats with no seam and no visible lattice.
It is what `html:not(.js)` falls back to: the same texture as the polar field,
though not the same layout, so the page is never bare black without scripting.

Regenerate (adjust `TILE`, `COUNT`, and the size range to retune density):

```bash
python3 - <<'PY'
from PIL import Image
import math, random

SRC, TILE, COUNT = 'assets/bg-motif.webp', 516, 16
random.seed(7)
motif = Image.open(SRC).convert('RGBA')

# Lay out on a 3x3 canvas and crop the middle cell, so anything crossing an
# edge is drawn again one tile over and the finished tile wraps seamlessly.
big = Image.new('RGBA', (TILE * 3, TILE * 3), (0, 0, 0, 0))
pts, MIN_D = [], TILE / math.sqrt(COUNT) * 0.72
while len(pts) < COUNT:
    x, y = random.uniform(0, TILE), random.uniform(0, TILE)
    if all(min(abs(x - px), TILE - abs(x - px)) ** 2 +
           min(abs(y - py), TILE - abs(y - py)) ** 2 >= MIN_D * MIN_D
           for (px, py, _, _) in pts):
        pts.append((x, y, random.uniform(26, 38), random.uniform(-28, 28)))

for (x, y, w, rot) in pts:
    h = int(round(w * motif.height / motif.width))
    m = motif.resize((int(round(w)), h), Image.LANCZOS)
    m = m.rotate(rot, resample=Image.BICUBIC, expand=True)
    for gx in range(3):
        for gy in range(3):
            big.alpha_composite(m, (int(x + gx * TILE - m.width / 2),
                                    int(y + gy * TILE - m.height / 2)))

big.crop((TILE, TILE, TILE * 2, TILE * 2)).save(
    'assets/bg-scatter.webp', 'WEBP', lossless=True, quality=100)
PY
```

## Other assets

| File | What it is |
|---|---|
| `bg-motif.webp` | The single gold buta motif. Source art for the scatter tile. |
| `card-frame.webp` | Pattachitra border plate, used via `border-image` on the event cards. |
| `dancer-alpha.webm` / `.mp4` | The scroll-scrubbed dancer plate, key already baked in. See below. |
| `dancer-plate.webp` | Pre-keyed still, used as the plate's `poster`. |
| `dancer-scrub.webm` / `.mp4` | **Source only** — the original green-screen plates. Not shipped to the page. |
| `dancer-poster.jpg` | **Source only** — the original green-screen poster frame. |
| `prayas-logo.svg` | The wordmark. |


## The dancer plate — why the key is baked in

The green screen used to be dropped at render time by an SVG reference filter
(`filter: url(#dancerKey)`) on the `<video>`. That construct is not portable,
and it fails in two different ways that look unrelated:

* **WebKit ignores it.** Safari applies `filter: url(#id)` to an `<img>` or a
  background image quite happily, but on a `<video>` it drops the declaration
  silently — no error, no warning. You get the raw green screen.
* **Chrome on Android renders it black.** The filter forces the video off the
  hardware overlay path and the layer composites to solid black.

So the key is baked into the media, and the page ships no runtime filter.

### Regenerating the plate from the green-screen source

The ffmpeg expression below is the old `#dancerKey` filter, evaluated per pixel
rather than per frame: the RGB rows are the colour grade (with the old
`feFuncG` slope of 0.82 folded into the green row), and the alpha row is the
same greenness key, `a = 1.6 + 2R - 4G + 2B`, scaled to 0-255 (`1.6 * 255 = 408`).

```bash
K="clip(408 + 2*r(X,Y) - 4*g(X,Y) + 2*b(X,Y),0,255)"
R="clip(1.70*r(X,Y) - 0.40*g(X,Y) - 0.30*b(X,Y),0,255)"
G="clip(0.246*r(X,Y) + 0.369*g(X,Y) + 0.0984*b(X,Y),0,255)"
B="clip(0.85*r(X,Y) - 0.15*g(X,Y) + 0.30*b(X,Y),0,255)"

# key once into a lossless RGBA intermediate, then encode twice off that
ffmpeg -y -i assets/dancer-scrub.mp4 \
  -vf "format=rgba,geq=r='$R':g='$G':b='$B':a='$K',split[m][a];\
       [a]alphaextract,gblur=sigma=0.5[al];[m][al]alphamerge" \
  -c:v ffv1 -pix_fmt rgba -an keyed.mkv

# VP9 + alpha  — Chrome, Firefox, Edge, Android Chrome
ffmpeg -y -i keyed.mkv -c:v libvpx-vp9 -pix_fmt yuva420p \
  -b:v 0 -crf 36 -row-mt 1 -cpu-used 2 -an assets/dancer-alpha.webm

# HEVC + alpha — Safari and iOS (needs macOS VideoToolbox to encode)
ffmpeg -y -i keyed.mkv -c:v hevc_videotoolbox -pix_fmt bgra \
  -alpha_quality 0.8 -b:v 1600k -tag:v hvc1 -an assets/dancer-alpha.mp4

# the poster: the frame the engine parks on, 40% through
ffmpeg -y -ss 3.4 -i keyed.mkv -frames:v 1 poster.png
python3 -c "from PIL import Image; \
  Image.open('poster.png').convert('RGBA').save('assets/dancer-plate.webp','WEBP',quality=86,method=6)"
```

`gblur=sigma=0.5` on the alpha plane alone stands in for the old
`feGaussianBlur` + `feComposite operator="in"` pair, which existed to
antialias the key edge and did nothing else — the source is fully opaque, so
compositing the blurred result back "in" the original was a no-op on colour.

### Why two encodes, and why the page probes for one

Alpha support cannot be negotiated by MIME type, so a `<source>` list does not
work here. Both engines claim they can play the format they then treat
differently:

| | `video/webm; codecs=vp9` | `video/mp4; codecs=hvc1` |
|---|---|---|
| Safari 18.6 | `"probably"` — **alpha discarded** | `"probably"` — alpha honoured |
| Chrome 151 | `"probably"` — alpha honoured | `""` |

Handing Safari the WebM therefore produces an opaque plate with no error to
catch. `selectPlateSource()` in `js/prayas.js` decodes a 625-byte inline probe
clip whose right half is fully transparent, reads the alpha back off a canvas,
and picks the source that actually composites. Until it answers — and
permanently, if neither source works or scripting is off — the `poster` holds
the pre-keyed still, so the plate is correct on first paint rather than
eventually.
