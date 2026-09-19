function basenameStart(path: string) {
  const slash = path.lastIndexOf("/");
  return slash < 0 ? 0 : slash + 1;
}

function isBoundary(path: string, index: number, baseStart: number) {
  if (index === baseStart) return true;
  if (index === 0) return false;
  const prev = path[index - 1];
  return prev === "/" || prev === "." || prev === "-" || prev === "_";
}

function tokens(query: string) {
  const trimmed = String(query).trim();
  if (!trimmed) return [];
  return trimmed.split(/\s+/);
}

function isSubsequence(q: string, s: string) {
  let qi = 0;
  for (let i = 0; i < s.length && qi < q.length; i++) {
    if (s[i] === q[qi]) qi += 1;
  }
  return qi === q.length;
}

function greedyFrom(q: string, s: string, start: number) {
  if (s[start] !== q[0]) return null;
  const matches = [start];
  let qi = 1;
  for (let i = start + 1; i < s.length && qi < q.length; i++) {
    if (s[i] === q[qi]) {
      matches.push(i);
      qi += 1;
    }
  }
  if (qi < q.length) return null;
  return matches;
}

function scoreMatches(path: string, matches: number[]) {
  const baseStart = basenameStart(path);
  let total = 0;
  let prev = -2;
  for (let i = 0; i < matches.length; i++) {
    const index = matches[i];
    total += 1;
    if (index === prev + 1) total += 4;
    if (isBoundary(path, index, baseStart)) total += 6;
    if (index >= baseStart) total += 8;
    prev = index;
  }
  return total;
}

type ScoredMatch = { score: number; matches: number[] };

function isBetter(a: ScoredMatch, b: ScoredMatch) {
  if (a.score !== b.score) return a.score > b.score;
  if (a.matches[0] !== b.matches[0]) return a.matches[0] > b.matches[0];
  const spanA = a.matches[a.matches.length - 1] - a.matches[0];
  const spanB = b.matches[b.matches.length - 1] - b.matches[0];
  if (spanA !== spanB) return spanA < spanB;
  const n = Math.min(a.matches.length, b.matches.length);
  for (let i = 0; i < n; i++) {
    if (a.matches[i] !== b.matches[i]) return a.matches[i] < b.matches[i];
  }
  return a.matches.length < b.matches.length;
}

function pickBest(
  q: string,
  haystack: string,
  path: string,
  offset: number,
): ScoredMatch | null {
  let best: ScoredMatch | null = null;
  for (let i = 0; i < haystack.length; i++) {
    if (haystack[i] !== q[0]) continue;
    const local = greedyFrom(q, haystack, i);
    if (!local) continue;
    const matches = local.map((index) => index + offset);
    const candidate = { score: scoreMatches(path, matches), matches };
    if (!best || isBetter(candidate, best)) best = candidate;
  }
  return best;
}

function scoreToken(token: string, path: string): ScoredMatch | null {
  const q = String(token).toLowerCase();
  const full = String(path).toLowerCase();
  const baseStart = basenameStart(path);
  const base = full.slice(baseStart);
  if (isSubsequence(q, base)) return pickBest(q, base, path, baseStart);
  if (isSubsequence(q, full)) return pickBest(q, full, path, 0);
  return null;
}

export function score(
  query: string,
  path: string,
): { score: number; matches: number[] } | null {
  const parts = tokens(query);
  if (!parts.length) return null;
  let total = 0;
  const matches: number[] = [];
  for (let i = 0; i < parts.length; i++) {
    const hit = scoreToken(parts[i], path);
    if (!hit) return null;
    total += hit.score;
    for (let j = 0; j < hit.matches.length; j++) matches.push(hit.matches[j]);
  }
  matches.sort((a, b) => a - b);
  const unique: number[] = [];
  for (let i = 0; i < matches.length; i++) {
    if (i === 0 || matches[i] !== matches[i - 1]) unique.push(matches[i]);
  }
  return { score: total, matches: unique };
}

export function filter(
  query: string,
  paths: string[],
  recents?: string[],
): { path: string; score: number; matches: number[] }[] {
  if (!tokens(query).length) return [];
  const recentList = recents || [];
  const results: { path: string; score: number; matches: number[] }[] = [];
  for (let i = 0; i < paths.length; i++) {
    const path = paths[i];
    const hit = score(query, path);
    if (!hit) continue;
    const recentIndex = recentList.indexOf(path);
    const boost = recentIndex >= 0 ? 20 - recentIndex : 0;
    results.push({ path, score: hit.score + boost, matches: hit.matches });
  }
  results.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (a.path < b.path) return -1;
    if (a.path > b.path) return 1;
    return 0;
  });
  return results.slice(0, 50);
}
