"use client";
import { type CSSProperties, useEffect, useRef, useState } from "react";
import { type MountedSky, type MountOptions, mountSky, SKY_HEIGHT, stillSky } from "./index.ts";

export type AsciiSkyProps = MountOptions & {
  className?: string;
  style?: CSSProperties;
};

const FADE = "opacity 700ms";
const fill: CSSProperties = { position: "absolute", inset: 0, width: "100%", height: "100%" };

export const AsciiSky = ({
  theme = "auto",
  assets,
  faintFrom,
  ignore,
  night,
  className,
  style,
}: AsciiSkyProps) => {
  const canvas = useRef<HTMLCanvasElement>(null);
  const sky = useRef<MountedSky | null>(null);
  const [drawn, setDrawn] = useState(false);
  const themeNow = useRef(theme);

  useEffect(() => {
    const element = canvas.current;
    if (!element) {
      return;
    }
    const mounted = mountSky(element, {
      theme: themeNow.current,
      assets,
      faintFrom,
      ignore,
      night,
    });
    sky.current = mounted;
    mounted.ready
      .then(() => {
        if (sky.current === mounted) {
          setDrawn(true);
        }
      })
      .catch(() => undefined);
    return () => {
      mounted.stop();
      sky.current = null;
      setDrawn(false);
    };
  }, [assets, faintFrom, ignore, night]);

  useEffect(() => {
    themeNow.current = theme;
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
      {still ? (
        <div style={{ ...fill, ...still, opacity: drawn ? 0 : still.opacity, transition: FADE }} />
      ) : null}
      <canvas
        ref={canvas}
        style={{ ...fill, display: "block", opacity: drawn ? 1 : 0, transition: FADE }}
      />
    </div>
  );
};
