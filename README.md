# 3D Holographic Gesture Drawing

A real-time, webcam-based holographic drawing application that lets you paint glowing 3D strokes in mid-air using only hand gestures — no mouse, keyboard, or controller required.

## Description

3D Holographic Gesture Drawing uses a webcam and Google's MediaPipe Hands model to track up to two hands in real time, then maps their 21 joint landmarks into a 3D space rendered with Three.js. Pinch your thumb and index finger to draw luminous, neon-style strokes that float in front of the camera; the canvas itself can be panned, rotated, and scaled in 3D with two-hand gestures.

A floating "holographic" toolbox — animated with spring physics — provides color selection, an eraser, a laser pointer, a draw/navigate mode toggle, and a clear-canvas action. Strokes are rendered in three additive layers (a crisp core line plus two animated glow point clouds), giving the drawings a distinctive hologram shimmer that responds to hand speed.

**Supported gestures:**

| Gesture | Action |
|---|---|
| Pinch (thumb + index) | Draw in 3D space |
| L-shape (thumb + index extended) | Adjust brush size (distance between fingertips) |
| Fist | Stop drawing |
| Double open-palm push | Reset canvas position/rotation/scale |
| Rapid side-to-side wipe | Clear all strokes |
| Middle-finger pinch | Toggle draw / navigate mode |
| Pinch + drag from top of screen | Pull down the holographic toolbox |
| Navigate mode — pinch & drag | Pan |
| Navigate mode — open palm | Rotate canvas |
| Navigate mode — dual-hand pinch | Scale + rotate |

**Keyboard shortcuts:** `C` clear · `Esc` reset view · `M` toggle mode · `[` / `]` brush size · `E` toggle toolbox

## Tech Stack

- **HTML5 / CSS3 / Vanilla JavaScript (ES modules)** — no frameworks, no build step
- **Three.js 0.160** — WebGL 3D rendering (scene, camera, additive glow materials)
- **MediaPipe Hands 0.4** — real-time hand landmark tracking (21 landmarks per hand, 2 hands)
- **MediaPipe Camera Utils** — webcam feed handling
- **WebRTC `getUserMedia`** — camera capture with automatic resolution negotiation (up to 4K)

## How to Run

**Requirements:** a modern browser (Chrome or Edge recommended), a webcam, and an internet connection (dependencies are loaded from CDNs).

1. **Serve the project over HTTP.** ES module imports and import maps do not work from `file://`, so open the folder with any static server, for example:

   ```bash
   cd 3d-holographic-drawing
   python -m http.server 8000
   # or: npx serve .
   ```

   (VS Code's *Live Server* extension also works.)

2. **Open** `http://localhost:8000` in your browser.

3. **Allow camera access** when prompted.

4. Face the camera and use the gestures listed above to draw. The status bar at the top confirms when the system is ready or if the camera failed to connect.

> **Note:** Camera access requires a secure context. `localhost` qualifies, but if you serve the page over plain HTTP on a remote machine you will need HTTPS.

## Future Improvements

This project was originally built as a Year 1 group project, and while it works well as a demo, a few areas would benefit from a more production-minded approach:

1. **Architecture & maintainability.** The entire application — gesture detection, scene management, toolbox UI, state handling, and the render loop — lives in a single ~1400-line `main.js`. Splitting it into focused modules (a gesture engine, a scene manager, a UI component, a state store) with a lightweight build tool (e.g. Vite) would make the code far easier to test and extend. Gesture recognition is also entirely heuristic: fingers are classified by comparing landmark Y-coordinates against hard-coded thresholds, which is fragile across different hand sizes, angles, and lighting. A more robust approach would be a state machine with hysteresis, or a trained gesture classifier.

2. **Performance & reliability.** Dependencies are pinned to specific CDN versions, so the demo requires internet access and could break if the CDN entry changes; bundling them locally would make the project self-contained and portable. On the rendering side, each stroke maintains three full point buffers and the glow layers are recomputed point-by-point every 150 ms — switching to GPU instancing or a custom shader would scale to far longer drawing sessions, and the eraser's O(n) point-by-point sweep could be replaced with spatial indexing (e.g. an octree).
