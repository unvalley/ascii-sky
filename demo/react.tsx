// The React component on a page of its own: `pnpm dev`, then /react.html.
import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import type { SkyTheme } from "../src/index.ts";
import { AsciiSky } from "../src/react.tsx";

function App() {
  const [theme, setTheme] = useState<SkyTheme>("light");
  document.body.dataset.theme = theme;
  return (
    <>
      <AsciiSky theme={theme} assets={import.meta.env.BASE_URL} style={{ height: 360 }} />
      <main>
        <h1>ascii-sky in React</h1>
        {(["light", "dark", "vice"] as const).map((t) => (
          <button key={t} type="button" aria-pressed={t === theme} onClick={() => setTheme(t)}>
            {t}
          </button>
        ))}
      </main>
    </>
  );
}

const root = document.getElementById("root");
if (root)
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
