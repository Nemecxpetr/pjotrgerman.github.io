/**
 * Shared math and color helpers for canvas systems.
 */

/**
 * Clamp a number to the [0, 1] interval.
 * @param {number} value
 * @returns {number}
 */
export function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

/**
 * Linear interpolation.
 * @param {number} start
 * @param {number} end
 * @param {number} t Usually in [0, 1]
 * @returns {number}
 */
export function lerp(start, end, t) {
  return start + (end - start) * t;
}

/**
 * Build an rgba(...) CSS color string from an "r,g,b" string + alpha.
 * @param {string} rgb Example: "29,170,218"
 * @param {number} alpha
 * @returns {string}
 */
export function rgba(rgb, alpha) {
  const a = clamp01(alpha);
  return `rgba(${rgb}, ${a})`;
}
