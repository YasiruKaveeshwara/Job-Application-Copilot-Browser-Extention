import type { DetectedField, JobContext, ProfileData } from './types';

// Picks the profile fragments most worth putting in the prompt for one field.
//
// Keyword scoring only: BM25-style term weighting over the user's own fragments.
// No embeddings, no network, no external index. At the scale of one person's
// profile (tens of fragments, not millions of documents) lexical overlap is
// already a strong signal, and an embedding call per field would cost more than
// the generation it feeds.

/** Fragments returned per field unless the caller asks for a different number. */
export const DEFAULT_K = 3;

/**
 * How many distinct job-description terms a fragment must match to qualify on
 * job-context evidence alone.
 *
 * The relevance bar is deliberately expressed as term coverage rather than a
 * score floor: BM25 scores scale with corpus size and query length, so an
 * absolute cutoff that behaved sensibly for a full profile would reject
 * everything for a profile with three fragments in it.
 */
export const MIN_JOB_CONTEXT_MATCHES = 3;

// Query term weights by where the term came from. The field's own label is the
// strongest evidence of what is being asked; the job description is the weakest,
// being about the role in general rather than this field.
const WEIGHT_LABEL = 3;
const WEIGHT_SURROUNDING_TEXT = 1.5;
const WEIGHT_PAGE_TITLE = 1;
const WEIGHT_JOB_TEXT = 0.5;

/** At or above this weight, a single matched term is enough to clear the bar. */
const STRONG_WEIGHT = WEIGHT_PAGE_TITLE;

// Standard BM25 constants: k1 controls how fast repeated terms stop helping, b
// how much long fragments are penalized for their length.
const BM25_K1 = 1.2;
const BM25_B = 0.75;

/** English function words, dropped from both queries and fragments. */
const FUNCTION_WORDS = [
  'a',
  'about',
  'after',
  'again',
  'all',
  'also',
  'an',
  'and',
  'any',
  'are',
  'as',
  'at',
  'be',
  'been',
  'before',
  'being',
  'both',
  'but',
  'by',
  'can',
  'could',
  'did',
  'do',
  'does',
  'doing',
  'during',
  'each',
  'few',
  'for',
  'from',
  'had',
  'has',
  'have',
  'having',
  'he',
  'her',
  'hers',
  'him',
  'his',
  'how',
  'if',
  'in',
  'into',
  'is',
  'it',
  'its',
  'me',
  'more',
  'most',
  'my',
  'no',
  'nor',
  'not',
  'of',
  'on',
  'one',
  'only',
  'or',
  'other',
  'our',
  'ours',
  'out',
  'over',
  'own',
  'same',
  'she',
  'should',
  'so',
  'some',
  'such',
  'than',
  'that',
  'the',
  'their',
  'theirs',
  'them',
  'then',
  'there',
  'these',
  'they',
  'this',
  'those',
  'to',
  'too',
  'under',
  'until',
  'up',
  'us',
  'very',
  'was',
  'we',
  'were',
  'what',
  'when',
  'where',
  'which',
  'while',
  'who',
  'whom',
  'why',
  'will',
  'with',
  'would',
  'you',
  'your',
  'yours',
];

/**
 * Question framing, dropped for the same reason as function words.
 *
 * These appear in nearly every field label and standard-answer pattern
 * regardless of topic, so they say nothing about *which* fragment is relevant —
 * but they are rare inside the fragments themselves, which hands them a high IDF.
 * Left in, a label of "Describe your React Native experience" ranks a fragment
 * answering "describe a disagreement" above the React Native project.
 */
const INSTRUCTION_WORDS = [
  'above',
  'answer',
  'below',
  'briefly',
  'choose',
  'describe',
  'discuss',
  'elaborate',
  'enter',
  'explain',
  'following',
  'give',
  'list',
  'mention',
  'optional',
  'outline',
  'please',
  'provide',
  'required',
  'select',
  'share',
  'summarise',
  'summarize',
  'tell',
  'upload',
];

const STOPWORDS = new Set([...FUNCTION_WORDS, ...INSTRUCTION_WORDS]);

