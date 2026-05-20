function normalize(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  let previous: number[] = Array.from({ length: b.length + 1 }, (_, index) => index);

  for (let i = 0; i < a.length; i++) {
    const current: number[] = [i + 1];
    for (let j = 0; j < b.length; j++) {
      const cost = a[i] === b[j] ? 0 : 1;
      current.push(Math.min(previous[j + 1] + 1, current[j] + 1, previous[j] + cost));
    }
    previous = current;
  }

  return previous[b.length];
}

export function similarity(a: string, b: string): number {
  const na = normalize(a);
  const nb = normalize(b);
  if (na === nb) return 1;
  const maxLen = Math.max(na.length, nb.length);
  if (maxLen === 0) return 1;
  return 1 - levenshtein(na, nb) / maxLen;
}

export function isExactMatch(a: string, b: string): boolean {
  return normalize(a) === normalize(b);
}

export type FuzzyMatch = { name: string; score: number };

function tokenOverlap(a: string, b: string): number {
  const tokensA = new Set(normalize(a).split(" ").filter(Boolean));
  const tokensB = new Set(normalize(b).split(" ").filter(Boolean));
  if (tokensA.size === 0 || tokensB.size === 0) return 0;
  let overlap = 0;
  for (const token of tokensA) if (tokensB.has(token)) overlap++;
  return overlap / Math.min(tokensA.size, tokensB.size);
}

function fuzzyScore(input: string, candidate: string): number {
  const ni = normalize(input);
  const nc = normalize(candidate);
  if (ni === nc) return 1;
  if (ni.length === 0 || nc.length === 0) return 0;
  const lev = similarity(ni, nc);
  const overlap = tokenOverlap(ni, nc);
  const contains = nc.includes(ni) || ni.includes(nc) ? 0.85 : 0;
  // Take the best signal — substring containment dominates, then token overlap,
  // then plain edit-distance similarity as a fallback for typos.
  return Math.max(lev, overlap, contains);
}

export function findClosestMember(input: string, members: string[]): FuzzyMatch | null {
  let best: FuzzyMatch | null = null;
  for (const member of members) {
    const score = fuzzyScore(input, member);
    if (!best || score > best.score) {
      best = { name: member, score };
    }
  }
  return best;
}
