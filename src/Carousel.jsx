import { useState, useEffect, useCallback, useRef } from "react";
import { flushSync } from "react-dom";
import { AnimatePresence, motion, useMotionValue, animate as fmAnimate } from "framer-motion";
import Panel, { PARALLAX_DEFAULTS } from "./Panel";
import { SLIDES } from "./slides";
import { getWrappedIndex, SPRING, REF_WIDTH, MIN_FIT_SCALE } from "./panelStates";
import TweakPanel, { buildInitialOverrides } from "./TweakPanel";
import { LIGHTING_DEFAULTS } from "./CardLighting";
import StageReflection, { REFLECTION_DEFAULTS } from "./StageReflection";

// How far (px) the user must drag to commit to a navigation.
// ~30% of the center card's travel distance feels natural.
const DRAG_THRESHOLD = 100;

const WHEEL_COOLDOWN_MS = 900;

// Spring for keyboard / wheel / button navigation.
// Overdamped (damping 24 > critical ~17.9) so no overshoot.
// restDelta/restSpeed tightened to 0.001 so Framer Motion's automatic
// "snap to target" fires within ~0.6px of centre — imperceptible.
// velocity: 0 — explicitly start with no momentum, regardless of any
// in-flight animation we just cancelled. Without this, fmAnimate inherits
// the motion value's current velocity, so cancelling a snap-back (or a
// settling commit) mid-flight and starting a button nav in the opposite
// direction would carry the dragOffset the wrong way before reversing,
// causing the "wild swing" symptom.
const COMMIT_SPRING = {
  type: "spring",
  stiffness: 80,
  damping: 24,
  mass: 1,
  restDelta: 0.001,
  restSpeed: 0.001,
  velocity: 0,
};

// Spring used to complete or snap-back the drag after pointer-up.
// DRAG_COMPLETE_SPRING was previously underdamped (damping 28 < critical ~31.75),
// causing the spring to overshoot past centre and snap back — the "harsh jerk
// at the last millisecond." Raised to 34 (overdamped) to eliminate overshoot.
const DRAG_COMPLETE_SPRING = { type: "spring", stiffness: 280, damping: 34, mass: 0.9, restDelta: 0.001, restSpeed: 0.001 };
const DRAG_SNAPBACK_SPRING = { type: "spring", stiffness: 320, damping: 32, mass: 0.8 };

const NAV_LINK = {
  fontFamily: "'NeueMontreal', sans-serif",
  fontWeight: 500,
  fontSize: 16,
  color: "#ffffff",
  lineHeight: 1.5,
  cursor: "pointer",
  whiteSpace: "nowrap",
};

// Static SVG grain texture rendered as a CSS background
const GRAIN_SVG = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='256' height='256'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.8' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='256' height='256' filter='url(%23n)'/%3E%3C/svg%3E")`;

