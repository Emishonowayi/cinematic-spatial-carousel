import { useState, useEffect, useLayoutEffect, useRef, useCallback } from "react";

const PANEL_W = 680;
const PANEL_H = 405;

export const REFLECTION_DEFAULTS = {
  blur:          6,
  opacity:       0.50,
  skew:          60,   // rotateX degrees — floor perspective tilt
  offsetY:       7,    // px offset from the card's bottom edge
  gradientStart: 20,   // % from top where darkening begins
  gradientEnd:   80,   // % from top where full darkness is reached
  gradientDark:  1.00, // peak black opacity at darkest point
  fadeOutMs:     400,  // ms — how fast reflection disappears on nav
  fadeInMs:      900,  // ms — how fast reflection reappears after nav
  restoreMs:     850,  // ms — delay before reflection fades back in (button/key nav)
  restoreDragMs: 450,  // ms — same delay but for drag nav
};

// Canvas mirror of the centre Panel's <video>. Every animation frame we copy
// the current video frame onto the canvas via drawImage(), so the reflection
// is literally showing the SAME frames as the centre — zero drift, perfect
// sync. Cheaper than two video decoders too.
//
// Canvas bitmap is set to PANEL_W × PANEL_H (the reflection's native size at
// 1× zoom). The reflection is heavily blurred and partially transparent, so
// drawing the source video down to this resolution is imperceptible and
// massively cheaper than full-res 4K → canvas copying every frame.
function ReflectionCanvas({ activeVideoRef, onReady }) {
  const canvasRef = useRef(null);
  // Track which video element we last drew from, so we can detect the
  // mid-stream switch when a new Panel claims activeVideoRef.
  const lastVideoRef = useRef(null);
  // Last value we reported via onReady — drives debouncing so we don't fire
  // the callback every frame, only on actual transitions.
  const lastReportedRef = useRef(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");

    // On mount: signal we're NOT ready yet, so StageReflection waits for the
    // first successful draw before fading in. This handles image→video
    // transitions and fresh mounts correctly.
    lastReportedRef.current = false;
    onReady?.(false);

    let rafId;
    const tick = () => {
      const video = activeVideoRef?.current;

      // Video element switched. Clear stale pixels from the previous video
      // so the reflection doesn't briefly show the old content.
      if (video !== lastVideoRef.current) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        lastVideoRef.current = video;
      }

      // readyState >= 2 = HAVE_CURRENT_DATA: video has decoded the current
      // frame and drawImage will work. Drawing too early throws or paints
      // garbage.
      const canDraw = !!(video && video.readyState >= 2);
      if (canDraw) {
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      }

      // Report readiness transitions. Fires onReady(true) on the first frame
      // we successfully draw the new video, and onReady(false) when the
      // video switches and we briefly can't draw.
      if (canDraw !== lastReportedRef.current) {
        lastReportedRef.current = canDraw;
        onReady?.(canDraw);
      }

      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [activeVideoRef, onReady]);

  return (
    <canvas
      ref={canvasRef}
      width={PANEL_W}
      height={PANEL_H}
      aria-hidden="true"
      style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
    />
  );
}

function ReflectionMedia({ slide, activeVideoRef, onReady }) {
  if (slide.type === "video") {
    return <ReflectionCanvas activeVideoRef={activeVideoRef} onReady={onReady} />;
  }
  return (
    <img
      src={slide.src}
      alt=""
      aria-hidden="true"
      style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
    />
  );
}

/**
 * StageReflection — spatially-anchored floor reflection.
 *
 * Layer structure:
 *  1. Outer container   Full viewport width (left:0 right:0). Carries the
 *                       vertical gradient mask so blur() can bleed freely
 *                       left/right with no frosting at the edges. opacity +
 *                       CSS transition drives the fade in/out.
 *  2. Perspective div   perspective(900px) rotateX(skew deg) — embeds the
 *                       image into the floor plane.
 *  3. Content div       scaleY(-1) + blur(blur px) + opacity — the actual
 *                       mirrored, softened reflection image.
 *
 * Fade behaviour:
 *   visible=false → outer container fades to opacity 0 immediately (on nav
 *                   trigger). displaySlide is held so the outgoing image
 *                   stays visible during fade-out.
 *   visible=true  → displaySlide updates to the new slide, then fades in.
 */
