import { defineExtensionMessaging } from '@webext-core/messaging';
import type { DetectedField, JobContext, GeneratedAnswer } from './types';

// The single place message contracts are defined. Every cross-boundary call
// (content script ↔ background ↔ UI) goes through the helpers exported here;
// raw browser.runtime.sendMessage is lint-banned elsewhere (see eslint.config.mjs).

/** Result of scanning the active page. */
export interface ScanResult {
  fields: DetectedField[];
  context: JobContext;
}

/** Everything the background needs to produce drafts for one page. */
export interface GenerationRequest {
  fields: DetectedField[];
  context: JobContext;
}

export interface InsertFieldRequest {
  domRef: string;
  finalText: string;
}

export interface InsertFieldResult {
  success: boolean;
  /** Present only when success is false, for display in the UI. */
  error?: string;
}

export interface SaveFieldMappingRequest {
  domain: string;
  resolvedLabel: string;
  correctedType: string;
}

/**
 * Request/response shape of every message in the extension.
 *
 * Handlers may return a promise; a handler that throws surfaces as a rejected
 * promise on the sending side, so callers can try/catch instead of inspecting
 * a sentinel value.
 */
export interface ProtocolMap {
  /** Side panel → content script. Detect fields and read the job text. */
  TRIGGER_SCAN(): ScanResult;
  /** Side panel → background. Retrieve, prompt, generate, validate. */
  REQUEST_GENERATION(data: GenerationRequest): GeneratedAnswer[];
  /** Side panel → content script. Write a final answer into the live field. */
  INSERT_FIELD(data: InsertFieldRequest): InsertFieldResult;
  /** Side panel → background. Persist a manual label/type correction. */
  SAVE_FIELD_MAPPING(data: SaveFieldMappingRequest): void;
}

export const { sendMessage, onMessage } = defineExtensionMessaging<ProtocolMap>();
