## ascii-sky

A painted blue sky in ASCII on a canvas. Clouds drift on the wind, the
pointer stirs the air, and a click sends a gust. It is the sky at the top
of [unvalley.me](https://unvalley.me). MIT

https://github.com/user-attachments/assets/b6954efa-1118-4c32-b5b6-e8f6eaaf9829

Day, Sunset (Vice City Inspired) and Night.

### Run it:

```bash
pnpm install
pnpm dev
```

```ts
const sky = mountSky(canvas, { theme: "auto" }); // "light", "sunset", "dark" or "auto"
```

For React there is `<AsciiSky />` in `src/react.tsx`. To make a sky from
your own picture, see [scripts/README.md](scripts/README.md).

### Acknowledgements:

this work inspired by

- Dao's koi fish: https://www.daoho.dev/
- stacked's shark: https://github.com/stackedlol/ascii-sharks
- Alex Harri's [ASCII rendering](https://alexharri.com/blog/ascii-rendering), which the cloud edges are drawn after
