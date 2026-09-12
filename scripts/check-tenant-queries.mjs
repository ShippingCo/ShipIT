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
      }
      if (scopeModule && bindings && ts.isNamespaceImport(bindings) && !issuers.has(file)) report(node, 'namespace scope imports can expose issuer');
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
        !((file.endsWith('/auth/webhook.ts') && node.expression.getText(tree) === 'r') ||
          (['apps/api/src/modules/audit/routes.ts', 'apps/api/src/modules/customers/routes.ts', 'apps/api/src/modules/pricing/routes.ts'].includes(file) && node.expression.getText(tree) === 'request' && !(ts.isCallExpression(node.parent) && node.parent.expression === node)))) report(node, 'raw query method bypasses scopedQuery');
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
