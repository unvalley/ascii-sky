import {
  type MouseEvent,
  type ReactElement,
  StrictMode,
  useCallback,
  useLayoutEffect,
  useState,
} from "react";
import { createRoot } from "react-dom/client";
import type { SkyTheme } from "../src/index.ts";
import { AsciiSky } from "../src/react.tsx";

const THEMES = ["light", "sunset", "dark"] as const;

export const App = (): ReactElement => {
  const [theme, setTheme] = useState<SkyTheme>("light");
  useLayoutEffect(() => {
    document.body.dataset.theme = theme;
  }, [theme]);
  const pick = useCallback((event: MouseEvent<HTMLButtonElement>) => {
    const wanted = event.currentTarget.dataset.theme;
    const picked = THEMES.find((t) => t === wanted);
    if (picked !== undefined) {
      setTheme(picked);
    }
  }, []);
  return (
    <>
      <AsciiSky assets={import.meta.env.BASE_URL} style={{ height: 360 }} theme={theme} />
      <main>
        <h1>ascii-sky in React</h1>
        {THEMES.map((t) => (
          <button aria-pressed={t === theme} data-theme={t} key={t} onClick={pick} type="button">
            {t}
          </button>
        ))}
      </main>
    </>
  );
};

const root = document.querySelector("#root");
if (root) {
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
