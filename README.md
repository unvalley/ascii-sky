# ascii-sky

A painted blue sky in ASCII on a canvas. Clouds drift on the wind, the
pointer stirs the air, and a click sends a gust. It is the sky at the top
of [unvalley.me](https://unvalley.me). MIT

<table>
  <tr>
    <th>Day</th>
    <th>Night</th>
    <th>Sunset (GTA VI Edition)</th>
  </tr>
  <tr>
    <td><video src="https://github.com/user-attachments/assets/959c4c90-5f88-4a15-8584-d9ea4a2e3e4b" muted autoplay loop playsinline></video></td>
    <td><video src="https://github.com/user-attachments/assets/4b2b050f-6b74-4f6d-97ad-0fdeaa62f988" muted autoplay loop playsinline></video></td>
    <td><video src="https://github.com/user-attachments/assets/c6bbcfc6-2a8a-44fe-8678-97ce13690d51" muted autoplay loop playsinline></video></td>
  </tr>
</table>

## Run it

```bash
pnpm install
pnpm dev
```

```ts
const sky = mountSky(canvas, { theme: "auto" }); // "light", "dark", "vice" (GTA VI) or "auto"
```

For React there is `<AsciiSky />` in `src/react.tsx`. To make a sky from
your own picture, see [scripts/README.md](scripts/README.md).

## Acknowledgements

- Dao's koi fish: https://www.daoho.dev/
- stacked's shark: https://github.com/stackedlol/ascii-sharks
- Alex Harri's [ASCII rendering](https://alexharri.com/blog/ascii-rendering), which the cloud edges are drawn after
