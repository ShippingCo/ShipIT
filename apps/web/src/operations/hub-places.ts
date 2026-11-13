/**
 * The places this branch hands parcels over at, named by the people who use them.
 *
 * Checking a parcel in at the hub requires a `location_ref`, and dispatching one
 * requires a `manifest_id`. The server validates both as UUIDs and nothing more
 * (apps/api/src/modules/parcels/validation.ts), so the console was asking a counter
 * clerk to type a 36-character hexadecimal string by hand, twice, before the Check
 * in button would even enable. Nobody can do that, and nobody did: the screen was
 * effectively unusable for its own purpose.
 *
 * There is no server endpoint that lists hub locations — only cash locations exist,
 * and a cash location is not a parcel hub, so borrowing those ids would write the
 * wrong thing into the custody record. Until such an endpoint exists, the names
 * live on the device: the operator writes "Pune sorting hub" once, this module mints
 * one UUID for that name and keeps reusing it, so every check-in at that hub carries
 * the same reference and the custody history stays groupable.
 *
 * What that buys and what it does not, stated plainly because it matters for audit:
 *   - the reference is STABLE for a given name on a given device, so repeat
 *     check-ins at one hub share one id, which is the whole point of the field;
 *   - it is NOT shared between devices or branches, so the same physical hub named
 *     on two counters will carry two ids. A server-side register of locations is the
 *     proper fix; this is what makes the screen work in the meantime.
 */

const KEY = 'shippingco.hub-places.v1';

export interface HubPlace {
  /** The UUID written into location_ref. Minted once, then never changed. */
  id: string;
  /** What the operator calls this place. */
  name: string;
  /** Most recently used first, so the common hub is the default choice. */
  usedAt: number;
}

/** A v4 UUID. crypto.randomUUID is absent over plain http and in older webviews. */
function mintId(): string {
  const random = globalThis.crypto;
  if (random && typeof random.randomUUID === 'function') return random.randomUUID();
  const bytes = new Uint8Array(16);
  if (random && typeof random.getRandomValues === 'function') random.getRandomValues(bytes);
  else for (let i = 0; i < 16; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** A fresh reference for one event, such as a single check-in. Never reused. */
export const mintEventRef = mintId;

const shaped = (value: unknown): value is HubPlace =>
  typeof value === 'object' && value !== null
  && typeof (value as HubPlace).id === 'string' && (value as HubPlace).id.length === 36
  && typeof (value as HubPlace).name === 'string' && (value as HubPlace).name.trim().length > 0;

export function readPlaces(): HubPlace[] {
  // Storage throws outright in a private window and returns nothing after a clear.
  // A hub register that cannot be read is an empty one, never a crash on a screen
  // the operator is holding a parcel in front of.
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(shaped)
      .map(place => ({ id: place.id, name: place.name, usedAt: Number(place.usedAt) || 0 }))
      .sort((a, b) => b.usedAt - a.usedAt);
  } catch { return []; }
}

function write(places: readonly HubPlace[]): void {
  try { window.localStorage.setItem(KEY, JSON.stringify(places)); } catch { /* read-only storage; the list stays for this session */ }
}

/**
 * Find or create the place with this name, and mark it as the one just used.
 * Matching ignores case and surrounding space so "Pune hub" and "pune  hub " are one
 * place rather than two references for the same shed.
 */
export function rememberPlace(name: string): HubPlace | null {
  const wanted = name.trim().replace(/\s+/g, ' ');
  if (!wanted) return null;
  const places = readPlaces();
  const found = places.find(place => place.name.toLowerCase() === wanted.toLowerCase());
  const place: HubPlace = found
    ? { ...found, usedAt: Date.now() }
    : { id: mintId(), name: wanted, usedAt: Date.now() };
  write([place, ...places.filter(other => other.id !== place.id)]);
  return place;
}

export function forgetPlace(id: string): void {
  write(readPlaces().filter(place => place.id !== id));
}