// Returns a runtime scale factor for the card stage based on viewport width.
// 1.0 at >= REF_WIDTH, scales linearly down to MIN_FIT_SCALE, then clamps.
// REF_WIDTH and MIN_FIT_SCALE live in panelStates.js because they're also
// needed there to convert the design-vw slot positions to absolute px.
function useFitScale() {
  const compute = () => {
    if (typeof window === "undefined") return 1;
    return Math.max(MIN_FIT_SCALE, Math.min(1, window.innerWidth / REF_WIDTH));
  };
  const [fitScale, setFitScale] = useState(compute);
  useEffect(() => {
    const onResize = () => setFitScale(compute());
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return fitScale;
}

export default function Carousel() {
  const [activeIndex, setActiveIndex] = useState(0);
  // titleIndex drives the title block. It updates early (400ms into a
  // keyboard/button nav, immediately on drag release) so the text crossfade
  // starts in sync with the card arriving, not when the spring mathematically
  // settles.
  const [titleIndex, setTitleIndex] = useState(0);
  const [isAnimating, setIsAnimating] = useState(false);
  // Synchronous animation guard — React state is stale between renders,
  // so we keep a ref that's always up-to-date for event handlers.
  const isAnimatingRef = useRef(false);
  const [tweakOverrides, setTweakOverrides] = useState(buildInitialOverrides);
  const [carouselZoom, setCarouselZoom] = useState(1.40);
  const [edgeVignette, setEdgeVignette] = useState({ opacity: 0.70, spread: 26, falloff: 0.5 });
  const [lightingConfig, setLightingConfig] = useState(LIGHTING_DEFAULTS);
  const [reflectionConfig, setReflectionConfig] = useState(REFLECTION_DEFAULTS);
  const [parallaxConfig, setParallaxConfig] = useState(PARALLAX_DEFAULTS);

  // Viewport-driven scale that preserves the tuned card composition on smaller
  // screens. Multiplied with carouselZoom so the tweak-panel zoom slider keeps
  // working unchanged — fitScale just adapts the final size to the viewport.
  // Framing overlays (vignette, grain, floor gradient) and chrome (nav, title,
  // Prev/Next, tweak panel) are NOT inside the scaled wrapper — they always
  // span the full viewport / render at native size.
  const fitScale = useFitScale();
  const effectiveZoom = carouselZoom * fitScale;
  // Controls StageReflection fade. Goes false the instant navigation starts so
  // the reflection fades out immediately; goes true when the incoming slide is
  // ready to be shown (400ms on button/key nav, 350ms after drag release).
  const [reflectionVisible, setReflectionVisible] = useState(true);

  // Single motion value that drives ALL panel positions in realtime.
  //   0   = resting (each panel at its nominal slot)
  //  +1   = fully transitioned to the NEXT slide (dragged/animated left)
  //  -1   = fully transitioned to the PREVIOUS slide (dragged/animated right)
  const dragOffset = useMotionValue(0);

  // In-flight animation entry: { controls, cancelled }
  // cancelled flag prevents stop()-triggered then() from committing a nav.
  const animationRef = useRef(null);
  // Holds the timer that restores reflectionVisible after a drag-commit fade.
  const reflectionTimerRef = useRef(null);
  // True ONLY during the brief window when .then() commits the slot
  // reassignment + dragOffset reset. Read by Panel.jsx to suppress motion-event
  // updates to isCenterZone (those motion events would fire with stale offset
  // closures and momentarily flip the value, causing CardLighting to
  // unmount/remount and reset its internal animation state).
  const isSettlingRef = useRef(false);
  // Points to the centre Panel's <video> element. StageReflection's canvas
  // mirrors this element frame-by-frame so the reflection stays perfectly in
  // sync with the centre video (no drift between two independent decoders).
  // Each Panel writes to this ref via useEffect when it becomes the centre.
  const activeVideoRef = useRef(null);

  // Drag state
  const isDragging = useRef(false);
  const dragStartX = useRef(0);

  // Stop any in-flight animation without letting its then() fire side-effects.
  const cancelInFlight = useCallback(() => {
    if (animationRef.current) {
      animationRef.current.cancelled = true;
      clearTimeout(animationRef.current.titleTimer);
      animationRef.current.controls.stop();
      animationRef.current = null;
    }
    // Clear any pending reflection-restore timer from a previous drag commit.
    if (reflectionTimerRef.current) {
      clearTimeout(reflectionTimerRef.current);
      reflectionTimerRef.current = null;
    }
  }, []);

  // Commit a navigation in one direction.
  // Animates dragOffset to ±1, then updates activeIndex and resets dragOffset to 0.
  const commitNav = useCallback((dir) => {
    cancelInFlight();
    isAnimatingRef.current = true;
    setIsAnimating(true);
    // Kick off the reflection fade-out immediately — the floor responds the
    // instant the user clicks Prev/Next (or presses a key).
    setReflectionVisible(false);

    const entry = { controls: null, cancelled: false, titleTimer: null };
    const controls = fmAnimate(dragOffset, dir, COMMIT_SPRING);
    entry.controls = controls;
    animationRef.current = entry;

    // Title updates at 400ms — cards are ~60% there, so the crossfade lands
    // in sync with the new card arriving.
    entry.titleTimer = setTimeout(() => {
      if (!entry.cancelled) {
        setTitleIndex((prev) => getWrappedIndex(prev + dir, SLIDES.length));
      }
    }, 400);

    // Reflection fades back in at 850ms — just before the spring fully
    // settles (~1s), so it drifts in as the card arrives rather than
    // popping in after the fact.
    reflectionTimerRef.current = setTimeout(() => {
      reflectionTimerRef.current = null;
      if (!entry.cancelled) setReflectionVisible(true);
    }, 850);

    controls.then(() => {
      if (entry.cancelled) return;
      // Settling window: motion-event subscriptions in every Panel have stale
      // offset closures right now. Suppress them while we commit the slot
      // reassignment + dragOffset reset; Panel's useLayoutEffect (which reads
      // the fresh offset prop and current dragOffset) will set isCenterZone
      // to the correct final value inside the same commit. flushSync forces
      // that commit to happen synchronously so the browser never paints with
      // wrong panel positions.
      isSettlingRef.current = true;
      flushSync(() => {
        setActiveIndex((prev) => getWrappedIndex(prev + dir, SLIDES.length));
        dragOffset.set(0);
      });
      isSettlingRef.current = false;
      isAnimatingRef.current = false;
      setIsAnimating(false);
      animationRef.current = null;
    });
  }, [dragOffset, cancelInFlight]);

  // Public navigate — used by keyboard, wheel, and Prev/Next buttons.
  // Guards against both an in-flight animation AND an active drag — starting a
  // commitNav while the user is dragging would put two things animating the
  // same dragOffset motion value simultaneously, which can cause the running
  // spring's promise to resolve early and fire its then() unexpectedly.
  const navigate = useCallback((dir) => {
    if (isAnimatingRef.current) return;
    if (isDragging.current) return;
    commitNav(dir);
  }, [commitNav]);

  // Keep a stable ref to navigate so keyboard/wheel effects don't re-run
  // every time isAnimating changes (which would reset their cooldown vars).
  const navigateRef = useRef(navigate);
  useEffect(() => { navigateRef.current = navigate; }, [navigate]);

  // Keyboard — stable effect, reads navigate via ref
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "ArrowLeft") navigateRef.current(-1);
      if (e.key === "ArrowRight") navigateRef.current(1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Scroll wheel — cooldown prevents rapid-fire.
  // Stable effect: cooldown variable persists across navigations because the
  // effect is never torn down and re-created when isAnimating changes.
  useEffect(() => {
    let cooldown = false;
    const onWheel = (e) => {
      if (cooldown) return;
      const dx = Math.abs(e.deltaX);
      const dy = Math.abs(e.deltaY);
      const delta = dx > dy ? e.deltaX : e.deltaY;
      if (Math.abs(delta) < 20) return;
      e.preventDefault();
      navigateRef.current(delta > 0 ? 1 : -1);
      cooldown = true;
      setTimeout(() => { cooldown = false; }, WHEEL_COOLDOWN_MS);
    };
    window.addEventListener("wheel", onWheel, { passive: false });
    return () => window.removeEventListener("wheel", onWheel);
  }, []);

  // ── Drag / touch swipe ────────────────────────────────────────────────────
  // Panels move in realtime with the finger/cursor. On release:
  //   - Past threshold → spring to ±1, commit, reset to 0
  //   - Below threshold → spring back to 0

  const handlePointerDown = useCallback((e) => {
    if (isAnimatingRef.current) return;
    // Cancel any in-flight snap-back so the grab feels immediate
    cancelInFlight();
    isDragging.current = true;
    dragStartX.current = e.clientX;
    e.currentTarget.setPointerCapture(e.pointerId);
  }, [cancelInFlight]);

  const handlePointerMove = useCallback((e) => {
    if (!isDragging.current) return;
    // Don't call dragOffset.set() while fmAnimate is running on the same value.
    // Calling .set() mid-animation can resolve the animation's promise early,
    // causing its then() to fire with entry.cancelled = false — resetting
    // isAnimating and allowing a second navigation to slip through.
    if (isAnimatingRef.current) return;
    const delta = e.clientX - dragStartX.current;
    // The center card travels 41vw to reach LEFT_NEAR / RIGHT_NEAR.
    // Mapping DRAG_FULL_PX to 41vw gives a genuine 1:1 drag-to-card feel.
    const dragFullPx = window.innerWidth * 0.41;
    // Negative delta (drag left) = forward navigation = positive dragOffset
    const raw = -(delta / dragFullPx);
    dragOffset.set(Math.max(-1, Math.min(1, raw)));
  }, [dragOffset]);

  const handlePointerUp = useCallback((e) => {
    if (!isDragging.current) return;
    isDragging.current = false;
    // If an animation took over while the drag was active (shouldn't normally
    // happen given the other guards, but belt-and-suspenders), just bail out
    // rather than starting a second overlapping commit.
    if (isAnimatingRef.current) return;
    const delta = e.clientX - dragStartX.current;

    if (Math.abs(delta) > DRAG_THRESHOLD) {
      // Commit: spring to the target then swap index
      const dir = delta < 0 ? 1 : -1;
      cancelInFlight();
      isAnimatingRef.current = true;
      setIsAnimating(true);
      // Start reflection fade-out the instant the user lifts their finger.
      setReflectionVisible(false);

      // Title updates immediately on release — the user already decided to
      // navigate, so the crossfade should start the moment they let go.
      setTitleIndex((prev) => getWrappedIndex(prev + dir, SLIDES.length));
      // Fade the reflection back in when the drag spring is nearly settled
      // (~600ms total). 450ms gives the card time to land before the floor
      // reflection drifts back in.
      reflectionTimerRef.current = setTimeout(() => {
        reflectionTimerRef.current = null;
        setReflectionVisible(true);
      }, 450);

      const entry = { controls: null, cancelled: false, titleTimer: null };
      const controls = fmAnimate(dragOffset, dir, DRAG_COMPLETE_SPRING);
      entry.controls = controls;
      animationRef.current = entry;

      controls.then(() => {
        if (entry.cancelled) return;
        // See commitNav for why isSettlingRef + flushSync are both needed.
        isSettlingRef.current = true;
        flushSync(() => {
          setActiveIndex((prev) => getWrappedIndex(prev + dir, SLIDES.length));
          dragOffset.set(0);
        });
        isSettlingRef.current = false;
        isAnimatingRef.current = false;
        setIsAnimating(false);
        animationRef.current = null;
      });
    } else {
      // Sub-threshold: spring back to centre
      cancelInFlight();
      const entry = { controls: null, cancelled: false };
      const controls = fmAnimate(dragOffset, 0, DRAG_SNAPBACK_SPRING);
      entry.controls = controls;
      animationRef.current = entry;
      controls.then(() => {
        if (entry.cancelled) return;
        animationRef.current = null;
      });
    }
  }, [dragOffset, cancelInFlight]);

  const activeSlide = SLIDES[titleIndex];

  // Render 7 slots (−3…+3). Slots ±3 are LEFT_HIDDEN / RIGHT_HIDDEN (opacity 0,
  // off-screen), so the wrap-around jump only ever occurs between two invisible
  // positions — making it undetectable.
  const visibleItems = [-3, -2, -1, 0, 1, 2, 3].map((offset) => ({
    slide: SLIDES[getWrappedIndex(activeIndex + offset, SLIDES.length)],
    offset,
  }));

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "#000",
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
      }}
    >
      {/* Stage reflection — spatially anchored to the viewport, not the card
          rail. Sits at zIndex 1 so the floor-gradient/vignette overlays (zIndex 2)
          naturally darken and dissolve its lower portion. */}
      <StageReflection slide={activeSlide} zoom={effectiveZoom} config={reflectionConfig} visible={reflectionVisible} activeVideoRef={activeVideoRef} />

      {/* Card rail — full-viewport, behind all UI chrome. */}
      <motion.div
        className="panels-container"
        style={{
          position: "absolute",
          inset: 0,
          zIndex: 1,
          touchAction: "pan-y",
          perspective: "1400px",
          scale: effectiveZoom,
        }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
      >
        {visibleItems.map(({ slide, offset }) => (
          <Panel
            key={slide.id}
            offset={offset}
            slide={slide}
            tweakOverrides={tweakOverrides}
            lightingConfig={lightingConfig}
            dragOffset={dragOffset}
            zoom={effectiveZoom}
            isSettlingRef={isSettlingRef}
            activeVideoRef={activeVideoRef}
            activeSlideId={activeSlide.id}
            parallaxConfig={parallaxConfig}
          />
        ))}
      </motion.div>

      {/* Full-viewport overlays — sit above cards, below UI chrome */}
      {/* Side edge fade */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          zIndex: 2,
          background: (() => {
            const { opacity, spread, falloff } = edgeVignette;
            const hint = (spread * falloff).toFixed(1);
            const hintR = (100 - spread + (spread * (1 - falloff))).toFixed(1);
            return `linear-gradient(to right, rgba(0,0,0,${opacity}) 0%, ${hint}%, transparent ${spread}%, transparent ${100 - spread}%, ${hintR}%, rgba(0,0,0,${opacity}) 100%)`;
          })(),
          pointerEvents: "none",
        }}
      />
      {/* Floor gradient */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          zIndex: 2,
          background: "linear-gradient(to bottom, transparent 55%, rgba(0,0,0,0.6) 100%)",
          pointerEvents: "none",
        }}
      />
      {/* Vignette */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          zIndex: 2,
          background: "radial-gradient(ellipse 90% 85% at 50% 45%, transparent 38%, rgba(0,0,0,0.55) 100%)",
          pointerEvents: "none",
        }}
      />

      {/* Grain overlay */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          zIndex: 30,
          pointerEvents: "none",
          opacity: 0.038,
          backgroundImage: GRAIN_SVG,
          backgroundRepeat: "repeat",
          backgroundSize: "256px 256px",
          mixBlendMode: "screen",
        }}
      />

      {/* Top navigation */}
      <nav
        style={{
          position: "relative",
          zIndex: 20,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "28px 40px",
          gap: 32,
          flexShrink: 0,
        }}
      >
        <div style={{ display: "flex", flex: 1, alignItems: "center", justifyContent: "flex-end", gap: 32 }}>
          <span style={{ ...NAV_LINK, display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ display: "inline-block", width: 8, height: 8, background: "#f9f229", flexShrink: 0 }} />
            Work
          </span>
          <span style={NAV_LINK}>About</span>
        </div>

        <span
          style={{
            fontFamily: "'Bootzy', serif",
            fontSize: 32,
            fontWeight: "normal",
            color: "#ffffff",
            letterSpacing: "0.32px",
            lineHeight: 1,
            flexShrink: 0,
            whiteSpace: "nowrap",
          }}
        >
          studio.seven
        </span>

        <div style={{ display: "flex", flex: 1, alignItems: "center", gap: 32 }}>
          <span style={NAV_LINK}>Services</span>
          <span style={NAV_LINK}>Contact</span>
        </div>
      </nav>

      {/* Stage — flex spacer for Prev/Next buttons, vertically centred.
          pointerEvents:none so it doesn't swallow mouse events over the card. */}
      <div
        style={{
          position: "relative",
          flex: 1,
          minHeight: 0,
          zIndex: 20,
          pointerEvents: "none",
        }}
      >
        <button
          onClick={() => navigate(-1)}
          aria-label="Previous"
          style={{
            position: "absolute",
            left: 40,
            top: "50%",
            transform: "translateY(-50%)",
            background: "none",
            border: "none",
            ...NAV_LINK,
            cursor: "pointer",
            padding: 40,
            margin: -40,
            pointerEvents: "auto",
          }}
        >
          Prev
        </button>

        <button
          onClick={() => navigate(1)}
          aria-label="Next"
          style={{
            position: "absolute",
            right: 40,
            top: "50%",
            transform: "translateY(-50%)",
            background: "none",
            border: "none",
            ...NAV_LINK,
            cursor: "pointer",
            padding: 40,
            margin: -40,
            pointerEvents: "auto",
          }}
        >
          Next
        </button>
      </div>

      {/* Developer tweak panel — remove before shipping */}
      <TweakPanel
        overrides={tweakOverrides}
        onChange={setTweakOverrides}
        zoom={carouselZoom}
        onZoomChange={setCarouselZoom}
        edgeVignette={edgeVignette}
        onEdgeVignetteChange={setEdgeVignette}
        lightingConfig={lightingConfig}
        onLightingChange={setLightingConfig}
        reflectionConfig={reflectionConfig}
        onReflectionChange={setReflectionConfig}
        parallaxConfig={parallaxConfig}
        onParallaxChange={setParallaxConfig}
      />

      {/* Title block */}
      <div
        style={{
          position: "relative",
          zIndex: 20,
          textAlign: "center",
          paddingBottom: 44,
          paddingTop: 12,
          flexShrink: 0,
          minHeight: 100,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <AnimatePresence mode="wait">
          <motion.div
            key={titleIndex}
            variants={{
              // Enter and exit have different durations — variants is the only
              // correct way to set per-direction transitions in Framer Motion.
              // Exit takes 450ms so the incoming title enters exactly when the
              // reflection fires:
              //   button/key: titleIndex changes at 400ms → exits by 850ms → reflectionTimer at 850ms ✓
              //   drag:       titleIndex changes at 0ms   → exits by 450ms → reflectionTimer at 450ms ✓
              hidden:  { opacity: 0, y: 8 },
              visible: { opacity: 1, y: 0, transition: { duration: 0.38, delay: 0.12, ease: "easeInOut" } },
              exit:    { opacity: 0, y: -6, transition: { duration: 0.45, ease: "easeInOut" } },
            }}
            initial="hidden"
            animate="visible"
            exit="exit"
            style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}
          >
            <h1
              className="title-trimmed"
              style={{
                fontFamily: "'Bootzy', serif",
                fontSize: 60,
                fontWeight: "normal",
                color: "#f9f229",
                lineHeight: 1.4,
                margin: 0,
              }}
            >
              {activeSlide.title}
            </h1>

            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                fontFamily: "'NeueMontreal', sans-serif",
                fontWeight: 500,
                fontSize: 16,
                color: "#ffffff",
                lineHeight: 1.5,
              }}
            >
              {activeSlide.subtitle.split(" · ").map((part, i, arr) => (
                <>
                  <span key={part}>{part}</span>
                  {i < arr.length - 1 && <span key={`dot-${i}`}>·</span>}
                </>
              ))}
            </div>
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}
