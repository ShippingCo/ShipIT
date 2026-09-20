import ts from 'typescript';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve, relative, posix } from 'node:path';
import { pathToFileURL } from 'node:url';

// Exact files, never directory-wide exemptions. See tenant-query-isolation.md.
const rawSql = new Set(['apps/api/src/modules/auth/repository.ts', 'apps/api/src/modules/auth/worker.ts',
  'apps/api/src/modules/memberships/authority.ts', 'apps/api/src/modules/security/scope.ts']);
const issuers = new Set(['apps/api/src/modules/memberships/service.ts', 'apps/api/src/modules/tenancy/service.ts',
  'apps/api/src/modules/security/jobs.ts', 'apps/api/src/modules/security/scope.ts']);
export function inspectSource(file, source) {
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const errors = [];
  const report = (node, reason) => errors.push(`${file}:${tree.getLineAndCharacterOfPosition(node.getStart(tree)).line + 1}: TENANT_QUERY_GATE ${reason}`);
  const scopedNames = new Set(['scopedQuery']);
  function visit(node) {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      const module = node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier) ? node.moduleSpecifier.text : '';
      const localPath = module.startsWith('.') ? posix.normalize(posix.join(posix.dirname(file), module)) : module;
      const scopeModule = localPath === 'apps/api/src/modules/security/scope.ts';
      const bindings = ts.isImportDeclaration(node) ? node.importClause?.namedBindings : undefined;
      if (bindings && ts.isNamedImports(bindings)) for (const item of bindings.elements) {
        const original = item.propertyName?.text ?? item.name.text;
        if (!rawSql.has(file) && module === '@shippingco/db' && original === 'query') report(item, 'raw query helper bypasses scopedQuery');
        if (original === 'scopedQuery') scopedNames.add(item.name.text);
        if (original === 'issueTenantAccess' && !issuers.has(file)) report(item, 'scope issuer import outside trusted adapters');
        if (original === 'persistBusinessWebhook' && file !== 'apps/api/src/modules/whatsapp/webhook.ts') report(item, 'webhook ingress is restricted to the signed HTTP boundary');
        if (original === 'withNextConsentScope' && file !== 'apps/api/src/modules/whatsapp/consent-worker.ts') report(item, 'consent scheduling is restricted to its trusted worker');
        if (original === 'withOutboundScope' && file !== 'apps/api/src/modules/whatsapp/outbound-worker.ts') report(item, 'outbound scheduling is restricted to its trusted worker');
        if (original === 'withNextInboxScope' && file !== 'apps/api/src/modules/whatsapp/inbox-worker.ts') report(item, 'inbox scheduling is restricted to its trusted worker');
      }
      if (scopeModule && bindings && ts.isNamespaceImport(bindings) && !issuers.has(file)) report(node, 'namespace scope imports can expose issuer');
      if (localPath === 'apps/api/src/modules/security/jobs.ts' &&
        ((bindings && ts.isNamespaceImport(bindings)) || ts.isExportDeclaration(node))) report(node, 'do not re-export or namespace-import trusted job adapters');
      if (module.endsWith('/authority.ts') || module === './authority.ts') {
        if (file !== 'apps/api/src/modules/memberships/service.ts') report(node, 'authority resolution is restricted to the membership service');
      }
      if (!rawSql.has(file) && (/^(pg|postgres|@shippingco\/db\/)/.test(module) || localPath.startsWith('packages/db/'))) report(node, 'direct DB driver/subpath import');
      if (!rawSql.has(file) && file.endsWith('/repository.ts') && module === '@shippingco/db') report(node, 'private repository must accept TenantAccess');
      if (ts.isExportDeclaration(node) && scopeModule) report(node, 'do not re-export scope issuer');
    }
    if (!rawSql.has(file)) {
      // Catch extracted/aliased query methods too; Fastify request.query is data, not a call.
      if (ts.isPropertyAccessExpression(node) && node.name.text === 'query' &&
        !(file === 'apps/api/src/modules/security/jobs.ts' && node.expression.getText(tree) === 'tx' && ts.isCallExpression(node.parent) && ["'SELECT organization_id,franchise_id,intent_id FROM shipit.whatsapp_outbound_scope($1,$2,$3)'", "'SELECT shipit.whatsapp_receive($1,$2,$3)'", "'SELECT organization_id,franchise_id,inbox_id FROM shipit.whatsapp_consent_next()'", "'SELECT organization_id,franchise_id,inbox_id FROM shipit.whatsapp_inbox_next()'", "'SELECT organization_id,franchise_id FROM shipit.attachment_cleanup_scope($1)'", "'SELECT organization_id,franchise_id FROM shipit.outbox_next_scope($1,$2,$3,$4)'", "'SELECT organization_id,franchise_id FROM shipit.outbox_job_scope($1)'", '"SET LOCAL transaction_timeout = \'25s\'"' ].includes(node.parent.arguments[0]?.getText(tree))) &&
        !((file.endsWith('/auth/webhook.ts') && node.expression.getText(tree) === 'r') ||
          (['apps/api/src/modules/whatsapp/routes.ts', 'apps/api/src/modules/outbox/routes.ts', 'apps/api/src/modules/eway/routes.ts', 'apps/api/src/modules/attachments/routes.ts', 'apps/api/src/modules/receipts/routes.ts', 'apps/api/src/modules/payments/routes.ts', 'apps/api/src/modules/routes/routes.ts', 'apps/api/src/modules/lots/routes.ts', 'apps/api/src/modules/bookings/routes.ts', 'apps/api/src/modules/parcels/routes.ts', 'apps/api/src/modules/tax/routes.ts', 'apps/api/src/modules/audit/routes.ts', 'apps/api/src/modules/customers/routes.ts', 'apps/api/src/modules/pricing/routes.ts'].includes(file) && node.expression.getText(tree) === 'request' && !(ts.isCallExpression(node.parent) && node.parent.expression === node)))) report(node, 'raw query method bypasses scopedQuery');
      if (ts.isElementAccessExpression(node) && ((ts.isStringLiteral(node.argumentExpression) && node.argumentExpression.text === 'query') ||
        (!ts.isStringLiteral(node.argumentExpression) && ts.isCallExpression(node.parent) && node.parent.expression === node))) report(node, 'computed executor calls are not approved');
      if (ts.isBindingElement(node) && (node.propertyName?.getText(tree) ?? node.name.getText(tree)) === 'query') report(node, 'extracted query bypasses scopedQuery');
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && scopedNames.has(node.expression.text)) {
        const sql = node.arguments[2];
        const literal = sql && (ts.isStringLiteral(sql) || ts.isNoSubstitutionTemplateLiteral(sql) || ts.isTemplateExpression(sql));
        const text = literal ? sql.getText(tree) : '';
        const bootstrap = file === 'apps/api/src/modules/tenancy/repository.ts' && text.includes('INSERT INTO shipit.organizations');
        if (!literal || (!/\{\{(?:organization|franchise|membership|invitation):/.test(text) && !bootstrap)) report(node, 'scoped SQL needs an explicit ownership predicate');
        if (/shipit\.(?:customers|customer_commands|customer_audit_events|append_customer_audit)\b/.test(text) && !text.includes('{{franchise:')) report(node, 'customer SQL requires both organization and franchise ownership');
        if (/shipit\.(?:pricing_[a-z_]+|append_pricing_audit)\b/.test(text) && !text.includes('{{franchise:')) report(node, 'pricing SQL requires both organization and franchise ownership');
        if (/shipit\.(?:bookings|booking_[a-z_]+|parcels|parcel_[a-z_]+|domain_events|append_booking_audit)\b/.test(text) && !text.includes('{{franchise:')) report(node, 'booking SQL requires both organization and franchise ownership');
        if (/shipit\.(?:lots|lot_[a-z_]+|append_lot_audit)\b/.test(text) && !text.includes('{{franchise:')) report(node, 'lot SQL requires both organization and franchise ownership');
        if (/shipit\.(?:routes|route_[a-z_]+|append_route_audit)\b/.test(text) && !text.includes('{{franchise:')) report(node, 'route SQL requires both organization and franchise ownership');
        if (/shipit\.(?:payment_[a-z_]+|append_payment_audit)\b/.test(text) && !text.includes('{{franchise:')) report(node, 'payment SQL requires both organization and franchise ownership');
        if (/shipit\.whatsapp_[a-z_]+\b/.test(text) && !text.includes('{{franchise:')) report(node, 'whatsapp SQL requires both organization and franchise ownership');
        if (/shipit\.outbox_[a-z_]+\b/.test(text) && !text.includes('{{franchise:')) report(node, 'outbox SQL requires both organization and franchise ownership');
        if (/shipit\.eway_[a-z_]+\b/.test(text) && !text.includes('{{franchise:')) report(node, 'eway SQL requires both organization and franchise ownership');
        if (/shipit\.(?:attachments|attachment_[a-z_]+)\b/.test(text) && !text.includes('{{franchise:')) report(node, 'attachment SQL requires both organization and franchise ownership');
        if (/shipit\.(?:issued_receipts|receipt_audit_events)\b/.test(text) && !text.includes('{{franchise:')) report(node, 'receipt SQL requires both organization and franchise ownership');
        if (/shipit\.tax_[a-z_]+\b/.test(text) && !text.includes('{{franchise:')) report(node, 'tax SQL requires both organization and franchise ownership');
        if (!node.arguments[1] || !ts.isArrayLiteralExpression(node.arguments[1]) || !node.arguments[1].elements.length) report(node, 'query must declare a closed action allowlist');
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(tree);
  return errors;
}
export function checkTenantQueries(root = process.cwd()) {
  const errors = [];
  function walk(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (/\.[cm]?[jt]sx?$/.test(entry.name)) errors.push(...inspectSource(relative(root, path).replaceAll('\\', '/'), readFileSync(path, 'utf8')));
    }
  }
  walk(resolve(root, 'apps/api/src'));
  return errors;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const errors = checkTenantQueries();
  if (errors.length) { console.error(errors.join('\n')); process.exitCode = 1; }
  else console.log('Tenant query AST gate passed');
}
