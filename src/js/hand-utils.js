/** Normalize MLB/app hand codes to LHP/RHP (pitcher) or LHB/RHB (batter). */

function isLeftHandCode(hand) {
  const h = String(hand || '').toUpperCase().trim();
  if (!h) return false;
  if (h === 'L' || h === 'LHB' || h === 'LHP' || h === 'LEFT') return true;
  if (h.startsWith('L ') || h.startsWith('L/') || h.startsWith('L-')) return true;
  if (h.includes('LEFT')) return true;
  return false;
}

export function normalizeRoleHand(hand, role) {
  const isPitcher = role === 'pitcher';
  return isLeftHandCode(hand) ? (isPitcher ? 'LHP' : 'LHB') : (isPitcher ? 'RHP' : 'RHB');
}

export function isLeftHanded(hand) {
  return isLeftHandCode(hand);
}

export { isLeftHandCode };

export function formatHandForPopout(hand, role) {
  return normalizeRoleHand(hand, role);
}

export function handPopoutLabel(role) {
  return role === 'pitcher' ? 'Throws' : 'Bats';
}
