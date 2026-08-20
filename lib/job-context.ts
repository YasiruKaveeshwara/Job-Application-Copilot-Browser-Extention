import type { JobContext } from './types';
import { PAGE_TEXT_BUDGET } from './field-detector';

// Deliberately thin. Real parsing of the job description (title, seniority,
// requirements) happens inside the LLM prompt in Phase 11 — a bespoke
// rules-based parser here would be strictly worse than what the model does.

/**
 * Role-family buckets for known title variants. Used only as a fast local hint
 * appended to the prompt, and as the role-family component of the Phase 15
 * cache key. Never a hard classifier: an unrecognized title passes through
 * untouched rather than being forced into a bucket.
 */
export const ROLE_FAMILY_SYNONYMS: Record<string, string[]> = {
  'software-engineer': [
    'software engineer',
    'software developer',
    'associate software engineer',
    'junior software engineer',
    'senior software engineer',
    'software engineer i',
    'software engineer ii',
    'sde',
    'swe',
    'programmer',
  ],
  'full-stack-engineer': [
    'full stack developer',
    'full stack engineer',
    'fullstack developer',
    'fullstack engineer',
    'full-stack developer',
    'full-stack engineer',
  ],
  'frontend-engineer': [
    'frontend developer',
    'frontend engineer',
    'front end developer',
    'front-end developer',
    'front-end engineer',
    'ui engineer',
    'web developer',
    'web engineer',
  ],
  'backend-engineer': [
    'backend developer',
    'backend engineer',
    'back end developer',
    'back-end developer',
    'back-end engineer',
    'server side developer',
  ],
  'mobile-engineer': [
    'mobile developer',
    'mobile engineer',
    'android developer',
    'ios developer',
    'react native developer',
    'flutter developer',
  ],
  'data-engineer': ['data engineer', 'etl developer', 'analytics engineer'],
  'ml-engineer': [
    'machine learning engineer',
    'ml engineer',
    'ai engineer',
    'data scientist',
    'research engineer',
  ],
  'devops-engineer': [
    'devops engineer',
    'site reliability engineer',
    'sre',
    'platform engineer',
    'cloud engineer',
    'infrastructure engineer',
  ],
  'qa-engineer': [
    'qa engineer',
    'quality assurance engineer',
    'test engineer',
    'sdet',
    'automation engineer',
  ],
  intern: ['intern', 'software engineering intern', 'trainee', 'internship'],
};

/** Lower-case, strip punctuation and collapse whitespace for matching. */
function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9+#\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Best-effort role-family bucket for a title.
 *
 * Returns `null` when nothing matches, so callers can fall back to the raw
 * title rather than acting on a wrong bucket. Longer synonyms are preferred so
 * "associate software engineer" isn't shadowed by "software engineer", and
 * "full stack engineer" doesn't collapse into the generic bucket.
 */
export function normalizeRoleFamily(title: string): string | null {
  const normalized = normalizeTitle(title);
  if (!normalized) return null;

  let bestFamily: string | null = null;
  let bestLength = 0;

  for (const [family, synonyms] of Object.entries(ROLE_FAMILY_SYNONYMS)) {
    for (const synonym of synonyms) {
      if (synonym.length <= bestLength) continue;
      // Word-boundary match so "sre" doesn't match inside "stressed".
      const pattern = new RegExp(`(^|\\s)${synonym.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|\\s)`);
      if (pattern.test(normalized)) {
        bestFamily = family;
        bestLength = synonym.length;
      }
    }
  }
  return bestFamily;
}

/**
 * A short hint line for the prompt. Never authoritative — the model still reads
 * the full job text and may disagree.
 */
export function roleFamilyHint(pageTitle: string): string {
  const family = normalizeRoleFamily(pageTitle);
  return family ? `Likely role family (local hint, may be wrong): ${family}` : '';
}

function collapse(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * Assemble the job context. Mostly pass-through: normalize whitespace and cap
 * the raw text at the same budget the detector uses.
 */
export function buildJobContext(rawText: string, url: string, pageTitle: string): JobContext {
  const collapsed = collapse(rawText);
  return {
    rawText:
      collapsed.length <= PAGE_TEXT_BUDGET
        ? collapsed
        : collapsed.slice(0, PAGE_TEXT_BUDGET).trimEnd(),
    url: url.trim(),
    pageTitle: collapse(pageTitle),
  };
}

/** Site domain for cache keys and learned mappings. Empty string if unparseable. */
export function extractDomain(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}