/**
 * Plurals only, and only on longer words.
 *
 * A real stemmer collides more than it helps on a corpus this small — Porter
 * folds "universal" and "universe" together, which would quietly mis-rank a
 * fragment. Trailing-s handling covers the case that actually recurs (a label
 * saying "projects" against a fragment saying "project").
 */
function normalizeTerm(term: string): string {
  if (term.length >= 4 && term.endsWith('s') && !term.endsWith('ss')) {
    return term.slice(0, -1);
  }
  return term;
}

/** Lower-case, split on non-word characters, drop stopwords. Keeps `c++`, `c#`. */
function tokenize(text: string): string[] {
  const terms: string[] = [];
  for (const raw of text.toLowerCase().split(/[^a-z0-9+#]+/)) {
    if (raw.length < 2 || STOPWORDS.has(raw)) continue;
    terms.push(normalizeTerm(raw));
  }
  return terms;
}

type FragmentSource = 'work-history' | 'project' | 'standard-answer';

interface Candidate {
  /** Prompt-ready text, with provenance so a bare bullet isn't context-free. */
  text: string;
  /**
   * Searchable terms. Provenance terms are folded in, so a field asking about
   * React Native matches that project's fragments even when the fragment text
   * itself never names the stack.
   */
  terms: string[];
  source: FragmentSource;
}

function hasText(value: string): boolean {
  return value.trim().length > 0;
}

/**
 * Flatten the profile into scorable fragments: work-history bullets, project
 * narrative fragments, and standard answers.
 */
function collectCandidates(profile: ProfileData): Candidate[] {
  const candidates: Candidate[] = [];

  for (const job of profile.workHistory) {
    const provenance = tokenize(`${job.role} ${job.company}`);
    const dates = hasText(job.dates) ? ` (${job.dates.trim()})` : '';
    for (const bullet of job.bullets) {
      if (!hasText(bullet)) continue;
      candidates.push({
        source: 'work-history',
        text: `${job.role.trim()} at ${job.company.trim()}${dates}: ${bullet.trim()}`,
        terms: [...tokenize(bullet), ...provenance],
      });
    }
  }

  for (const project of profile.projects) {
    const stack = project.techStack.filter(hasText).join(', ');
    const provenance = tokenize(
      `${project.name} ${stack} ${project.description} ${project.individualOrGroup}`,
    );
    const descriptor =
      stack.length > 0 ? `${project.individualOrGroup}, ${stack}` : project.individualOrGroup;
    for (const fragment of project.narrativeFragments) {
      if (!hasText(fragment)) continue;
      candidates.push({
        source: 'project',
        text: `Project "${project.name.trim()}" (${descriptor}): ${fragment.trim()}`,
        terms: [...tokenize(fragment), ...provenance],
      });
    }
  }

  for (const answer of profile.standardAnswers) {
    if (!hasText(answer.answerText)) continue;
    const patternTerms = tokenize(answer.questionPattern);
    candidates.push({
      source: 'standard-answer',
      text: `Previously answered "${answer.questionPattern.trim()}": ${answer.answerText.trim()}`,
      // The question pattern counts twice: it is the part written specifically
      // to be matched against a field label, so it should outweigh prose that
      // merely happens to share vocabulary.
      terms: [...tokenize(answer.answerText), ...patternTerms, ...patternTerms],
    });
  }

  return dedupe(candidates);
}

/** Drop fragments the user entered twice; keep the first occurrence. */
function dedupe(candidates: Candidate[]): Candidate[] {
  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    if (seen.has(candidate.text)) return false;
    seen.add(candidate.text);
    return true;
  });
}

/**
 * Weighted query terms, strongest source wins per term.
 *
 * Max rather than sum, deliberately: a 12,000-character job description
 * contributes hundreds of terms, and summing would let sheer word count drown
 * out the field's own label.
 */
