import type { Capabilities, CarrierAdapter, Installation } from './contract.ts';
import { matchesInstallation, observationCapability, rateCapability, unsupported } from './contract.ts';

export function manualCapabilities(evidenceId: string, verifiedAt: string): Capabilities {
  return { manual_observations: { enabled: true, evidenceId, verifiedAt },
    tracking_import: { enabled: false }, tracking_api: { enabled: false }, webhooks: { enabled: false },
    selling_rate_import: { enabled: false }, selling_rate_api: { enabled: false },
    purchase_estimate_import: { enabled: false }, purchase_estimate_api: { enabled: false }, booking_api: { enabled: false } };
}

/** Receives validated, server-authored evidence. It has no network or domain write capability. */
export function manualAdapter(installation: Installation): CarrierAdapter {
  return {
    installation,
    health: () => Promise.resolve({ state: 'not_applicable', mode: 'manual' }),
    observe: (context, input) => {
      if (input.mode !== 'manual' || !installation.capabilities.manual_observations.enabled)
        return Promise.resolve(unsupported(observationCapability(input)));
      const observation = input.observation;
      if (context.installationRevision !== installation.revision || context.signal.aborted ||
        !matchesInstallation(installation, context.reference, installation) ||
        !matchesInstallation(installation, observation.reference, installation) ||
        observation.reference.franchiseId !== context.reference.franchiseId ||
        observation.dimensions.courierId !== installation.courierId ||
        observation.provenance.mode !== 'manual' || observation.provenance.commandId !== context.operationId)
        return Promise.resolve({ ok: false, error: { kind: 'permanent', code: 'invalid_input' } });
      return Promise.resolve({ ok: true, value: [structuredClone(observation)] });
    },
    rates: (_context, input) => Promise.resolve(unsupported(rateCapability(input))),
    submitBooking: () => Promise.resolve(unsupported('booking_api')),
  };
}
