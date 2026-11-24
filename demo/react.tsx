import { type MouseEvent, StrictMode, useCallback, useState } from "react";
import { createRoot } from "react-dom/client";
import type { SkyTheme } from "../src/index.ts";
import { AsciiSky } from "../src/react.tsx";

const THEMES = ["light", "dark", "vice"] as const;

export function App() {
  const [theme, setTheme] = useState<SkyTheme>("light");
  document.body.dataset.theme = theme;
  const pick = useCallback((event: MouseEvent<HTMLButtonElement>) => {
    setTheme(event.currentTarget.dataset.theme as SkyTheme);
  }, []);
  return (
    <>
      <AsciiSky theme={theme} assets={import.meta.env.BASE_URL} style={{ height: 360 }} />
      <main>
        <h1>ascii-sky in React</h1>
        {THEMES.map((t) => (
          <button key={t} type="button" data-theme={t} aria-pressed={t === theme} onClick={pick}>
            {t}
          </button>
        ))}
      </main>
    </>
  );
}

const root = document.querySelector("#root");
if (root) {
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
