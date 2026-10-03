// Calibration maths. Conventions: corners A (X-min,Y-min), B (X-max,Y-min), C (X-max,Y-max), D (X-min,Y-max);
// "delta" is how far the X-max side of the gantry must move to come true, and the two motors split it.
const MIN_PULLOFF = 1 // mm: FluidNC needs some pull-off to release the switch

export const skew = ({ ac, bd, w, h }) => (ac * ac - bd * bd) / (4 * w * h)

export const tilt = ({ zMin, zMax, xMin, xMax }) => (zMax - zMin) / (xMax - xMin)

export const stepsPerMm = (current, commanded, measured) => (current * commanded) / measured

export function splitPulloff({ p0, p1, delta, motor0AtXmax }) {
  // Pull-off moves a motor away from its switch. The X-max side sits `delta` too far from its switch,
  // so its motor pulls off less by half of that and the other motor more, keeping the origin where it is.
  const half = delta / 2
  let n0 = p0 + (motor0AtXmax ? -half : half)
  let n1 = p1 + (motor0AtXmax ? half : -half)
  const lift = MIN_PULLOFF - Math.min(n0, n1)
  if (lift > 0) { n0 += lift; n1 += lift }
  return [round(n0), round(n1)]
}

export const axisRange = ({ maxTravel, mposMm, positive }) =>
  positive ? { min: mposMm - maxTravel, max: mposMm } : { min: mposMm, max: mposMm + maxTravel }

const round = v => Math.round(v * 1000) / 1000
