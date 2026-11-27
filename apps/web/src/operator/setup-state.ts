import type {OnboardingRequest} from '@shippingco/shared';

/**
 * The Individual setup flow's rules and the two things it keeps on this device.
 *
 * The fields and their limits are the server's (apps/api/src/modules/onboarding/validation.ts
 * and tenancy/validation.ts): a business name and a branch name of 1 to 120 characters without
 * surrounding spaces or control characters, and a permanent branch code matching
 * [A-Z][A-Z0-9_]{0,31}. The browser checks them only to explain a refusal before sending; the
 * server stays the authority. Nothing else is asked, because nothing else is stored.
 */

export type SetupStep = 'plan' | 'account' | 'shop' | 'review' | 'payment' | 'done';
export const setupSteps: readonly {id: SetupStep; label: string; title: string}[] = [
  {id: 'plan', label: 'Plan', title: 'Your plan'},
  {id: 'account', label: 'Account', title: 'Verify your phone or email'},
  {id: 'shop', label: 'Shop', title: 'Shop details'},
  {id: 'review', label: 'Review', title: 'Review before payment'},
  {id: 'payment', label: 'Payment', title: 'Payment'},
  {id: 'done', label: 'Open', title: 'Your shop is open'},
];
export const stepIndex = (step: SetupStep) => setupSteps.findIndex(item => item.id === step);

export const validName = (value: string) => value.length > 0 && value === value.trim() && Array.from(value).length <= 120 &&
  !Array.from(value).some(character => { const n = character.codePointAt(0)!; return n < 32 || n === 127 || (n >= 0xd800 && n <= 0xdfff); });
export const validCode = (value: string) => /^[A-Z][A-Z0-9_]{0,31}$/.test(value);

export const fieldMessages = {
  name: 'Enter your business name as your customers know it (1 to 120 characters).',
  location: 'Enter the name of this shop or branch (1 to 120 characters).',
  code: 'Start with A to Z; use up to 32 capital letters, digits or underscores.',
} as const;
export type Answers = {name: string; location: string; code: string};
export const emptyAnswers: Answers = {name: '', location: '', code: 'MAIN'};

/** Every refusal at once, in the order the fields appear. */
export function answerErrors(answers: Answers): Partial<Record<keyof Answers, string>> {
  const errors: Partial<Record<keyof Answers, string>> = {};
  if (!validName(answers.name)) errors.name = fieldMessages.name;
  if (!validName(answers.location)) errors.location = fieldMessages.location;
  if (!validCode(answers.code)) errors.code = fieldMessages.code;
  return errors;
}

/**
 * Answers already given, kept on this device until the shop exists.
 *
 * The backend has no draft or resume endpoint, so "Save and finish later" can only mean this
 * browser. What is kept is shop configuration the owner typed — a business name, a branch name
 * and a branch code — never a customer, a parcel, an amount or a code. It is keyed by the
 * verified user, read only after the server has said who is signed in, and removed the moment
 * the server confirms the shop.
 */
const DRAFT = 'shipit_setup_answers:';
export type Draft = Answers & {step: SetupStep};
export function readDraft(userId: string): Draft | null {
  try {
    const value = JSON.parse(window.localStorage.getItem(DRAFT + userId) ?? 'null') as Record<string, unknown> | null;
    if (!value || typeof value.name !== 'string' || typeof value.location !== 'string' || typeof value.code !== 'string') return null;
    const step = setupSteps.some(item => item.id === value.step) ? value.step as SetupStep : 'shop';
    return {name: value.name, location: value.location, code: value.code, step};
  } catch { return null; }
}
export function saveDraft(userId: string, draft: Draft) {
  try { window.localStorage.setItem(DRAFT + userId, JSON.stringify(draft)); return true; }
  catch { return false; /* a full or blocked store loses nothing on screen; the owner retypes later */ }
}
export function clearDraft(userId: string) {
  try { window.localStorage.removeItem(DRAFT + userId); } catch { /* the shop exists; the draft is spent */ }
}

/**
 * The exact request already sent, for this tab only.
 *
 * Only a pending request intent, never workspace authority: GET context always runs first. A
 * retry after an uncertain answer sends the same key and body, so the server's replay returns
 * the original shop instead of creating a second one.
 */
export type Intent = {key: string; body: OnboardingRequest};
const INTENT = 'shipit_onboarding_request:';
export function pendingIntent(userId: string): Intent | null {
  try {
    const value = JSON.parse(sessionStorage.getItem(INTENT + userId) ?? 'null') as Intent | null;
    return value && typeof value.key === 'string' && typeof value.body?.display_name === 'string' &&
      typeof value.body.franchise?.display_name === 'string' && typeof value.body.franchise.franchise_code === 'string' ? value : null;
  } catch { return null; }
}
export function rememberIntent(userId: string, intent: Intent) {
  try { sessionStorage.setItem(INTENT + userId, JSON.stringify(intent)); } catch { /* the server's identity guard also prevents a second workspace */ }
}
export function clearPending(userId: string) {
  try { sessionStorage.removeItem(INTENT + userId); } catch { /* context remains authoritative */ }
}
