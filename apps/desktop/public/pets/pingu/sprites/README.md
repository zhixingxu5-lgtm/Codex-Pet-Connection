# Pingu animation slots

This directory intentionally contains no final art yet. Add these transparent WebP strips:

- `idle_relaxed.webp`
- `idle_focused.webp`
- `idle_tired.webp`
- `idle_exhausted.webp`
- `running_relaxed.webp`
- `running_focused.webp`
- `running_tired.webp`
- `running_exhausted.webp`
- `needs_input.webp`
- `ready.webp`
- `blocked.webp`
- `offline.webp`

Each strip must be `1536×208`: eight `192×208` frames laid out horizontally. Until all files are
present, production builds keep `VITE_USE_SPRITES` disabled and render the built-in CSS Pingu.
