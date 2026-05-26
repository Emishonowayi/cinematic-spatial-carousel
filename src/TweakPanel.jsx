import { useState } from "react";
import { PANEL_STATES } from "./panelStates";
import { LIGHTING_DEFAULTS } from "./CardLighting";
import { REFLECTION_DEFAULTS } from "./StageReflection";
import { PARALLAX_DEFAULTS } from "./Panel";

// Slots exposed for tuning — CENTER is intentionally excluded
const TUNABLE_SLOTS = ["LEFT_HIDDEN", "LEFT_FAR", "LEFT_NEAR", "RIGHT_NEAR", "RIGHT_FAR", "RIGHT_HIDDEN"];

// Mirror pairs: LEFT → RIGHT
const MIRROR_PAIRS = {
  LEFT_HIDDEN: "RIGHT_HIDDEN",
  LEFT_FAR:    "RIGHT_FAR",
  LEFT_NEAR:   "RIGHT_NEAR",
};
// Fields that get negated when mirroring (left is negative x, positive rotateY; right is opposite)
const NEGATED_FIELDS = new Set(["xVw", "rotateY"]);

// Field config: [key, label, min, max, step]
const FIELDS = [
  ["xVw",        "x (vw)",     -200,  200, 1   ],
  ["rotateY",    "rotateY",    -90,   90,  1   ],
  ["scale",      "scale",       0.3,  1.3, 0.01],
  ["opacity",    "opacity",     0,    1,   0.01],
  ["blur",       "blur",        0,    12,  0.1 ],
  ["brightness", "brightness",  0,    1.5, 0.01],
];

// Parse "−47vw" → -47, "95vw" → 95
function parseVw(str) {
  return parseFloat(str.replace("vw", ""));
}

function buildInitialOverrides() {
  const out = {};
  for (const slot of TUNABLE_SLOTS) {
    const s = PANEL_STATES[slot];
    out[slot] = {
      xVw:        parseVw(s.x),
      rotateY:    s.rotateY,
      scale:      s.scale,
      opacity:    s.opacity,
      blur:       s.blur,
      brightness: s.brightness,
    };
  }
  return out;
}

function buildExportString(overrides, zoom, edgeVignette, lightingConfig) {
  const lines = ["export const PANEL_STATES = {"];

  // Emit CENTER first (unchanged)
  const c = PANEL_STATES.CENTER;
  lines.push(`  CENTER: { x: "${c.x}", rotateY: ${c.rotateY}, scale: ${c.scale}, originX: ${c.originX}, opacity: ${c.opacity}, blur: ${c.blur}, brightness: ${c.brightness}, zIndex: ${c.zIndex} },`);

  for (const slot of TUNABLE_SLOTS) {
    const o = overrides[slot];
    const orig = PANEL_STATES[slot];
    const xStr = `${o.xVw}vw`;
    lines.push(
      `  ${slot}: { x: "${xStr}", rotateY: ${o.rotateY}, scale: ${o.scale}, originX: ${orig.originX}, opacity: ${o.opacity}, blur: ${o.blur}, brightness: ${o.brightness}, zIndex: ${orig.zIndex} },`
    );
  }
  lines.push("};");
  lines.push("");
  lines.push(`// Carousel zoom: ${zoom.toFixed(2)}`);
  lines.push(`export const CAROUSEL_ZOOM = ${zoom.toFixed(2)};`);
  if (edgeVignette) {
    lines.push("");
    lines.push(`// Edge vignette`);
    lines.push(`export const EDGE_VIGNETTE = { opacity: ${edgeVignette.opacity.toFixed(2)}, spread: ${edgeVignette.spread} };`);
  }
  if (lightingConfig) {
    lines.push("");
    lines.push(`// Card lighting`);
    lines.push(`export const LIGHTING_CONFIG = ${JSON.stringify(lightingConfig, null, 2)};`);
  }
  return lines.join("\n");
}

