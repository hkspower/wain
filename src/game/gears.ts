// Gearbox shift points by speed (km/h) — single source of truth for the
// HUD tach/gear readout and the engine-sound RPM model. Deliberately free
// of three.js imports so the HUD can use it without pulling in the engine.
export const GEARS = [0, 55, 95, 145, 200, 260, 320];
