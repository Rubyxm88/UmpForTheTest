// Ball radius in feet (circumference 9.125 inches -> radius 1.45 inches -> 0.12 feet)
export const BALL_RADIUS = 0.12;

// Home plate width in feet (17 inches -> 1.4167 feet)
export const PLATE_WIDTH = 1.4167;
export const PLATE_HALF_WIDTH = PLATE_WIDTH / 2;
// Midpoint/breakpoint of home plate in feet from apex (8.5 inches -> 0.7083 feet)
// In MLB ABS systems, the strike zone is evaluated at the midpoint/breakpoint of the plate.
export const PLATE_MIDPOINT_Z = 0.7083;
// ABS evaluates whether any part of the ball grazes the zone (center ± ball radius).
export const ABS_HALF_WIDTH = PLATE_HALF_WIDTH + BALL_RADIUS;
export const BORDERLINE_FT = 0.15;

/**
 * Returns the extended ABS strike-zone bounds at the plate midpoint.
 */
export function getABSZoneBounds(sz_bot, sz_top) {
  return {
    xMin: -ABS_HALF_WIDTH,
    xMax: ABS_HALF_WIDTH,
    yMin: sz_bot - BALL_RADIUS,
    yMax: sz_top + BALL_RADIUS,
  };
}

/**
 * Signed distance from ball center to the ABS zone boundary (feet).
 * Negative = inside (strike), positive = outside (ball).
 */
export function getDistanceToABSZone(x, y, sz_bot, sz_top) {
  const { xMin, xMax, yMin, yMax } = getABSZoneBounds(sz_bot, sz_top);
  const dx = Math.max(0, xMin - x, x - xMax);
  const dy = Math.max(0, yMin - y, y - yMax);

  if (dx === 0 && dy === 0) {
    const distToLeft = x - xMin;
    const distToRight = xMax - x;
    const distToBottom = y - yMin;
    const distToTop = yMax - y;
    return -Math.min(distToLeft, distToRight, distToBottom, distToTop);
  }
  return Math.sqrt(dx * dx + dy * dy);
}

/** Consistent inches + IN/OUT label used across all ABS readouts. */
export function formatAbsZoneDistance(distFt) {
  const absDist = Math.abs(distFt);
  const inches = absDist * 12;
  const inchStr = inches < 0.1 ? '<0.1' : inches.toFixed(1);
  return `${inchStr}″ ${distFt < 0 ? 'IN' : 'OUT'}`;
}

/** Short zone status for compact UI fields. */
export function formatAbsZoneLocation(distFt) {
  const absDist = Math.abs(distFt);
  if (absDist <= BORDERLINE_FT) {
    return distFt < 0 ? 'BORDERLINE IN' : 'BORDERLINE OUT';
  }
  return distFt < 0 ? 'IN ZONE' : 'OUT OF ZONE';
}

/**
 * Calculates the ball's position (x, y, z) at a given time t (seconds)
 * using the standard constant acceleration model.
 * 
 * Note: Swaps Statcast (x, y, z) coordinates to Three.js coordinates:
 * - Three.js X = Statcast X (horizontal)
 * - Three.js Y = Statcast Z (vertical height)
 * - Three.js Z = Statcast Y (distance from apex)
 * 
 * @param {Object} pitch - The pitch data containing initial parameters
 * @param {number} t - Time in seconds
 * @returns {Object} {x, y, z} position in Three.js coordinates
 */
export function getBallPositionAtTime(pitch, t) {
  // Statcast X coordinate (negated to match our un-mirrored camera layout where +X is screen-left)
  const x = -(pitch.release_pos_x + pitch.vx0 * t + 0.5 * pitch.ax * Math.pow(t, 2));
  
  // Statcast Y coordinate (Distance): y(t) = y0 + vy0 * t + 0.5 * ay * t^2
  const z = pitch.release_pos_y + pitch.vy0 * t + 0.5 * pitch.ay * Math.pow(t, 2);
  
  // Statcast Z coordinate (Height): z(t) = z0 + vz0 * t + 0.5 * az * t^2
  const y = pitch.release_pos_z + pitch.vz0 * t + 0.5 * pitch.az * Math.pow(t, 2);

  return { x, y, z };
}

