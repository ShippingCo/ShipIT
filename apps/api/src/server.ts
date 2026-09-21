import { createWhatsappService } from './modules/whatsapp/service.ts';
import { createConsentService } from './modules/whatsapp/consent-service.ts';
import { createOutboundService } from './modules/whatsapp/outbound-service.ts';
import { createAutomationReadService } from './modules/automation/read-service.ts';
import { registerBusinessWebhook } from './modules/whatsapp/webhook.ts';
import { registerWhatsapp } from './modules/whatsapp/routes.ts';
import type { WhatsappDependencies } from './modules/whatsapp/types.ts';
import { createOutboxService } from './modules/outbox/service.ts';
import { registerOutbox } from './modules/outbox/routes.ts';
import { createEwayService } from './modules/eway/service.ts';
import { registerEway } from './modules/eway/routes.ts';
import { createAttachmentService } from './modules/attachments/service.ts';
import { registerAttachments } from './modules/attachments/routes.ts';
import type { AttachmentDependencies } from './modules/attachments/types.ts';
import { createReceiptService } from './modules/receipts/service.ts';
import { registerReceipts } from './modules/receipts/routes.ts';
import { createPaymentService } from './modules/payments/service.ts';
import { registerPayments } from './modules/payments/routes.ts';
import { createRouteService } from './modules/routes/service.ts';
import { createRouteEventService } from './modules/routes/event-service.ts';
import { registerRoutes } from './modules/routes/routes.ts';
import { createLotService } from './modules/lots/service.ts';
import { registerLots } from './modules/lots/routes.ts';
import { createParcelBulkService } from './modules/parcels/bulk-service.ts';
import { createBookingService } from './modules/bookings/service.ts';
import { registerBookings } from './modules/bookings/routes.ts';
import { createParcelService } from './modules/parcels/service.ts';
import { registerParcelCommands } from './modules/parcels/routes.ts';
import { createPricingService } from './modules/pricing/service.ts';
import { registerPricing } from './modules/pricing/routes.ts';
import { createTaxService } from './modules/tax/service.ts';
import { registerTax } from './modules/tax/routes.ts';
import { registerCustomers } from './modules/customers/routes.ts';
import { createCustomerService } from './modules/customers/service.ts';
import { registerOnboarding } from './modules/onboarding/routes.ts';
import { createAuditService } from './modules/audit/service.ts';
import { registerAudit } from './modules/audit/routes.ts';
import { registerSecurityAudit } from './modules/audit/security.ts';
import { createSecurityCounters, type SecurityTelemetry } from './modules/audit/telemetry.ts';
import { randomUUID } from 'node:crypto';
import Fastify, { LogController, type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import cookie from '@fastify/cookie';
import { createAuthService } from './modules/auth/service.ts';
import { registerAuth } from './modules/auth/routes.ts';
import { createMembershipService } from './modules/memberships/service.ts';
import { registerMemberships } from './modules/memberships/routes.ts';
import { registerWebhook } from './modules/auth/webhook.ts';
import type { AuthConfiguration } from './modules/auth/config.ts';
import type { DatabasePool } from '@shippingco/db';
import type { RuntimeConfig } from './env.ts';
import { registerErrors, HttpError, errorEnvelope, rejectTransport } from './plugins/errors.ts';
import { registerJson, JSON_BODY_LIMIT } from './plugins/json.ts';
import { loggerOptions, registerRequestLogging, type LogSink } from './plugins/logging.ts';
import { registerHealth } from './modules/health/routes.ts';

export interface ServerDependencies { config: RuntimeConfig; database: DatabasePool; logSink?: LogSink; auth?: AuthConfiguration; securityTelemetry?: SecurityTelemetry; pricingClock?:()=>Date; attachments?:AttachmentDependencies; whatsapp?:WhatsappDependencies }
export function buildServer({ config, database, logSink, auth, securityTelemetry=createSecurityCounters(), pricingClock, attachments, whatsapp }: ServerDependencies) {
  const app: FastifyInstance = Fastify({
    logger: loggerOptions(config, logSink),
    logController: new LogController({ disableRequestLogging: true, requestIdLogLabel: 'request_id' }),
    requestIdHeader: false, genReqId: () => randomUUID(),
    trustProxy: config.trustedProxyHops === 0 ? false : (address, hop) =>
      hop < config.trustedProxyHops && config.trustedProxyAddresses.includes(address.replace(/^::ffff:/, '')),
    clientErrorHandler: (error, socket) => rejectTransport(error, socket, app.log),
    routerOptions: {
      onBadUrl: (_path, _request, response) => {
        // Router rejection precedes FastifyRequest/hooks. Never echo the raw path.
        const id = randomUUID();
        response.writeHead(400, { 'content-type': 'application/json; charset=utf-8', 'x-request-id': id });
        response.end(JSON.stringify(errorEnvelope('MALFORMED_REQUEST', id)));
        app.log.info({ event: 'request_rejected', request_id: id, status: 400, code: 'MALFORMED_REQUEST' }, 'Request rejected');
      },
    },
    bodyLimit: JSON_BODY_LIMIT, requestTimeout: 30_000, connectionTimeout: 30_000,
    keepAliveTimeout: 5000, maxRequestsPerSocket: 1000, forceCloseConnections: 'idle',
    ajv: { customOptions: { removeAdditional: false, coerceTypes: false, useDefaults: false, allErrors: false } },
  });
  registerErrors(app);
  registerRequestLogging(app);
  registerJson(app);
  app.register(cors, {
    origin: (origin, callback) => callback(null, origin !== undefined && config.allowedOrigins.includes(origin)),
    credentials: !!auth, methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Idempotency-Key', ...(auth ? ['X-CSRF-Token'] : [])], exposedHeaders: ['x-request-id'],
    strictPreflight: true, maxAge: 600,
  });
  app.register(rateLimit, { max: 120, timeWindow: 60_000, cache: 10_000,
    errorResponseBuilder: () => new HttpError('RATE_LIMITED'),
  });
  app.after(() => {
    app.setNotFoundHandler({ preHandler: app.rateLimit() }, (request, reply) =>
      reply.code(404).send(errorEnvelope('RESOURCE_NOT_FOUND', request.id)));
  });
  // Register after infrastructure boot so global plugin hooks cover every route.
  app.register(async instance => { registerHealth(instance, database); });
  if(whatsapp?.configuration.webhook)app.register(async instance=>registerBusinessWebhook(instance,database,whatsapp.configuration.webhook!));
  if (auth) {
    app.register(cookie);
    app.register(async instance => {
      registerSecurityAudit(instance,database,config.environment!=='developer',securityTelemetry);
      registerAudit(instance,createAuditService(database,auth.keys.browser),config.environment!=='developer');
      registerAuth(instance,createAuthService(database,auth.keys),auth.keys,config.allowedOrigins,config.environment!=='developer');
      registerOnboarding(instance,createMembershipService(database),config.environment!=='developer');
      registerPricing(instance,createPricingService(database,pricingClock),config.environment!=='developer');
      registerBookings(instance,createBookingService(database,auth.keys.browser,pricingClock),config.environment!=='developer');
      const parcelService=createParcelService(database,pricingClock);
      registerParcelCommands(instance,parcelService,config.environment!=='developer',createParcelBulkService(database,parcelService));
      registerRoutes(instance,createRouteService(database,auth.keys.browser),config.environment!=='developer',createRouteEventService(database));
      if(attachments)registerAttachments(instance,createAttachmentService(database,attachments),config.environment!=='developer');
      registerEway(instance,createEwayService(database,auth.keys.browser,pricingClock),config.environment!=='developer');
      if(whatsapp)registerWhatsapp(instance,createWhatsappService(database,whatsapp),config.environment!=='developer',createConsentService(database,whatsapp),createOutboundService(database,auth.keys.browser),createAutomationReadService(database,auth.keys.browser));
      registerOutbox(instance,createOutboxService(database,auth.keys.browser),config.environment!=='developer');
      registerReceipts(instance,createReceiptService(database),config.environment!=='developer');
      registerPayments(instance,createPaymentService(database),config.environment!=='developer');
      registerLots(instance,createLotService(database,auth.keys.browser),config.environment!=='developer');
      registerTax(instance,createTaxService(database,pricingClock),config.environment!=='developer');
      registerCustomers(instance,createCustomerService(database,auth.keys.browser),config.environment!=='developer');
      registerMemberships(instance,createMembershipService(database),config.environment!=='developer');
    });
    if (auth.webhook) app.register(async instance => registerWebhook(instance,auth.webhook!));
  }
  return app;
}
