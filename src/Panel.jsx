import { useRef, useState, useEffect, useLayoutEffect, useMemo } from "react";
import { motion, useTransform, useReducedMotion, useMotionValueEvent, useMotionValue } from "framer-motion";
import { PANEL_STATES, getStateKey, VW_TO_PX } from "./panelStates";
import CardLighting from "./CardLighting";

const PANEL_W = 680;
const PANEL_H = 405;

// Parallax — media moves slower than the frame, so it appears recessed inside
// the card and gives a 3D depth cue during transitions.
//   parallaxPx: max horizontal drift (px) the media lags by at dragOffset = ±1
//   scale     : scale-up applied to the media so the frame's overflow: hidden
//               never reveals empty edges. Must satisfy
//               PANEL_W * (scale - 1) / 2 ≥ parallaxPx, with a little slack.
export const PARALLAX_DEFAULTS = {
  parallaxPx: 190,
  scale:      1.40,
  curve:      "sin",  // "sin" → piecewise-sin curve, lag eases back to 0 at
                      //         endpoints (no snap). Uses `peak`.
                      // "linear" → lag = v * parallaxPx. Snaps back at the
                      //            end of the transition. Original feel.
  peak:       0.5,    // 0–1: where the parallax lag is at maximum during a
                      // transition (sin mode only). 0.5 = symmetric.
};

// Linear interpolation between two segment endpoints
function lerp(a, b, t) {
  return a + (b - a) * t;
}

// Apply tweakOverrides to a raw PANEL_STATES entry
function applyOverrides(state, stateKey, overrides) {
  if (!overrides || stateKey === "CENTER") return state;
  const t = overrides[stateKey];
  if (!t) return state;
  return {
    ...state,
    x: `${t.xVw}vw`,
    rotateY: t.rotateY,
    scale: t.scale,
    opacity: t.opacity,
    blur: t.blur,
    brightness: t.brightness,
  };
}

// Extract the numeric vw value from an "Nvw" string
const xVwNum = (state) => parseFloat(state.x);

function Media({ slide, onLoad, shouldPlay, videoRef, onAspectKnown }) {
  // Drive play/pause from the shouldPlay prop. We deliberately do NOT set the
  // autoPlay attribute — controlling playback via the ref is the single source
  // of truth and avoids a brief "autoplay then pause" flash for side cards.
  // Browsers permit muted videos to be played programmatically without user
  // interaction, so .play() resolves cleanly.
  useEffect(() => {
    if (slide.type !== "video") return;
    const v = videoRef.current;
    if (!v) return;
    if (shouldPlay) {
      const p = v.play();
      if (p && typeof p.catch === "function") p.catch(() => {}); // ignore autoplay-blocked rejection
    } else {
      v.pause();
    }
  }, [shouldPlay, slide.type, slide.src]);

  // objectFit is ALWAYS "cover". For fullscreen, we don't switch fit — instead
  // the Panel's scaleX and scaleY adjust so the panel itself takes on the
  // video's natural aspect ratio. Cover then fills the panel exactly with no
  // crop, no snap, and a smooth interpolation as the panel reshapes.
  const handleVideoMetadata = (e) => {
    const v = e.currentTarget;
    if (v && v.videoWidth && v.videoHeight && onAspectKnown) {
      onAspectKnown(v.videoWidth / v.videoHeight);
    }
  };
  const handleImgLoad = (e) => {
    if (onLoad) onLoad(e);
    const img = e.currentTarget;
    if (img && img.naturalWidth && img.naturalHeight && onAspectKnown) {
      onAspectKnown(img.naturalWidth / img.naturalHeight);
    }
  };
  if (slide.type === "video") {
    return (
      <video
        ref={videoRef}
        src={slide.src}
        poster={slide.poster}
        muted
        loop
        playsInline
        preload="auto"
        onCanPlay={onLoad}
        onLoadedMetadata={handleVideoMetadata}
        style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
      />
    );
  }
  return (
    <img
      src={slide.src}
      alt={slide.title}
      onLoad={handleImgLoad}
      style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
    />
  );
}