/**
 * Solves the quadratic equation to find the exact time (t) in seconds when 
 * the ball crosses the home plate midpoint breakpoint (Statcast y = 0.7083 feet).
 * 
 * Equation to solve:
 * 0.5 * ay * t^2 + vy0 * t + (y0 - 0.7083) = 0
 * 
 * @param {Object} pitch - The pitch data
 * @returns {number} Time in seconds
 */
export function getCrossingTime(pitch) {
  const a = 0.5 * pitch.ay;
  const b = pitch.vy0; // vy0 is the velocity towards plate
  const c = pitch.release_pos_y - PLATE_MIDPOINT_Z;

  // Handle case where acceleration is zero (linear motion)
  if (Math.abs(a) < 0.0001) {
    return c / -b;
  }

  // Quadratic formula: t = (-b - sqrt(b^2 - 4*a*c)) / (2*a)
  const discriminant = Math.pow(b, 2) - 4 * a * c;
  
  if (discriminant < 0) {
    return c / -b;
  }

  return (-b - Math.sqrt(discriminant)) / (2 * a);
}
/**
 * Determines if the pitch is a strike according to the Automated Ball-Strike (ABS) rule.
 * The rule dictates that if ANY part of the ball touches the 3D strike zone, it is a strike.
 * This is equivalent to checking if the center of the ball is within the strike zone extended
 * by the ball's radius in all directions at the moment it crosses the front plate.
 * 
 * @param {Object} pitch - The pitch data containing sz_top and sz_bot
 * @param {Object} crossPos - The {x, y, z} position at the front of home plate
 * @returns {boolean} True if strike, False if ball
 */
export function isStrikeABS(pitch, crossPos) {
  const szTop = pitch.sz_top ?? 3.4;
  const szBot = pitch.sz_bot ?? 1.6;
  return getDistanceToABSZone(crossPos.x, crossPos.y, szBot, szTop) < 0;
}

/**
 * Calculates the total flight path coordinates of the ball from release point (t=0)
 * to catcher's glove (t_catcher).
 * 
 * @param {Object} pitch - The pitch data
 * @param {number} step - Step size in seconds
 * @returns {Array} List of {x, y, z} positions along the trajectory
 */
export function calculateTrajectoryPoints(pitch, step = 0.01) {
  const t_cross = getCrossingTime(pitch);
  // Add a small extra duration so the trajectory line extends to the catcher mitt
  const t_end = t_cross + 0.05; 
  
  const points = [];
  for (let t = 0; t <= t_end; t += step) {
    points.push(getBallPositionAtTime(pitch, t));
  }
  
  // Make sure the exact crossing point is included
  const crossPoint = getBallPositionAtTime(pitch, t_cross);
  points.push(crossPoint);
  
  // Sort points by z descending (since ball goes from pitcher z=55+ to catcher z<0)
  points.sort((a, b) => b.z - a.z);

  return {
    points,
    t_cross,
    t_end,
    crossPoint
  };
}

/**
 * Resolves a pitch crossing trajectory from stored history or raw Statcast fields.
 */
export function resolvePitchTrajectory(pitch, trajectory) {
  if (trajectory?.crossPoint) return trajectory;
  if (pitch?.pitchTrajectory?.crossPoint) return pitch.pitchTrajectory;
  if (pitch?.release_pos_x != null && pitch?.vy0 != null) {
    return calculateTrajectoryPoints(pitch);
  }
  return null;
}

/** Plate-crossing {x, y, z} for chart markers and ABS distance readouts. */
export function getPitchCrossPoint(pitch, trajectory) {
  return resolvePitchTrajectory(pitch, trajectory)?.crossPoint ?? null;
}
