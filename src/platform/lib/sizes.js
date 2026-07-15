'use strict';

// Replica-size catalogue. Maps the three hackathon sizes (and a few friendly aliases)
// to ACA container resource requests. Express supports Consumption CPU/memory pairs.
const SIZES = {
  '1cpu2ram': { cpu: 1.0, memory: '2.0Gi', label: '1 vCPU / 2 GiB' },
  '2cpu4ram': { cpu: 2.0, memory: '4.0Gi', label: '2 vCPU / 4 GiB' },
  '4cpu8ram': { cpu: 4.0, memory: '8.0Gi', label: '4 vCPU / 8 GiB' },
};

const ALIASES = {
  small: '1cpu2ram',
  s: '1cpu2ram',
  medium: '2cpu4ram',
  m: '2cpu4ram',
  large: '4cpu8ram',
  l: '4cpu8ram',
  '1': '1cpu2ram',
  '2': '2cpu4ram',
  '4': '4cpu8ram',
};

function normalizeSize(input, fallback) {
  if (!input) return fallback;
  const key = String(input).toLowerCase().replace(/\s+/g, '');
  if (SIZES[key]) return key;
  if (ALIASES[key]) return ALIASES[key];
  return null; // unknown
}

function resourcesFor(sizeKey) {
  const s = SIZES[sizeKey];
  return { cpu: s.cpu, memory: s.memory };
}

module.exports = { SIZES, normalizeSize, resourcesFor };
