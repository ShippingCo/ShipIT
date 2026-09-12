/** Payload-free hints only. Receipt always purges locally and asks the API again. */
export function connectInvalidation(invalidate: () => void) {
  let channel: BroadcastChannel | null = null;
  try {
    if (typeof BroadcastChannel !== 'undefined') channel = new BroadcastChannel('shipit_session_invalidation_v1');
  } catch { /* Some browser policies disable channels; focus/resume still revalidates. */ }
  if (channel) channel.onmessage = event => { if (event.data === 'invalidate') invalidate(); };
  return {
    publish() { try { channel?.postMessage('invalidate'); } catch { /* A closed/blocked advisory channel cannot change a committed outcome. */ } },
    close() { channel?.close(); channel = null; },
  };
}