export default function Panel({ offset, slide, tweakOverrides, lightingConfig, dragOffset, zoom = 1, isSettlingRef, activeVideoRef, activeSlideId, parallaxConfig = PARALLAX_DEFAULTS, fullscreenMotion, mediaScaleProgress, fullscreenScale = 2, isFullscreen, isVisuallyFullscreen, onEnterFullscreen, onVideoReady, introMotion }) {
  const [loaded, setLoaded] = useState(false);
  // Fire onVideoReady exactly once when the first canplay/load event arrives
  // for one of the 3 initially visible cards (|offset| <= 1).
  const hasReportedReadyRef = useRef(false);
  const [isHovered, setIsHovered] = useState(false);
  const panelRef = useRef(null);
  const videoRef = useRef(null);
  const prefersReduced = useReducedMotion();
  const isCenter = offset === 0;

  // The media's natural aspect ratio (videoWidth / videoHeight, or
  // naturalWidth / naturalHeight for images). Drives non-uniform fullscreen
  // scaling so the panel's aspect becomes the video's, eliminating the need
  // to switch objectFit and removing the snap that produced when contain →
  // cover flipped at the end of the exit transition.
  // Defaults to the panel's own aspect (uniform scaling) until we learn the
  // real value from onLoadedMetadata.
  const [mediaAspect, setMediaAspect] = useState(PANEL_W / PANEL_H);
  const mediaAspectRef = useRef(mediaAspect);
  mediaAspectRef.current = mediaAspect;

  // Claim activeVideoRef whenever this Panel's slide matches the active slide
  // (driven by titleIndex, which changes at 400ms — long before activeIndex /
  // offset changes at ~1000ms). This early handoff gives the reflection's
  // canvas ~450ms to start drawing the new video, so by the time the
  // reflection's fade-in begins at 850ms, the new video is already on screen.
  // We only WRITE (never null out) so off-centre Panels can't race with the
  // new centre's claim — order of useEffect fire across siblings isn't
  // guaranteed.
  useEffect(() => {
    if (!activeVideoRef) return;
    if (slide.id === activeSlideId && slide.type === "video" && videoRef.current) {
      activeVideoRef.current = videoRef.current;
    }
  }, [activeSlideId, slide.id, slide.type, activeVideoRef]);

  // isCenterZone: true when this card is visually close to the centre stage.
  // Derived from dragOffset proximity rather than the `offset === 0` slot check,
  // so the incoming card becomes interactive as soon as it arrives — not after
  // the spring's .then() fires setActiveIndex (which can be ~1s later).
  //
  // Each card "rests" at dragOffset = 0 when it occupies its nominal slot.
  // The incoming card (offset ±1) is at its centre position when
  // dragOffset ≈ ±1. Threshold 0.1 = card is within ~4vw of centre.
  const [isCenterZone, setIsCenterZone] = useState(() => Math.abs(dragOffset.get() - offset) < 0.1);

  // Update on every dragOffset change (handles approach / departure).
  // Skip during the settling window — Carousel sets isSettlingRef.current=true
  // right before flushing the slot reassignment + dragOffset.set(0). During
  // that window our offset closure is stale (it's the OLD slot offset), so
  // updating isCenterZone here would briefly compute the wrong value and
  // unmount/remount CardLighting (which resets its internal animation state).
  // useLayoutEffect below handles the post-reassignment correction with the
  // fresh offset prop.
  useMotionValueEvent(dragOffset, "change", (v) => {
    if (isSettlingRef?.current) return;
    setIsCenterZone(Math.abs(v - offset) < 0.1);
  });

  // Re-evaluate when the offset prop changes (slot reassignment after
  // setActiveIndex fires). At that point dragOffset is already at its new
  // value and won't emit another "change" event, so we read it directly.
  // useLayoutEffect (not useEffect) so this correction runs before the browser
  // paints — prevents a one-frame blink where isCenterZone is briefly false.
  useLayoutEffect(() => {
    setIsCenterZone(Math.abs(dragOffset.get() - offset) < 0.1);
  }, [offset, dragOffset]);

  // Sync hover state with isCenterZone transitions.
  // When leaving: clear hover so overlays don't get stuck.
  // When entering: if the cursor is already over the element (cursor never
  // moved while the card was flying in), restore hover immediately — no need
  // to move the mouse out and back in.
  useEffect(() => {
    if (!isCenterZone) {
      setIsHovered(false);
    } else if (panelRef.current?.matches(":hover")) {
      setIsHovered(true);
    }
  }, [isCenterZone]);

  // Compute the three anchor states for this slot
  const neutralKey  = getStateKey(offset);
  const forwardKey  = getStateKey(offset - 1); // what this slot looks like when dragOffset = +1
  const backwardKey = getStateKey(offset + 1); // what this slot looks like when dragOffset = −1

  // Keep current state values + live config in a ref so useTransform functions
  // always read the latest values without recreating motion values.
  const stateRef = useRef(null);

  // Compute states and update ref every render
  const stateNeutral  = applyOverrides(PANEL_STATES[neutralKey],  neutralKey,  tweakOverrides);
  const stateForward  = applyOverrides(PANEL_STATES[forwardKey],  forwardKey,  tweakOverrides);
  const stateBackward = applyOverrides(PANEL_STATES[backwardKey], backwardKey, tweakOverrides);
  stateRef.current = {
    stateNeutral, stateForward, stateBackward,
    overlayDarkness: lightingConfig?.overlayDarkness ?? 0.32,
  };

  // Darkening overlay opacity — driven by how close this card is to centre.
  // centerness = 1 when perfectly centred, 0 when fully in an adjacent slot.
  // Formula: max(0, 1 − |dragOffset − offset|) — works for offsets ±1 and 0;
  // for |offset| ≥ 2, the card is never near centre so this is always 0.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const overlayOpacity = useTransform(
    fullscreenMotion ? [dragOffset, fullscreenMotion] : [dragOffset],
    ([v, fs = 0]) => {
      const centerness = Math.max(0, 1 - Math.abs(v - offset));
      // In fullscreen the centre card should not be dimmed — video plays clean.
      return centerness * stateRef.current.overlayDarkness * (1 - fs);
    }
  );

  // Stable ref to fullscreenScale so useTransform reads the latest value
  // without needing to be recreated on each render.
  const fullscreenScaleRef = useRef(fullscreenScale);
  fullscreenScaleRef.current = fullscreenScale;

  // Stable fallback so introMotion is always a real MotionValue in the
  // useTransform array below — avoids conditional hook issues.
  const _zeroIntro = useMotionValue(0);
  const effectiveIntroMotion = introMotion ?? _zeroIntro;

  // ── useTransform helpers ───────────────────────────────────────────────────
  // All motion values are derived from the single dragOffset value.
  //   dragOffset = 0  → neutral (current slot)
  //   dragOffset = +1 → forward (panel moved one step toward its left neighbour)
  //   dragOffset = −1 → backward (panel moved one step toward its right neighbour)
  //
  // Function form is used so the transformer reads stateRef.current on every
  // invocation — this keeps tweakOverride changes live without recreating
  // motion values.

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const xMotion = useTransform(
    [dragOffset, fullscreenMotion, effectiveIntroMotion],
    ([v, fs = 0, intro = 0]) => {
      const { stateNeutral: sN, stateForward: sF, stateBackward: sB } = stateRef.current;
      const n = xVwNum(sN), f = xVwNum(sF), b = xVwNum(sB);
      const result = v >= 0 ? lerp(n, f, v) : lerp(b, n, v + 1);
      let xPx = result * VW_TO_PX;
      // Fullscreen contribution: side cards push further outward (off-screen)
      // proportional to fs. Centre (offset === 0) gets no push.
      if (fs > 0 && offset !== 0) {
        // 150vw push from each side card — clears even very wide viewports.
        xPx += Math.sign(offset) * 150 * VW_TO_PX * fs;
      }
      // Entrance animation: ±1 cards slide in from off-screen. intro = 1 at
      // page load, springs to 0 once siteReady fires. 800px extra in the
      // pre-zoom coordinate space ensures the card is fully beyond the viewport
      // edge regardless of screen width before the spring releases them.
      if (intro > 0 && Math.abs(offset) === 1) {
        xPx += Math.sign(offset) * 150 * intro;
      }
      return `${xPx.toFixed(3)}px`;
    }
  );

  // Parallax: media drifts in the OPPOSITE direction of the frame's motion.
  // Piecewise-sin curve so the lag PEAKS at v = ±peak (configurable) and
  // returns to 0 at both endpoints (v = 0, ±1). Eliminates the snap a linear
  // model produces when dragOffset resets at .then() — the video eases back
  // to centre as the frame settles, no instant catch-up.
  //
  // peak slider lets you control WHEN the lag is at maximum:
  //   peak = 0.5  → symmetric (default)
  //   peak > 0.5  → lag holds longer, catches up faster at the end
  //   peak < 0.5  → lag catches up earlier in the transition
  //
  // Reads parallaxConfig from a ref so tweak-slider changes stay live without
  // recreating the motion value.
  const parallaxRef = useRef(parallaxConfig);
  parallaxRef.current = parallaxConfig;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const mediaParallaxX = useTransform(dragOffset, (v) => {
    const { parallaxPx, peak, curve } = parallaxRef.current;
    if (curve === "linear") {
      // Linear drift: lag = v * parallaxPx. Snaps back to 0 at .then() when
      // dragOffset is reset — original behaviour.
      return v * parallaxPx;
    }
    // Piecewise-sin curve: lag eases back to 0 at both endpoints.
    const sign = v < 0 ? -1 : 1;
    const av = Math.abs(v);
    // Clamp peak to (0,1) exclusive to avoid div-by-zero
    const p = Math.min(0.99, Math.max(0.01, peak ?? 0.5));
    const t = av <= p ? (av / p) : ((1 - av) / (1 - p));
    return sign * Math.sin(t * Math.PI / 2) * parallaxPx;
  });

  // Media element CSS dimensions — locked to the media's natural aspect at
  // COVER size. The video overshoots the mask in whichever dimension is
  // necessary to maintain its aspect while filling the mask in the other.
  // This gives the cover/cropped carousel look AND room for parallax drift.
  //   vAR > pAR (wider media): height matches mask, width overshoots
  //   vAR < pAR (taller media): width matches mask, height overshoots
  const mediaDims = useMemo(() => {
    const vAR = mediaAspect;
    const pAR = PANEL_W / PANEL_H;
    if (vAR > pAR) {
      return { width: PANEL_H * vAR, height: PANEL_H };
    }
    return { width: PANEL_W, height: PANEL_W / vAR };
  }, [mediaAspect]);

  // The wrapper scale needed in fullscreen to shrink the cover-sized media
  // back to "contain" — i.e. fit within the mask at natural aspect with
  // letterbox/pillarbox. This is the aspect mismatch ratio.
  //   16:9 (1.778) in 1.679 mask → 0.944 (slight horizontal shrink)
  //   4:3  (1.333) in 1.679 mask → 0.794 (slight vertical shrink)
  const fullscreenWrapperTarget = useMemo(() => {
    const vAR = mediaAspect;
    const pAR = PANEL_W / PANEL_H;
    return vAR > pAR ? pAR / vAR : vAR / pAR;
  }, [mediaAspect]);
  const fullscreenWrapperTargetRef = useRef(fullscreenWrapperTarget);
  fullscreenWrapperTargetRef.current = fullscreenWrapperTarget;

  // mediaWrapperScale is defined AFTER scaleMotion below — it depends on
  // both scaleMotion (mask) and mediaScaleProgress (independent media size).

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const rotateYMotion = useTransform(dragOffset, (v) => {
    const { stateNeutral: sN, stateForward: sF, stateBackward: sB } = stateRef.current;
    return v >= 0 ? lerp(sN.rotateY, sF.rotateY, v) : lerp(sB.rotateY, sN.rotateY, v + 1);
  });

  // eslint-disable-next-line react-hooks/exhaustive-deps
  // Uniform panel scale — same in carousel and fullscreen. The mask itself
  // doesn't change aspect; the media element inside handles aspect via its
  // own motion-value-driven dimensions (see videoWidth / videoHeight below).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const scaleMotion = useTransform(
    fullscreenMotion ? [dragOffset, fullscreenMotion] : [dragOffset],
    ([v, fs = 0]) => {
      const { stateNeutral: sN, stateForward: sF, stateBackward: sB } = stateRef.current;
      const base = v >= 0 ? lerp(sN.scale, sF.scale, v) : lerp(sB.scale, sN.scale, v + 1);
      if (fs > 0 && offset === 0) {
        return lerp(base, fullscreenScaleRef.current, fs);
      }
      return base;
    }
  );
  const labelCounterScale = useTransform(scaleMotion, (s) => 1 / s);

  // Parallax wrapper scale — designed so the MEDIA's visual size is governed
  // by mediaScaleProgress (slow spring) INDEPENDENTLY of the mask's panel
  // scaleMotion (fast spring).
  //
  // Math:
  //   video visual size = mediaCSS × wrapper × scaleMotion × effectiveZoom
  //   we want that to equal mediaCSS × someFactor × effectiveZoom
  //   so:    wrapper = someFactor / scaleMotion
  //
  // someFactor interpolates from parallaxConfig.scale (carousel cover with
  // parallax overshoot) to fullscreenScale × aspectRatio (fullscreen contain,
  // video width matches mask width) via mediaScaleProgress.
  //
  // Result: mask grows ahead of media on entry (no late "shrink in height"),
  // and mask shrinks ahead of media on exit (cover crop re-established
  // immediately, no late "stretch up").
  //
  // Non-centre cards: just use the static parallaxConfig.scale — they don't
  // participate in the fullscreen transition.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const mediaWrapperScale = useTransform(
    mediaScaleProgress ? [scaleMotion, mediaScaleProgress] : [scaleMotion],
    ([s, p = 0]) => {
      const carouselFactor = parallaxRef.current.scale;
      if (offset !== 0) return carouselFactor;
      const fullscreenFactor = fullscreenScaleRef.current * fullscreenWrapperTargetRef.current;
      const someFactor = lerp(carouselFactor, fullscreenFactor, mediaScaleProgress ? p : 0);
      return s === 0 ? carouselFactor : someFactor / s;
    }
  );

  // Aspect-locked sizer scale stays at 1 — all the cover→contain math is
  // handled by mediaWrapperScale above. The sizer just provides centered
  // positioning at the cover-sized CSS dimensions.

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const opacityMotion = useTransform(
    [dragOffset, fullscreenMotion, effectiveIntroMotion],
    ([v, fs = 0, intro = 0]) => {
      const { stateNeutral: sN, stateForward: sF, stateBackward: sB } = stateRef.current;
      const base = v >= 0 ? lerp(sN.opacity, sF.opacity, v) : lerp(sB.opacity, sN.opacity, v + 1);
      // Fullscreen: side cards fade to 0 as they're pushed out. Centre stays.
      if (fs > 0 && offset !== 0) {
        return base * (1 - fs);
      }
      // Intro fade-in: centre card eases from 0 to its resting opacity.
      if (intro > 0 && offset === 0) {
        return base * (1 - intro);
      }
      return base;
    }
  );

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const filterMotion = useTransform(dragOffset, (v) => {
    const { stateNeutral: sN, stateForward: sF, stateBackward: sB } = stateRef.current;
    const blur = v >= 0 ? lerp(sN.blur, sF.blur, v) : lerp(sB.blur, sN.blur, v + 1);
    const bri  = v >= 0 ? lerp(sN.brightness, sF.brightness, v) : lerp(sB.brightness, sN.brightness, v + 1);
    return `blur(${blur.toFixed(2)}px) brightness(${bri.toFixed(3)})`;
  });

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const originXMotion = useTransform(dragOffset, (v) => {
    const { stateNeutral: sN, stateForward: sF, stateBackward: sB } = stateRef.current;
    return v >= 0 ? lerp(sN.originX, sF.originX, v) : lerp(sB.originX, sN.originX, v + 1);
  });

  // zIndex: interpolate and round. Controls which card appears on top during drag.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const zIndexMotion = useTransform(dragOffset, (v) => {
    const { stateNeutral: sN, stateForward: sF, stateBackward: sB } = stateRef.current;
    const z = v >= 0 ? lerp(sN.zIndex, sF.zIndex, v) : lerp(sB.zIndex, sN.zIndex, v + 1);
    return Math.round(z);
  });

  // prefersReduced: bypass all interpolation and snap to neutral state directly
  if (prefersReduced) {
    return (
      <motion.div
        data-panel-offset={offset}
        animate={{
          x: stateNeutral.x,
          rotateY: stateNeutral.rotateY,
          originX: stateNeutral.originX,
          scale: stateNeutral.scale,
          opacity: stateNeutral.opacity,
          filter: `blur(${stateNeutral.blur}px) brightness(${stateNeutral.brightness})`,
          zIndex: stateNeutral.zIndex,
        }}
        transition={{ type: "tween", duration: 0.35, ease: "easeInOut" }}
        style={{
          position: "absolute",
          width: PANEL_W,
          height: PANEL_H,
          left: "50%",
          top: "50%",
          marginLeft: -PANEL_W / 2,
          marginTop: -PANEL_H / 2,
          transformStyle: "preserve-3d",
          willChange: "transform, opacity, filter",
          pointerEvents: isCenter ? "auto" : "none",
          userSelect: "none",
        }}
      >
        <ReducedPanelContent
          isCenter={isCenter}
          slide={slide}
          loaded={loaded}
          setLoaded={setLoaded}
          lightingConfig={lightingConfig}
        />
      </motion.div>
    );
  }

  return (
    <motion.div
      ref={panelRef}
      data-panel-offset={offset}
      onMouseEnter={() => isCenterZone && setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      style={{
        position: "absolute",
        width: PANEL_W,
        height: PANEL_H,
        left: "50%",
        top: "50%",
        marginLeft: -PANEL_W / 2,
        marginTop: -PANEL_H / 2,
        transformStyle: "preserve-3d",
        willChange: "transform, opacity, filter",
        // Disable pointer events while fullscreen so the exit overlay catches
        // clicks — otherwise the centre card would consume them.
        pointerEvents: isCenterZone && !isFullscreen ? "auto" : "none",
        userSelect: "none",
        cursor: isCenterZone && !isFullscreen ? "pointer" : "default",
        x: xMotion,
        rotateY: rotateYMotion,
        originX: originXMotion,
        scale: scaleMotion,
        opacity: opacityMotion,
        filter: filterMotion,
        zIndex: zIndexMotion,
      }}
    >
      {/* Ambient glow behind active panel — kept mounted on the centre card
          so the opacity transition runs smoothly when exiting fullscreen.
          (Conditional unmount would skip the transition on remount.) */}
      {isCenterZone && (
        <div
          style={{
            position: "absolute",
            inset: -60,
            borderRadius: 12,
            background:
              "radial-gradient(ellipse at center, rgba(255,255,255,0.07) 0%, transparent 65%)",
            pointerEvents: "none",
            zIndex: -1,
            opacity: isVisuallyFullscreen ? 0 : 1,
            transition: "opacity 0.45s ease",
          }}
        />
      )}

      {/* Main media surface */}
      <div
        style={{
          position: "relative",
          width: PANEL_W,
          height: PANEL_H,
          overflow: "hidden",
          background: "#080808",
        }}
      >
        {/* Parallax wrapper — drifts the media horizontally at less than the
            frame's speed and scales it up so the frame's overflow:hidden never
            reveals empty edges. Loaded-fade is on a child so the CSS opacity
            transition doesn't fight with motion values. */}
        <motion.div
          style={{
            position: "absolute",
            inset: 0,
            x: mediaParallaxX,
            scale: mediaWrapperScale,
            transformOrigin: "center center",
          }}
        >
          <div
            style={{
              position: "absolute",
              inset: 0,
              opacity: loaded ? 1 : 0,
              transition: "opacity 0.7s ease",
            }}
          >
            {/* Aspect-locked sizer — centered within parallax wrapper. Its
                CSS width / height are motion values that interpolate between
                cover dims (overshoots panel) and contain dims (fits within
                panel) so the media's natural aspect is preserved at every
                point of the fullscreen transition. No objectFit switching. */}
            <div
              style={{
                position: "absolute",
                top: "50%",
                left: "50%",
                transform: "translate(-50%, -50%)",
                width: mediaDims.width,
                height: mediaDims.height,
              }}
            >
              {/* Play only the 3 cards in the active viewing zone (centre + immediate
                  left/right). |offset| <= 1 covers LEFT_NEAR / CENTER / RIGHT_NEAR;
                  the FAR / HIDDEN slots stay paused to save CPU/battery. */}
              <Media
                slide={slide}
                onLoad={() => {
                  setLoaded(true);
                  if (Math.abs(offset) <= 1 && !hasReportedReadyRef.current) {
                    hasReportedReadyRef.current = true;
                    onVideoReady?.();
                  }
                }}
                shouldPlay={Math.abs(offset) <= 1}
                videoRef={videoRef}
                onAspectKnown={setMediaAspect}
              />
            </div>
          </div>
        </motion.div>
      </div>

      {/* Darkening overlay — always present on every card, opacity driven by
          centerness so it fades in/out proportionally as the card slides
          toward or away from the centre position. No mount/unmount flash. */}
      <motion.div
        style={{
          position: "absolute",
          top: 0, left: 0,
          width: PANEL_W, height: PANEL_H,
          background: "rgb(0,0,0)",
          opacity: overlayOpacity,
          pointerEvents: "none",
          zIndex: 1,
        }}
      />

      {/* Interactive lighting (surface glow + rim) — centre card only.
          The darkening overlay is handled above, so no harsh pop on mount. */}
      {isCenterZone && !isVisuallyFullscreen && <CardLighting width={PANEL_W} height={PANEL_H} config={lightingConfig} />}

      {/* Hover overlay — extra darkening layer on centre card only. Stays
          mounted while the card is in the centre zone so its opacity
          transition runs on fullscreen-exit instead of mounting at target
          opacity. */}
      {isCenterZone && (
        <div
          style={{
            position: "absolute",
            top: 0, left: 0,
            width: PANEL_W, height: PANEL_H,
            background: "rgb(0,0,0)",
            opacity: isVisuallyFullscreen ? 0 : (isHovered ? (lightingConfig?.hoverOverlay ?? 0.25) : 0),
            transition: "opacity 0.55s cubic-bezier(0.4, 0, 0.2, 1)",
            pointerEvents: "none",
            zIndex: 4,
          }}
        />
      )}

      {/* Play Video label — appears centred on hover. Purely decorative —
          the card itself acts as the trigger, so the label must not capture
          pointer events (otherwise hovering it would lift the cursor off
          CardLighting's mouse-capture layer and kill the lighting).
          Counter-scale (1/zoom) keeps the text the same apparent size as
          the Prev/Next labels that live outside the scaled container. */}
      {isCenterZone && (
        <motion.div
          style={{
            position: "absolute",
            top: 0, left: 0,
            width: PANEL_W, height: PANEL_H,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            opacity: isVisuallyFullscreen ? 0 : (isHovered ? 1 : 0),
            // Smooth ease for the hover-in/out feel. No need to speed up for
            // fullscreen entry — the counter-scale below keeps the label at a
            // constant visual size, so it just fades out in place.
            transition: "opacity 0.55s cubic-bezier(0.4, 0, 0.2, 1)",
            pointerEvents: "none",
            zIndex: 5,
            // Counter-scale neutralises the panel's growth so the label
            // doesn't visually expand into fullscreen — just fades out
            // in place at constant visual size.
            scale: labelCounterScale,
          }}
        >
          <span
            style={{
              fontFamily: "'NeueMontreal', sans-serif",
              fontWeight: 500,
              fontSize: 16 / zoom,
              color: "#ffffff",
              lineHeight: 1.5,
              letterSpacing: 0,
              whiteSpace: "nowrap",
            }}
          >
            Play Video
          </span>
        </motion.div>
      )}

    </motion.div>
  );
}

