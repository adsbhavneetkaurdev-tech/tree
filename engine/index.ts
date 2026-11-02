/**
 * The Christmas Wish Tree visual engine.
 *
 * Framework-agnostic: give it a <canvas> and a list of wishes. Everything is
 * drawn in a fixed 1920×1080 logical space, so the same output can feed a
 * browser window, a corner-pinned projector, or `canvas.captureStream()` into
 * projection-mapping software (Resolume, MadMapper, TouchDesigner via NDI/Spout).
 */
export { WishTreeEngine, LOGICAL_W, LOGICAL_H, type EngineOptions, type EngineWish } from "./engine";
export { DEFAULT_TREE, type TreeGeometry } from "./tree";
export { cornerPinMatrix, rectCorners, type Corners, type Point } from "./projection";
export { identityFor, type OrnamentIdentity } from "./ornaments";
