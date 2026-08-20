import { storage } from '#imports';
import { extractDomain } from './job-context';
import type { SaveFieldMappingRequest } from './messaging';
import type { DetectedField } from './types';

// Corrections the user typed on a card, remembered per site.
//
// This is a convenience layer and nothing more (build guide, Phase 14). It never
// decides that a field exists or where it is — the generic detector has already
// run by the time anything here is read — and what it stores is one person's
// note about one label, so it is passed to the model as a hint rather than as
// fact. Deleting the whole store costs the user a little re-typing and nothing
// else, which is the property that keeps it from becoming a per-site scraper.

/** One remembered correction: "on this site, a field labelled X is really a Y". */
export interface FieldMapping {
  /** The label as the detector resolved it, kept for display. */
  resolvedLabel: string;
  /** What the user said the field actually asks for. Free text, their words. */
  correctedType: string;
}

/** Same `local:` prefix as the profile: on-device only, never synced. */
const MAPPINGS_KEY = 'local:fieldMappings' as const;
const MAPPINGS_VERSION = 1;

/**
 * Storage caps. Corrections are small, but nothing else prunes them, and an
 * extension that grows its own storage forever is a bug that only shows up
 * months later. The oldest entry goes first.
 */
const MAX_PER_DOMAIN = 100;
const MAX_DOMAINS = 200;

type MappingsByDomain = Record<string, FieldMapping[]>;

const mappingsItem = storage.defineItem<MappingsByDomain>(MAPPINGS_KEY, {
  version: MAPPINGS_VERSION,
  fallback: {},
});

/** Hostnames are case-insensitive; the key should be too. */
function normalizeDomain(domain: string): string {
  return domain.trim().toLowerCase();
}

/**
 * The form a label is matched in.
 *
 * A page that renders "Cover letter" today and "Cover Letter " tomorrow is the
 * same question, so matching on the collapsed lowercase form is what makes a
 * correction survive an unrelated markup change. The original spelling is stored
 * alongside for display.
 */
function normalizeLabel(label: string): string {
  return label.replace(/\s+/g, ' ').trim().toLowerCase();
}

/**
 * Every correction saved for a domain, oldest first.
 *
 * A domain nobody has corrected yet is the normal case, not an error: it returns
 * an empty list, so callers need no special path for a first visit.
 */
export async function getFieldMappings(domain: string): Promise<FieldMapping[]> {
  const key = normalizeDomain(domain);
  if (key.length === 0) return [];
  const all = await mappingsItem.getValue();
  return all[key] ?? [];
}

/** The correction saved for one label on one site, if there is one. */
export async function findFieldMapping(
  domain: string,
  resolvedLabel: string,
): Promise<FieldMapping | null> {
  const wanted = normalizeLabel(resolvedLabel);
  if (wanted.length === 0) return null;
  const mappings = await getFieldMappings(domain);
  return mappings.find((entry) => normalizeLabel(entry.resolvedLabel) === wanted) ?? null;
}

/** Drop the oldest entries until `list` fits the per-domain cap. */
function withinCap(list: FieldMapping[]): FieldMapping[] {
  return list.length <= MAX_PER_DOMAIN ? list : list.slice(list.length - MAX_PER_DOMAIN);
}

/** Drop the least recently added domains until the store fits its cap. */
function pruneDomains(all: MappingsByDomain): MappingsByDomain {
  const keys = Object.keys(all);
  if (keys.length <= MAX_DOMAINS) return all;
  const pruned = { ...all };
  // Object key order is insertion order, so the front of the list is the oldest.
  for (const key of keys.slice(0, keys.length - MAX_DOMAINS)) delete pruned[key];
  return pruned;
}

/**
 * Remember one correction, replacing any earlier one for the same label.
 *
 * Rejects an incomplete correction rather than storing a record that could never
 * be matched again: without a domain and a label there is no key, and without a
 * type there is nothing to remember. The panel already refuses to send these
 * (see `canSaveCorrection`), so reaching this is a bug worth hearing about.
 */
export async function saveFieldMapping({
  domain,
  resolvedLabel,
  correctedType,
}: SaveFieldMappingRequest): Promise<void> {
  const key = normalizeDomain(domain);
  const label = resolvedLabel.trim();
  const type = correctedType.trim();
  if (key.length === 0 || label.length === 0 || type.length === 0) {
    throw new Error(
      'A correction needs a site, a field label, and what the field really asks for.',
    );
  }

  const all = await mappingsItem.getValue();
  const existing = all[key] ?? [];
  const wanted = normalizeLabel(label);
  const entry: FieldMapping = { resolvedLabel: label, correctedType: type };

  const index = existing.findIndex(
    (candidate) => normalizeLabel(candidate.resolvedLabel) === wanted,
  );
  // The newest correction for a label wins outright: the user has just told us
  // the previous one was wrong, or has changed their mind.
  const updated =
    index === -1
      ? [...existing, entry]
      : existing.map((candidate, at) => (at === index ? entry : candidate));

  await mappingsItem.setValue(pruneDomains({ ...all, [key]: withinCap(updated) }));
}

/** Forget every correction for one site. */
export async function clearFieldMappings(domain: string): Promise<void> {
  const key = normalizeDomain(domain);
  const all = await mappingsItem.getValue();
  if (!(key in all)) return;
  const next = { ...all };
  delete next[key];
  await mappingsItem.setValue(next);
}

/**
 * Corrections for the fields on one page, keyed by `tempId` for the prompt.
 *
 * Read at generation time, after detection: a hint here can change how a field
 * is *described* to the model, never whether it was found. A storage failure
 * returns no hints instead of failing the generation — losing a convenience is
 * not worth losing the drafts.
 */
export async function correctionHints(
  fields: Pick<DetectedField, 'tempId' | 'resolvedLabel'>[],
  url: string,
): Promise<Record<string, string>> {
  const domain = extractDomain(url);
  if (domain.length === 0 || fields.length === 0) return {};

  let mappings: FieldMapping[];
  try {
    mappings = await getFieldMappings(domain);
  } catch (error) {
    console.warn('[job-copilot] could not read saved corrections', error);
    return {};
  }
  if (mappings.length === 0) return {};

  const byLabel = new Map(
    mappings.map((entry) => [normalizeLabel(entry.resolvedLabel), entry.correctedType]),
  );
  const hints: Record<string, string> = {};
  for (const field of fields) {
    const hint = byLabel.get(normalizeLabel(field.resolvedLabel));
    if (hint !== undefined) hints[field.tempId] = hint;
  }
  return hints;
}
