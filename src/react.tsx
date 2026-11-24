"use client";
/**
 * The sky as a React component: a canvas running the live sky (mount.ts),
 * fading in over the still sky's colours (still.ts) once it is drawn.
 */
import { type CSSProperties, useEffect, useRef, useState } from "react";
import type { ThemeChoice } from "./engine.ts";
import { type MountedSky, type MountOptions, mountSky, SKY_HEIGHT } from "./mount.ts";
import { stillSky } from "./still.ts";

export type AsciiSkyProps = MountOptions & {
  /** Which sky to draw; "auto" follows the visitor's colour scheme. With
   * a theme named, its colours show from the first paint. */
  theme?: ThemeChoice;
  className?: string;
  /** The box's style. It is `position: relative`, as wide as its parent
   * and as tall as the still sky by default. */
  style?: CSSProperties;
};

const FADE = "opacity 700ms";
const fill: CSSProperties = { position: "absolute", inset: 0, width: "100%", height: "100%" };

/**
 * The sky in a box. It takes no pointer events itself (the wind follows
 * the pointer over the whole page) and is hidden from assistive
 * technology.
 */
export function AsciiSky({
  theme = "auto",
  assets,
  faintFrom,
  ignore,
  night,
  className,
  style,
}: AsciiSkyProps) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const sky = useRef<MountedSky | null>(null);
  const [drawn, setDrawn] = useState(false);
  // What it starts with. A new theme goes to setTheme, not a restart, and
  // files given as an object restart it only when a URL changes.
  const latest = useRef({ theme, assets });
  latest.current = { theme, assets };
  const where = typeof assets === "object" ? JSON.stringify(assets) : assets;

  useEffect(() => {
    const element = canvas.current;
    if (!element) return;
    const { theme, assets } = latest.current;
    const mounted = mountSky(element, { theme, assets, faintFrom, ignore, night });
    sky.current = mounted;
    mounted.ready
      .then(() => {
        if (sky.current === mounted) setDrawn(true);
      })
      .catch(() => {});
    return () => {
      mounted.stop();
      sky.current = null;
      setDrawn(false);
    };
  }, [where, faintFrom, ignore, night]);

  useEffect(() => {
    sky.current?.setTheme(theme);
  }, [theme]);

  const still = theme === "auto" ? null : stillSky(theme, assets);
  return (
    <div
      aria-hidden="true"
      className={className}
      style={{
        position: "relative",
        width: "100%",
        height: SKY_HEIGHT,
        overflow: "hidden",
        pointerEvents: "none",
        userSelect: "none",
        ...style,
      }}
    >
      {still && (
        <div style={{ ...fill, ...still, opacity: drawn ? 0 : still.opacity, transition: FADE }} />
      )}
      <canvas
        ref={canvas}
        style={{ ...fill, display: "block", opacity: drawn ? 1 : 0, transition: FADE }}
      />
    </div>
  );
}