const PANEL_STYLE = {
  position: "fixed",
  bottom: 0,
  right: 0,
  width: 320,
  maxHeight: "100vh",
  overflowY: "auto",
  background: "rgba(10, 10, 10, 0.93)",
  borderLeft: "1px solid rgba(255,255,255,0.1)",
  borderTop: "1px solid rgba(255,255,255,0.1)",
  zIndex: 9999,
  fontFamily: "ui-monospace, 'Cascadia Code', 'Fira Mono', monospace",
  fontSize: 11,
  color: "#c8c8c8",
  padding: "12px 0 20px",
  userSelect: "none",
};

const SLOT_COLORS = {
  LEFT_HIDDEN: "#5b7fff",
  LEFT_FAR:    "#74b2ff",
  LEFT_NEAR:   "#93d4ff",
  RIGHT_NEAR:  "#ffa983",
  RIGHT_FAR:   "#ff7c5b",
  RIGHT_HIDDEN:"#ff4d4d",
};

// Short display names for mirrored mode
const SLOT_SHORT = {
  LEFT_HIDDEN: "HIDDEN",
  LEFT_FAR:    "FAR",
  LEFT_NEAR:   "NEAR",
};

function SlotSection({ slot, values, onChange, mirrored, mirrorLabel }) {
  const [collapsed, setCollapsed] = useState(false);
  const color = SLOT_COLORS[slot];
  const rightColor = mirrored ? SLOT_COLORS[MIRROR_PAIRS[slot]] : null;

  return (
    <div style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
      <div
        onClick={() => setCollapsed((c) => !c)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 7,
          padding: "7px 14px",
          cursor: "pointer",
          background: collapsed ? "transparent" : "rgba(255,255,255,0.03)",
        }}
      >
        {/* Single dot or two dots for mirrored */}
        {mirrored ? (
          <span style={{ display: "flex", gap: 3, flexShrink: 0 }}>
            <span style={{ width: 8, height: 8, borderRadius: 2, background: color }} />
            <span style={{ width: 8, height: 8, borderRadius: 2, background: rightColor }} />
          </span>
        ) : (
          <span style={{ width: 8, height: 8, borderRadius: 2, background: color, flexShrink: 0 }} />
        )}
        <span style={{ fontWeight: 700, letterSpacing: "0.04em", color: "#fff", fontSize: 10.5 }}>
          {mirrored ? mirrorLabel : slot}
        </span>
        <span style={{ marginLeft: "auto", color: "#555", fontSize: 10 }}>{collapsed ? "▸" : "▾"}</span>
      </div>

      {!collapsed && (
        <div style={{ padding: "4px 14px 10px" }}>
          {FIELDS.map(([key, label, min, max, step]) => (
            <FieldRow
              key={key}
              label={label}
              value={values[key]}
              min={min}
              max={max}
              step={step}
              color={color}
              onChange={(v) => onChange(slot, key, v)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function FieldRow({ label, value, min, max, step, color, onChange }) {
  const display = Number.isInteger(step) ? Math.round(value) : value.toFixed(step < 0.05 ? 2 : 1);

  return (
    <div style={{ marginBottom: 7 }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
        <span style={{ color: "#888", fontSize: 10 }}>{label}</span>
        <input
          type="number"
          value={display}
          min={min}
          max={max}
          step={step}
          onChange={(e) => {
            const v = parseFloat(e.target.value);
            if (!isNaN(v)) onChange(Math.min(max, Math.max(min, v)));
          }}
          style={{
            width: 58,
            background: "rgba(255,255,255,0.07)",
            border: "none",
            borderRadius: 3,
            color: "#fff",
            fontSize: 10,
            textAlign: "right",
            padding: "1px 5px",
            outline: "none",
            fontFamily: "inherit",
          }}
        />
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        style={{
          width: "100%",
          accentColor: color,
          cursor: "pointer",
        }}
      />
    </div>
  );
}

const LIGHTING_FIELDS = [
  // [key, label, min, max, step, description]
  ["overlayDarkness", "overlay darkness",  0,    0.8,  0.01, "base dim on active card"],
  ["hoverOverlay",    "hover overlay",     0,    1,    0.01, "extra dim on hover"],
  ["lightSize",       "surface size",      60,   600,  1,    "blob diameter (px)"],
  ["lightBlur",       "surface blur",      0.05, 0.5,  0.01, "blur ÷ size"],
  ["lightIntensity",  "surface intensity", 0,    1,    0.01, "peak opacity"],
  ["lightInertia",    "surface inertia",   0.01, 0.3,  0.01, "lerp — lower = heavier"],
  ["rimWidth",        "rim width",         1,    8,    0.5,  "border thickness (px)"],
  ["rimPeak",         "rim peak",          0,    1,    0.01, "brightness at cursor point"],
  ["rimSpread",       "rim spread",        10,   80,   1,    "falloff start (%)"],
  ["rimIntensity",    "rim intensity",     0,    1,    0.01, "overall rim opacity"],
];

const PARALLAX_FIELDS = [
  // [key, label, min, max, step, description]
  ["parallaxPx", "drift",  0,    300,  1,    "media lag at peak (px)"],
  ["peak",       "peak",   0.05, 0.95, 0.01, "when lag is max — higher = catches up later"],
  ["scale",      "zoom",   1,    2.0,  0.01, "must exceed 1 + 2·drift/680"],
];

function ParallaxSection({ config, onChange }) {
  const [collapsed, setCollapsed] = useState(false);
  const set = (key, val) => onChange((prev) => ({ ...prev, [key]: val }));

  return (
    <div style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
      <div
        onClick={() => setCollapsed((c) => !c)}
        style={{
          display: "flex", alignItems: "center", gap: 7,
          padding: "7px 14px", cursor: "pointer",
          background: collapsed ? "transparent" : "rgba(255,255,255,0.03)",
        }}
      >
        <span style={{ width: 8, height: 8, borderRadius: 2, background: "#f9b27a", flexShrink: 0 }} />
        <span style={{ fontWeight: 700, letterSpacing: "0.04em", color: "#fff", fontSize: 10.5 }}>PARALLAX</span>
        <span style={{ color: "#555", fontSize: 9, marginLeft: 4 }}>media depth</span>
        <button
          onClick={(e) => { e.stopPropagation(); onChange(PARALLAX_DEFAULTS); }}
          style={{ ...btnStyle, marginLeft: "auto", padding: "2px 6px", fontSize: 9 }}
          title="reset parallax"
        >
          reset
        </button>
        <span style={{ color: "#555", fontSize: 10 }}>{collapsed ? "▸" : "▾"}</span>
      </div>

      {!collapsed && (
        <div style={{ padding: "4px 14px 10px" }}>
          {/* Curve toggle — switch between linear (snaps back) and sin
              (smooth ease-back) parallax math */}
          <div style={{
            display: "flex", alignItems: "center", justifyContent: "space-between",
            marginBottom: 9, paddingBottom: 7,
            borderBottom: "1px solid rgba(255,255,255,0.04)",
          }}>
            <span style={{ color: "#888", fontSize: 10 }}>
              curve
              <span style={{ color: "#555", marginLeft: 6 }}>
                {config.curve === "sin" ? "smooth ease-back" : "linear (snaps)"}
              </span>
            </span>
            <div style={{ display: "flex", gap: 4 }}>
              {["sin", "linear"].map((opt) => (
                <button
                  key={opt}
                  onClick={() => set("curve", opt)}
                  style={{
                    ...btnStyle,
                    padding: "2px 8px",
                    fontSize: 10,
                    color: config.curve === opt ? "#f9b27a" : "#aaa",
                    borderColor: config.curve === opt ? "#f9b27a" : "rgba(255,255,255,0.2)",
                  }}
                >
                  {opt}
                </button>
              ))}
            </div>
          </div>

          {PARALLAX_FIELDS.map(([key, label, min, max, step, desc]) => {
            // The peak slider is only meaningful in sin mode
            if (key === "peak" && config.curve !== "sin") return null;
            return (
              <div key={key} style={{ marginBottom: 7 }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 2 }}>
                  <span style={{ color: "#888", fontSize: 10 }}>{label}</span>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{ color: "#555", fontSize: 9 }}>{desc}</span>
                    <input
                      type="number"
                      value={step < 0.05 ? config[key].toFixed(2) : Math.round(config[key])}
                      min={min} max={max} step={step}
                      onChange={(e) => { const v = parseFloat(e.target.value); if (!isNaN(v)) set(key, Math.min(max, Math.max(min, v))); }}
                      style={{
                        width: 50, background: "rgba(255,255,255,0.07)", border: "none",
                        borderRadius: 3, color: "#fff", fontSize: 10, textAlign: "right",
                        padding: "1px 5px", outline: "none", fontFamily: "inherit",
                      }}
                    />
                  </div>
                </div>
                <input
                  type="range" min={min} max={max} step={step}
                  value={config[key]}
                  onChange={(e) => set(key, parseFloat(e.target.value))}
                  style={{ width: "100%", accentColor: "#f9b27a", cursor: "pointer" }}
                />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function LightingSection({ config, onChange }) {
  const [collapsed, setCollapsed] = useState(false);
  const set = (key, val) => onChange((prev) => ({ ...prev, [key]: val }));

  return (
    <div style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
      <div
        onClick={() => setCollapsed((c) => !c)}
        style={{
          display: "flex", alignItems: "center", gap: 7,
          padding: "7px 14px", cursor: "pointer",
          background: collapsed ? "transparent" : "rgba(255,255,255,0.03)",
        }}
      >
        <span style={{ width: 8, height: 8, borderRadius: 2, background: "#c4a3ff", flexShrink: 0 }} />
        <span style={{ fontWeight: 700, letterSpacing: "0.04em", color: "#fff", fontSize: 10.5 }}>LIGHTING</span>
        <span style={{ color: "#555", fontSize: 9, marginLeft: 4 }}>center card only</span>
        <button
          onClick={(e) => { e.stopPropagation(); onChange((prev) => ({ ...prev })); }}
          style={{ ...btnStyle, marginLeft: "auto", padding: "2px 6px", fontSize: 9 }}
          title="reset lighting"
        >
          reset
        </button>
        <span style={{ color: "#555", fontSize: 10 }}>{collapsed ? "▸" : "▾"}</span>
      </div>

      {!collapsed && (
        <div style={{ padding: "4px 14px 10px" }}>
          {LIGHTING_FIELDS.map(([key, label, min, max, step, desc]) => (
            <div key={key} style={{ marginBottom: 7 }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 2 }}>
                <span style={{ color: "#888", fontSize: 10 }}>{label}</span>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ color: "#555", fontSize: 9 }}>{desc}</span>
                  <input
                    type="number"
                    value={step < 0.05 ? config[key].toFixed(2) : Number.isInteger(step) ? Math.round(config[key]) : config[key].toFixed(1)}
                    min={min} max={max} step={step}
                    onChange={(e) => { const v = parseFloat(e.target.value); if (!isNaN(v)) set(key, Math.min(max, Math.max(min, v))); }}
                    style={{
                      width: 50, background: "rgba(255,255,255,0.07)", border: "none",
                      borderRadius: 3, color: "#fff", fontSize: 10, textAlign: "right",
                      padding: "1px 5px", outline: "none", fontFamily: "inherit",
                    }}
                  />
                </div>
              </div>
              <input
                type="range" min={min} max={max} step={step}
                value={config[key]}
                onChange={(e) => set(key, parseFloat(e.target.value))}
                style={{ width: "100%", accentColor: "#c4a3ff", cursor: "pointer" }}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ReflectionSection({ config, onChange }) {
  const [collapsed, setCollapsed] = useState(false);
  const set = (key, val) => onChange((prev) => ({ ...prev, [key]: val }));

  return (
    <div style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
      <div
        onClick={() => setCollapsed((c) => !c)}
        style={{
          display: "flex", alignItems: "center", gap: 7,
          padding: "7px 14px", cursor: "pointer",
          background: collapsed ? "transparent" : "rgba(255,255,255,0.03)",
        }}
      >
        <span style={{ width: 8, height: 8, borderRadius: 2, background: "#6ee7b7", flexShrink: 0 }} />
        <span style={{ fontWeight: 700, letterSpacing: "0.04em", color: "#fff", fontSize: 10.5 }}>REFLECTION</span>
        <span style={{ color: "#555", fontSize: 9, marginLeft: 4 }}>floor stage</span>
        <span style={{ marginLeft: "auto", color: "#555", fontSize: 10 }}>{collapsed ? "▸" : "▾"}</span>
      </div>

      {!collapsed && (
        <div style={{ padding: "4px 14px 10px" }}>
          {/* offsetY */}
          <div style={{ marginBottom: 7 }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
              <span style={{ color: "#888", fontSize: 10 }}>offset Y</span>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ color: "#555", fontSize: 9 }}>px from card edge</span>
                <input
                  type="number" value={Math.round(config.offsetY)}
                  min={-300} max={300} step={1}
                  onChange={(e) => { const v = parseFloat(e.target.value); if (!isNaN(v)) set("offsetY", Math.min(300, Math.max(-300, v))); }}
                  style={{ width: 50, background: "rgba(255,255,255,0.07)", border: "none", borderRadius: 3, color: "#fff", fontSize: 10, textAlign: "right", padding: "1px 5px", outline: "none", fontFamily: "inherit" }}
                />
              </div>
            </div>
            <input type="range" min={-300} max={300} step={1} value={config.offsetY}
              onChange={(e) => set("offsetY", parseFloat(e.target.value))}
              style={{ width: "100%", accentColor: "#6ee7b7", cursor: "pointer" }} />
          </div>
          {/* blur */}
          <div style={{ marginBottom: 7 }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
              <span style={{ color: "#888", fontSize: 10 }}>blur</span>
              <input
                type="number" value={config.blur.toFixed(1)}
                min={0} max={30} step={0.5}
                onChange={(e) => { const v = parseFloat(e.target.value); if (!isNaN(v)) set("blur", Math.min(30, Math.max(0, v))); }}
                style={{ width: 50, background: "rgba(255,255,255,0.07)", border: "none", borderRadius: 3, color: "#fff", fontSize: 10, textAlign: "right", padding: "1px 5px", outline: "none", fontFamily: "inherit" }}
              />
            </div>
            <input type="range" min={0} max={30} step={0.5} value={config.blur}
              onChange={(e) => set("blur", parseFloat(e.target.value))}
              style={{ width: "100%", accentColor: "#6ee7b7", cursor: "pointer" }} />
          </div>
          {/* opacity */}
          <div style={{ marginBottom: 7 }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
              <span style={{ color: "#888", fontSize: 10 }}>opacity</span>
              <input
                type="number" value={config.opacity.toFixed(2)}
                min={0} max={1} step={0.01}
                onChange={(e) => { const v = parseFloat(e.target.value); if (!isNaN(v)) set("opacity", Math.min(1, Math.max(0, v))); }}
                style={{ width: 50, background: "rgba(255,255,255,0.07)", border: "none", borderRadius: 3, color: "#fff", fontSize: 10, textAlign: "right", padding: "1px 5px", outline: "none", fontFamily: "inherit" }}
              />
            </div>
            <input type="range" min={0} max={1} step={0.01} value={config.opacity}
              onChange={(e) => set("opacity", parseFloat(e.target.value))}
              style={{ width: "100%", accentColor: "#6ee7b7", cursor: "pointer" }} />
          </div>
          {/* gradient start */}
          <div style={{ marginBottom: 7 }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
              <span style={{ color: "#888", fontSize: 10 }}>gradient start</span>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ color: "#555", fontSize: 9 }}>% from top</span>
                <input
                  type="number" value={Math.round(config.gradientStart)}
                  min={0} max={100} step={1}
                  onChange={(e) => { const v = parseFloat(e.target.value); if (!isNaN(v)) set("gradientStart", Math.min(100, Math.max(0, v))); }}
                  style={{ width: 50, background: "rgba(255,255,255,0.07)", border: "none", borderRadius: 3, color: "#fff", fontSize: 10, textAlign: "right", padding: "1px 5px", outline: "none", fontFamily: "inherit" }}
                />
              </div>
            </div>
            <input type="range" min={0} max={100} step={1} value={config.gradientStart}
              onChange={(e) => set("gradientStart", parseFloat(e.target.value))}
              style={{ width: "100%", accentColor: "#6ee7b7", cursor: "pointer" }} />
          </div>
          {/* gradient end */}
          <div style={{ marginBottom: 7 }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
              <span style={{ color: "#888", fontSize: 10 }}>gradient end</span>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ color: "#555", fontSize: 9 }}>% spread from top</span>
                <input
                  type="number" value={Math.round(config.gradientEnd)}
                  min={0} max={100} step={1}
                  onChange={(e) => { const v = parseFloat(e.target.value); if (!isNaN(v)) set("gradientEnd", Math.min(100, Math.max(0, v))); }}
                  style={{ width: 50, background: "rgba(255,255,255,0.07)", border: "none", borderRadius: 3, color: "#fff", fontSize: 10, textAlign: "right", padding: "1px 5px", outline: "none", fontFamily: "inherit" }}
                />
              </div>
            </div>
            <input type="range" min={0} max={100} step={1} value={config.gradientEnd}
              onChange={(e) => set("gradientEnd", parseFloat(e.target.value))}
              style={{ width: "100%", accentColor: "#6ee7b7", cursor: "pointer" }} />
          </div>
          {/* gradient dark */}
          <div style={{ marginBottom: 7 }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
              <span style={{ color: "#888", fontSize: 10 }}>gradient dark</span>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ color: "#555", fontSize: 9 }}>bottom darkness</span>
                <input
                  type="number" value={config.gradientDark.toFixed(2)}
                  min={0} max={1} step={0.01}
                  onChange={(e) => { const v = parseFloat(e.target.value); if (!isNaN(v)) set("gradientDark", Math.min(1, Math.max(0, v))); }}
                  style={{ width: 50, background: "rgba(255,255,255,0.07)", border: "none", borderRadius: 3, color: "#fff", fontSize: 10, textAlign: "right", padding: "1px 5px", outline: "none", fontFamily: "inherit" }}
                />
              </div>
            </div>
            <input type="range" min={0} max={1} step={0.01} value={config.gradientDark}
              onChange={(e) => set("gradientDark", parseFloat(e.target.value))}
              style={{ width: "100%", accentColor: "#6ee7b7", cursor: "pointer" }} />
          </div>
          {/* skew */}
          <div style={{ marginBottom: 7 }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
              <span style={{ color: "#888", fontSize: 10 }}>skew</span>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ color: "#555", fontSize: 9 }}>floor tilt °</span>
                <input
                  type="number" value={Math.round(config.skew)}
                  min={0} max={60} step={1}
                  onChange={(e) => { const v = parseFloat(e.target.value); if (!isNaN(v)) set("skew", Math.min(60, Math.max(0, v))); }}
                  style={{ width: 50, background: "rgba(255,255,255,0.07)", border: "none", borderRadius: 3, color: "#fff", fontSize: 10, textAlign: "right", padding: "1px 5px", outline: "none", fontFamily: "inherit" }}
                />
              </div>
            </div>
            <input type="range" min={0} max={60} step={1} value={config.skew}
              onChange={(e) => set("skew", parseFloat(e.target.value))}
              style={{ width: "100%", accentColor: "#6ee7b7", cursor: "pointer" }} />
          </div>
        </div>
      )}
    </div>
  );
}

export default function TweakPanel({ overrides, onChange, zoom, onZoomChange, edgeVignette, onEdgeVignetteChange, lightingConfig, onLightingChange, reflectionConfig, onReflectionChange, parallaxConfig, onParallaxChange }) {
  const [copied, setCopied] = useState(false);
  const [panelCollapsed, setPanelCollapsed] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [mirrored, setMirrored] = useState(true);

  if (hidden) {
    return (
      <button
        onWheel={(e) => e.stopPropagation()}
        onClick={() => setHidden(false)}
        style={{
          position: "fixed",
          bottom: 16,
          right: 16,
          zIndex: 9999,
          background: "rgba(10,10,10,0.85)",
          border: "1px solid rgba(255,255,255,0.15)",
          borderRadius: 6,
          color: "#f9f229",
          fontFamily: "ui-monospace, 'Cascadia Code', 'Fira Mono', monospace",
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: "0.06em",
          padding: "6px 10px",
          cursor: "pointer",
        }}
      >
        ✦ TWEAKS
      </button>
    );
  }

  const handleFieldChange = (slot, key, value) => {
    onChange((prev) => {
      const next = { ...prev, [slot]: { ...prev[slot], [key]: value } };
      // If mirrored and this is a LEFT slot, sync the corresponding RIGHT slot
      const rightSlot = MIRROR_PAIRS[slot];
      if (mirrored && rightSlot) {
        const mirroredValue = NEGATED_FIELDS.has(key) ? -value : value;
        next[rightSlot] = { ...prev[rightSlot], [key]: mirroredValue };
      }
      return next;
    });
  };

  const handleReset = () => {
    onChange(buildInitialOverrides());
    onZoomChange(1.40);
    onEdgeVignetteChange({ opacity: 0.70, spread: 26, falloff: 0.5 });
    onLightingChange(LIGHTING_DEFAULTS);
    onReflectionChange(REFLECTION_DEFAULTS);
    onParallaxChange(PARALLAX_DEFAULTS);
  };

  const handleCopy = () => {
    const text = buildExportString(overrides, zoom, edgeVignette, lightingConfig);
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  // In mirrored mode only show LEFT slots; otherwise show all
  const visibleSlots = mirrored
    ? ["LEFT_HIDDEN", "LEFT_FAR", "LEFT_NEAR"]
    : TUNABLE_SLOTS;

  return (
    <div style={PANEL_STYLE} onWheel={(e) => e.stopPropagation()}>
      {/* Header bar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0 14px 10px",
          borderBottom: "1px solid rgba(255,255,255,0.08)",
          marginBottom: 6,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ color: "#f9f229", fontWeight: 700, fontSize: 11, letterSpacing: "0.06em" }}>
            ✦ SLOT TWEAKS
          </span>
          <span style={{ color: "#444", fontSize: 10 }}>dev only</span>
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          <button onClick={() => setPanelCollapsed((c) => !c)} style={btnStyle}>
            {panelCollapsed ? "expand" : "min"}
          </button>
          <button onClick={() => setHidden(true)} style={btnStyle}>
            hide
          </button>
        </div>
      </div>

      {!panelCollapsed && (
        <>
          {/* Global zoom */}
          <div style={{ padding: "8px 14px 12px", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
              <span style={{ color: "#fff", fontSize: 10.5, fontWeight: 700, letterSpacing: "0.04em" }}>ZOOM</span>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ color: "#888", fontSize: 10 }}>{zoom.toFixed(2)}×</span>
                <button
                  onClick={() => onZoomChange(1)}
                  style={{ ...btnStyle, padding: "2px 6px", fontSize: 9, color: zoom === 1 ? "#555" : "#aaa" }}
                >
                  reset
                </button>
              </div>
            </div>
            <input
              type="range"
              min={0.4}
              max={1.6}
              step={0.01}
              value={zoom}
              onChange={(e) => onZoomChange(parseFloat(e.target.value))}
              style={{ width: "100%", accentColor: "#f9f229", cursor: "pointer" }}
            />
          </div>

          {/* Edge vignette */}
          <div style={{ padding: "8px 14px 12px", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
              <span style={{ color: "#fff", fontSize: 10.5, fontWeight: 700, letterSpacing: "0.04em" }}>EDGE VIGNETTE</span>
              <button
                onClick={() => onEdgeVignetteChange({ opacity: 0.72, spread: 18, falloff: 0.5 })}
                style={{ ...btnStyle, padding: "2px 6px", fontSize: 9 }}
              >
                reset
              </button>
            </div>
            {/* Darkness */}
            <div style={{ marginBottom: 7 }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
                <span style={{ color: "#888", fontSize: 10 }}>darkness</span>
                <span style={{ color: "#aaa", fontSize: 10 }}>{edgeVignette.opacity.toFixed(2)}</span>
              </div>
              <input
                type="range" min={0} max={1} step={0.01}
                value={edgeVignette.opacity}
                onChange={(e) => onEdgeVignetteChange((prev) => ({ ...prev, opacity: parseFloat(e.target.value) }))}
                style={{ width: "100%", accentColor: "#f9f229", cursor: "pointer" }}
              />
            </div>
            {/* Spread */}
            <div style={{ marginBottom: 7 }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
                <span style={{ color: "#888", fontSize: 10 }}>spread</span>
                <span style={{ color: "#aaa", fontSize: 10 }}>{edgeVignette.spread}%</span>
              </div>
              <input
                type="range" min={0} max={50} step={1}
                value={edgeVignette.spread}
                onChange={(e) => onEdgeVignetteChange((prev) => ({ ...prev, spread: parseFloat(e.target.value) }))}
                style={{ width: "100%", accentColor: "#f9f229", cursor: "pointer" }}
              />
            </div>
            {/* Falloff */}
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
                <span style={{ color: "#888", fontSize: 10 }}>falloff</span>
                <span style={{ color: "#555", fontSize: 9 }}>
                  {edgeVignette.falloff < 0.35 ? "abrupt" : edgeVignette.falloff > 0.65 ? "lingering" : "linear"}
                </span>
              </div>
              <input
                type="range" min={0} max={1} step={0.01}
                value={edgeVignette.falloff}
                onChange={(e) => onEdgeVignetteChange((prev) => ({ ...prev, falloff: parseFloat(e.target.value) }))}
                style={{ width: "100%", accentColor: "#f9f229", cursor: "pointer" }}
              />
            </div>
          </div>

          {/* Mirror toggle */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "6px 14px 10px",
              borderBottom: "1px solid rgba(255,255,255,0.06)",
              marginBottom: 2,
            }}
          >
            <span style={{ color: "#888", fontSize: 10 }}>
              Mirror L ↔ R
              {mirrored && <span style={{ color: "#555", marginLeft: 6 }}>x & rotateY auto-negated</span>}
            </span>
            <button
              onClick={() => setMirrored((m) => !m)}
              style={{
                ...btnStyle,
                color: mirrored ? "#f9f229" : "#aaa",
                borderColor: mirrored ? "#f9f229" : "rgba(255,255,255,0.2)",
              }}
            >
              {mirrored ? "on" : "off"}
            </button>
          </div>

          {visibleSlots.map((slot) => (
            <SlotSection
              key={slot}
              slot={slot}
              values={overrides[slot]}
              onChange={handleFieldChange}
              mirrored={mirrored && !!MIRROR_PAIRS[slot]}
              mirrorLabel={`${SLOT_SHORT[slot]}  ·  L + R`}
            />
          ))}

          {/* Lighting */}
          {lightingConfig && (
            <LightingSection config={lightingConfig} onChange={onLightingChange} />
          )}

          {/* Reflection */}
          {reflectionConfig && (
            <ReflectionSection config={reflectionConfig} onChange={onReflectionChange} />
          )}

          {/* Parallax */}
          {parallaxConfig && (
            <ParallaxSection config={parallaxConfig} onChange={onParallaxChange} />
          )}

          {/* Action bar */}
          <div style={{ display: "flex", gap: 8, padding: "14px 14px 0" }}>
            <button onClick={handleReset} style={{ ...btnStyle, flex: 1 }}>
              reset
            </button>
            <button
              onClick={handleCopy}
              style={{ ...btnStyle, flex: 2, color: copied ? "#7effb2" : "#f9f229", borderColor: copied ? "#7effb2" : "#f9f229" }}
            >
              {copied ? "✓ copied!" : "copy PANEL_STATES"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

export { buildInitialOverrides };

const btnStyle = {
  background: "none",
  border: "1px solid rgba(255,255,255,0.2)",
  borderRadius: 4,
  color: "#aaa",
  fontSize: 10,
  padding: "4px 8px",
  cursor: "pointer",
  fontFamily: "inherit",
  letterSpacing: "0.03em",
};
