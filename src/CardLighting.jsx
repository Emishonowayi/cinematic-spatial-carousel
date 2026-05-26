import { useEffect, useRef } from "react";
import { useReducedMotion } from "framer-motion";

// Hover fade speed (not exposed — feels right as-is)
const FADE = 0.055;

export const LIGHTING_DEFAULTS = {
  overlayDarkness: 0.15,  // base darkening on active card
  hoverOverlay:    0.50,  // additional darkening when cursor hovers centre card
  lightSize:       170,   // diameter of surface light blob (px)
  lightBlur:       0.50,  // blur as a fraction of lightSize
  lightIntensity:  1.00,  // peak opacity of surface light
  lightInertia:    0.06,  // lerp factor — lower = heavier lag
  rimWidth:        2,     // rim border thickness (px)
  rimPeak:         1.0,   // brightness at the cursor-nearest point (0–1)
  rimSpread:       40,    // % into the gradient where peak starts fading
  rimIntensity:    1.0,   // overall rim opacity
};

// overlayDarkness is intentionally NOT consumed here — it is now applied in
// Panel.jsx as a centerness-driven motion value so it fades smoothly as the
// card moves in and out of the centre position, rather than popping on mount.
export default function CardLighting({ width, height, config = LIGHTING_DEFAULTS }) {
  const {
    lightSize, lightBlur, lightIntensity, lightInertia,
    rimWidth, rimPeak, rimSpread, rimIntensity,
  } = config;
  const prefersReduced = useReducedMotion();

  const surfaceRef = useRef(null);
  const rimRef    = useRef(null);

  // All animation state lives in refs — zero React re-renders per frame
  const posRef     = useRef({ x: width / 2, y: height / 2 });
  const targetRef  = useRef({ x: width / 2, y: height / 2 });
  const hoveredRef = useRef(false);
  const opacityRef = useRef(0);
  const rafRef     = useRef(null);

  useEffect(() => {
    if (prefersReduced) return;

    const tick = () => {
      posRef.current.x += (targetRef.current.x - posRef.current.x) * lightInertia;
      posRef.current.y += (targetRef.current.y - posRef.current.y) * lightInertia;

      const targetO = hoveredRef.current ? 1 : 0;
      opacityRef.current += (targetO - opacityRef.current) * FADE;
      const o = opacityRef.current;

      const { x, y } = posRef.current;

      if (surfaceRef.current) {
        const half = lightSize / 2;
        surfaceRef.current.style.transform = `translate3d(${x - half}px, ${y - half}px, 0)`;
        surfaceRef.current.style.opacity   = (lightIntensity * o).toFixed(3);
      }

      if (rimRef.current) {
        const cx = ((x / width)  * 100).toFixed(1);
        const cy = ((y / height) * 100).toFixed(1);
        rimRef.current.style.background =
          `radial-gradient(circle at ${cx}% ${cy}%, ` +
          `rgba(255,255,255,${rimPeak}) 0%, ` +
          `rgba(255,255,255,${(rimPeak * 0.18).toFixed(2)}) ${rimSpread}%, ` +
          `transparent ${Math.round(rimSpread * 1.6)}%)`;
        rimRef.current.style.opacity = (rimIntensity * o).toFixed(3);
      }

      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [prefersReduced, width, height, lightInertia, lightSize, lightIntensity, rimPeak, rimSpread, rimIntensity]);

  // Mouse event handlers — pure mouse events, do not interfere with
  // the pointer-event drag system on the panels-container.
  //
  // getBoundingClientRect returns the POST-transform rect, but the light
  // blob's translate is applied INSIDE the scaled container — so we must
  // convert the cursor offset from screen pixels back to the panel's native
  // coordinate space (PANEL_W × PANEL_H). Otherwise the blob drifts to the
  // side of the cursor by exactly the scale factor.
  const projectCursor = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    const sx = r.width  / width;
    const sy = r.height / height;
    return {
      x: (e.clientX - r.left) / sx,
      y: (e.clientY - r.top)  / sy,
    };
  };

  const onMouseEnter = (e) => {
    hoveredRef.current = true;
    targetRef.current = projectCursor(e);
  };

  const onMouseMove = (e) => {
    targetRef.current = projectCursor(e);
  };

  const onMouseLeave = () => {
    hoveredRef.current = false;
  };

  return (
    <>
      {/* ── 1. Surface lighting ─────────────────────────────────────
          Large blurred circle; clipped by overflow:hidden to the card.
          Follows cursor with inertia. mix-blend-mode:screen brightens
          the image rather than overlaying a tint.
          zIndex 6 puts it above the hover overlay (zIndex 4) so the
          screen-blend backdrop isn't the darkened overlay — at full
          intensity it reads as pure white instead of muddy grey. */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          overflow: "hidden",
          pointerEvents: "none",
          zIndex: 6,
        }}
      >
        <div
          ref={surfaceRef}
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: lightSize,
            height: lightSize,
            borderRadius: "50%",
            background: "#ffffff",
            filter: `blur(${Math.round(lightSize * lightBlur)}px)`,
            mixBlendMode: "screen",
            willChange: "transform, opacity",
            opacity: 0,
          }}
        />
      </div>

      {/* ── 3. Rim lighting ─────────────────────────────────────────
          Gradient border that brightens the edge nearest to the cursor.
          The "destination-out" mask technique shows the radial gradient
          only in the 2px padding zone, creating a reactive rim effect. */}
      <div
        ref={rimRef}
        style={{
          position: "absolute",
          inset: -rimWidth,
          padding: rimWidth,
          // Mask away everything except the padding (border) zone
          WebkitMask:
            "linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)",
          WebkitMaskComposite: "destination-out",
          mask:
            "linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)",
          maskComposite: "exclude",
          pointerEvents: "none",
          // Above hover overlay (zIndex 4) for the same reason as the surface
          // light — keeps the rim glow bright even when hover darkening is on.
          zIndex: 7,
          opacity: 0,
        }}
      />

      {/* ── Mouse capture overlay ───────────────────────────────────
          Transparent, on top. pointer-events:auto so it receives mouse
          events. Pointer events (drag) still bubble through to the
          panels-container above in the tree and are unaffected. */}
      <div
        onMouseEnter={onMouseEnter}
        onMouseMove={onMouseMove}
        onMouseLeave={onMouseLeave}
        style={{
          position: "absolute",
          inset: 0,
          pointerEvents: "auto",
          zIndex: 3,
        }}
      />
    </>
  );
}