// Separate component for reduced-motion path to avoid hooks-order issues
function ReducedPanelContent({ isCenter, slide, loaded, setLoaded, lightingConfig }) {
  return (
    <>
      {isCenter && (
        <div
          style={{
            position: "absolute",
            inset: -60,
            borderRadius: 12,
            background:
              "radial-gradient(ellipse at center, rgba(255,255,255,0.07) 0%, transparent 65%)",
            pointerEvents: "none",
            zIndex: -1,
          }}
        />
      )}
      <div
        style={{
          position: "relative",
          width: PANEL_W,
          height: PANEL_H,
          overflow: "hidden",
          background: "#080808",
        }}
      >
        <div
          style={{
            position: "absolute",
            inset: 0,
            opacity: loaded ? 1 : 0,
            transition: "opacity 0.7s ease",
          }}
        >
          {slide.type === "video" ? (
            <video
              src={slide.src}
              poster={slide.poster}
              autoPlay
              muted
              loop
              playsInline
              onCanPlay={() => setLoaded(true)}
              style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
            />
          ) : (
            <img
              src={slide.src}
              alt={slide.title}
              onLoad={() => setLoaded(true)}
              style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
            />
          )}
        </div>
      </div>
      {isCenter && <CardLighting width={PANEL_W} height={PANEL_H} config={lightingConfig} />}
    </>
  );
}