function buildQuery(field: DetectedField, context: JobContext): Map<string, number> {
  const query = new Map<string, number>();
  const add = (text: string, weight: number) => {
    for (const term of tokenize(text)) {
      const existing = query.get(term);
      if (existing === undefined || weight > existing) query.set(term, weight);
    }
  };

  add(field.resolvedLabel, WEIGHT_LABEL);
  add(field.surroundingText, WEIGHT_SURROUNDING_TEXT);
  add(context.pageTitle, WEIGHT_PAGE_TITLE);
  add(context.rawText, WEIGHT_JOB_TEXT);
  return query;
}

/** Document frequency per query term, across the candidate set. */
function documentFrequencies(
  candidates: Candidate[],
  query: Map<string, number>,
): Map<string, number> {
  const df = new Map<string, number>();
  for (const candidate of candidates) {
    const unique = new Set(candidate.terms);
    for (const term of query.keys()) {
      if (unique.has(term)) df.set(term, (df.get(term) ?? 0) + 1);
    }
  }
  return df;
}

interface Scored {
  candidate: Candidate;
  score: number;
  /** Matches from the label, surrounding text, or page title. */
  strongMatches: number;
  /** Matches from the job description body only. */
  weakMatches: number;
  /** Original position, for a deterministic tiebreak. */
  index: number;
}

function scoreCandidate(
  candidate: Candidate,
  index: number,
  query: Map<string, number>,
  df: Map<string, number>,
  totalCandidates: number,
  averageLength: number,
): Scored {
  const frequencies = new Map<string, number>();
  for (const term of candidate.terms) {
    frequencies.set(term, (frequencies.get(term) ?? 0) + 1);
  }

  const length = candidate.terms.length;
  let score = 0;
  let strongMatches = 0;
  let weakMatches = 0;

  for (const [term, weight] of query) {
    const frequency = frequencies.get(term);
    if (frequency === undefined) continue;

    if (weight >= STRONG_WEIGHT) strongMatches += 1;
    else weakMatches += 1;

    const documentFrequency = df.get(term) ?? 0;
    const idf = Math.log(
      1 + (totalCandidates - documentFrequency + 0.5) / (documentFrequency + 0.5),
    );
    const saturation =
      (frequency * (BM25_K1 + 1)) /
      (frequency + BM25_K1 * (1 - BM25_B + BM25_B * (length / averageLength)));
    score += weight * idf * saturation;
  }

  return { candidate, score, strongMatches, weakMatches, index };
}

/**
 * Is this fragment relevant enough to spend prompt budget on?
 *
 * One match from the label, surrounding text, or page title is enough. Matching
 * only the job description body needs `MIN_JOB_CONTEXT_MATCHES` distinct terms,
 * so a fragment that merely shares a word or two with a long job ad is not
 * mistaken for a relevant one.
 */
function isRelevant(scored: Scored): boolean {
  if (scored.score <= 0) return false;
  return scored.strongMatches > 0 || scored.weakMatches >= MIN_JOB_CONTEXT_MATCHES;
}

/**
 * The `k` most relevant profile fragments for one field, best first.
 *
 * Returns an empty array — never filler — when the profile is empty or nothing
 * clears the relevance bar. A prompt with no fragments produces a generic draft;
 * a prompt padded with irrelevant fragments produces a confidently wrong one.
 *
 * Deterministic: same inputs, same output, with ties broken by profile order.
 */
export function retrieveFragments(
  field: DetectedField,
  context: JobContext,
  profile: ProfileData,
  k: number = DEFAULT_K,
): string[] {
  if (!Number.isFinite(k) || k <= 0) return [];

  const candidates = collectCandidates(profile);
  if (candidates.length === 0) return [];

  const query = buildQuery(field, context);
  if (query.size === 0) return [];

  const df = documentFrequencies(candidates, query);
  const totalLength = candidates.reduce((sum, candidate) => sum + candidate.terms.length, 0);
  const averageLength = totalLength / candidates.length || 1;

  return candidates
    .map((candidate, index) =>
      scoreCandidate(candidate, index, query, df, candidates.length, averageLength),
    )
    .filter(isRelevant)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, Math.floor(k))
    .map((scored) => scored.candidate.text);
}
