// Wrapped modulo for infinite indexing
export const getWrappedIndex = (index, length) =>
  ((index % length) + length) % length;

// Reference viewport width the card stage was tuned at (16" MBP "More Space").
// All vw-based slot positions are converted to absolute px against this width
// so the card composition stays IDENTICAL on smaller screens — the parent
// container scales down via useFitScale, and these fixed px values scale with
// it. If we left them as raw vw, vw would recompute against the actual (smaller)
// viewport and pull the side cards inward.
export const REF_WIDTH = 1728;
// Don't shrink the stage below this on very small screens. Below this width,
// horizontal scroll appears instead — cards stay readable / clickable.
export const MIN_FIT_SCALE = 0.6;
// 1 design-vw in absolute px (e.g. -41vw → -41 * 17.28 = -708.48px).
export const VW_TO_PX = REF_WIDTH / 100;

// Spatial slot definitions — every value drives CSS 3D perspective transforms.
//
// KEY DESIGN PRINCIPLE — every slot is a distinct point on the rail:
//   Each slot has a PROGRESSIVELY further-out x position. When a card shifts
//   from NEAR → FAR → HIDDEN, it actually TRANSLATES outward — it doesn't
//   rotate in place. This makes the rail feel like one continuous moving
//   structure where every visible card participates in directional motion.
//
//   Inner-edge pivots (originX: 1 for left, 0 for right) keep the LEFT_NEAR
//   seam flush with the center card. FAR slots sit further out where the
//   center card naturally occludes their inner edge (zIndex layering), so
//   the seam continuity at the visible boundary is preserved.
//
//   Scale shrinks progressively (1.0 → 0.85 → 0.6) so cards recede into
//   depth as they travel outward — a curved-rail / orbital arc feeling.
export const PANEL_STATES = {
  LEFT_HIDDEN:  { x: "-95vw",  rotateY: 78,  scale: 0.6,  originX: 1,   opacity: 0,   blur: 4,   brightness: 0.2,  zIndex: 0 },
  LEFT_FAR:     { x: "-100vw", rotateY: 62,  scale: 0.85, originX: 1,   opacity: 0.3, blur: 1.5, brightness: 0.48, zIndex: 1 },
  LEFT_NEAR:    { x: "-41vw",  rotateY: 60,  scale: 1,    originX: 1,   opacity: 0.4, blur: 1,   brightness: 0.8,  zIndex: 3 },
  CENTER:       { x: "0vw",    rotateY: 0,   scale: 1,    originX: 0.5, opacity: 1,   blur: 0,   brightness: 1,    zIndex: 5 },
  RIGHT_NEAR:   { x: "41vw",   rotateY: -60, scale: 1,    originX: 0,   opacity: 0.4, blur: 1,   brightness: 0.8,  zIndex: 3 },
  RIGHT_FAR:    { x: "100vw",  rotateY: -62, scale: 0.85, originX: 0,   opacity: 0.3, blur: 1.5, brightness: 0.48, zIndex: 1 },
  RIGHT_HIDDEN: { x: "95vw",   rotateY: -78, scale: 0.6,  originX: 0,   opacity: 0,   blur: 4,   brightness: 0.2,  zIndex: 0 },
};

export function getStateKey(offset) {
  if (offset <= -3) return "LEFT_HIDDEN";
  if (offset === -2) return "LEFT_FAR";
  if (offset === -1) return "LEFT_NEAR";
  if (offset === 0) return "CENTER";
  if (offset === 1) return "RIGHT_NEAR";
  if (offset === 2) return "RIGHT_FAR";
  return "RIGHT_HIDDEN";
}

// Cinematic spring — heavy, calm, physical feel
// restDelta/restSpeed kept very small so the spring animates all the way
// to its exact target value rather than snapping the last fraction.
export const SPRING = {
  type: "spring",
  stiffness: 68,
  damping: 22,
  mass: 1.2,
  restDelta: 0.0005,
  restSpeed: 0.0005,
};

export const SPRING_REDUCED = {
  type: "tween",
  duration: 0.35,
  ease: "easeInOut",
};