export default function StageReflection({ slide, zoom = 1, config = REFLECTION_DEFAULTS, visible = true, activeVideoRef }) {
  const {
    blur, opacity,
    skew, offsetY,
    gradientStart, gradientEnd, gradientDark,
    fadeOutMs = 700, fadeInMs = 900,
  } = config;

  // displaySlide only updates when visible flips back to true.
  // This keeps the outgoing image stable during the fade-out so the
  // reflection doesn't pop to the new content before the fade completes.
  //
  // useLayoutEffect (not useEffect): runs synchronously before paint, so the
  // slide swap lands in the SAME paint as the opacity fade-in. With useEffect
  // the swap happened one frame after fade-in started, briefly showing the
  // OLD video at the start of the new fade-in.
  const [displaySlide, setDisplaySlide] = useState(slide);
  useLayoutEffect(() => {
    if (visible) setDisplaySlide(slide);
  }, [visible, slide]);

  // mediaReady gates the fade-in until the underlying media is renderable.
  // - Images: instantly ready (set true via the layout effect below)
  // - Videos: driven entirely by ReflectionCanvas. The canvas reports false on
  //   mount and on video-element switches, then true on the first successful
  //   drawImage call. We do NOT reset mediaReady on displaySlide changes here
  //   because by the time displaySlide updates (at 850ms), the canvas has
  //   typically been drawing the new video for ~450ms (claim happens at
  //   400ms via titleIndex). Resetting would lose that head start.
  const [mediaReady, setMediaReady] = useState(displaySlide.type === "image");
  useLayoutEffect(() => {
    if (displaySlide.type === "image") setMediaReady(true);
  }, [displaySlide.type, displaySlide.src]);
  const handleMediaReady = useCallback((ready) => {
    setMediaReady(ready);
  }, []);

  const effectiveVisible = visible && mediaReady;

  const cardHalfH = (PANEL_H / 2) * zoom;
  const reflW     = PANEL_W * zoom;

  // Gradient as a mask on the outer container (left:0 right:0 = full viewport
  // width). The blur() on the reflection can bleed freely in any direction
  // inside this full-width container — nothing clips it horizontally — so
  // there is no hard edge / frosting at the sides. The vertical gradient mask
  // still fades the bottom exactly as intended.
  // gradientDark → mask alpha inverted: dark 1.0 = alpha 0.0 (fully hidden).
  const gradientMask = `linear-gradient(to bottom, black 0%, black ${gradientStart}%, rgba(0,0,0,${(1 - gradientDark).toFixed(2)}) ${gradientEnd}%, rgba(0,0,0,${(1 - gradientDark).toFixed(2)}) 100%)`;

  return (
    <div
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        top: `calc(50% + ${cardHalfH + offsetY}px)`,
        height: 300,
        zIndex: 0,
        pointerEvents: "none",
        WebkitMaskImage: gradientMask,
        maskImage: gradientMask,
        // Asymmetric transitions: quick fade-out (floor disappears cleanly),
        // slow fade-in (reflection drifts in gently once the card is settled).
        // effectiveVisible (not visible) gates the fade-in on the new media
        // being ready, so the reflection never appears showing stale frames.
        opacity: effectiveVisible ? 1 : 0,
        transition: effectiveVisible ? `opacity ${fadeInMs}ms ease` : `opacity ${fadeOutMs}ms ease`,
      }}
    >
      <div
        style={{
          position: "absolute",
          top: 0,
          left: "50%",
          marginLeft: -(reflW / 2),
          width: reflW,
          height: PANEL_H * zoom,
          transformOrigin: "top center",
          transform: `perspective(900px) rotateX(${skew}deg)`,
        }}
      >
        {/* Reflection image — scaleY(-1) flips so card bottom is at top. */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            transform: "scaleY(-1)",
            filter: `blur(${blur}px)`,
            opacity,
          }}
        >
          <ReflectionMedia slide={displaySlide} activeVideoRef={activeVideoRef} onReady={handleMediaReady} />
        </div>
      </div>
    </div>
  );
}
