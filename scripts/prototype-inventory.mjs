// Read-only TypeScript inventory for Issue #7. Never imports prototype runtime code.
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

export const root = path.resolve(import.meta.dirname, '..');
const relative = (file) => path.relative(root, file).split(path.sep).join('/');

function filesIn(folder) {
  return readdirSync(folder, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(folder, entry.name);
    return entry.isDirectory() ? filesIn(file) : /\.tsx?$/.test(file) ? [file] : [];
  }).sort();
}

export function inventory() {
  const files = filesIn(path.join(root, 'apps/web/src'));
  const options = { jsx: ts.JsxEmit.ReactJSX, allowJs: false,
    moduleResolution: ts.ModuleResolutionKind.Bundler, module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ESNext, skipLibCheck: true, noEmit: true };
  const host = ts.createCompilerHost(options);
  const read = host.readFile;
  host.readFile = (file) => read(file)?.replace(/\r\n/g, '\n');
  const program = ts.createProgram(files, options, host);
  const checker = program.getTypeChecker();
  const storePath = 'apps/web/src/data/store.ts';
  const modules = {};
  const routes = [];
  const tests = [];
  const effects = [];
  const sources = new Map();
  for (const file of files) {
    const source = program.getSourceFile(file);
    const name = relative(file);
    sources.set(name, source);
    const imports = [];
    function visit(node) {
      if (ts.isStringLiteral(node) && (ts.isImportDeclaration(node.parent) ||
          ts.isExportDeclaration(node.parent) || (ts.isCallExpression(node.parent) &&
          node.parent.expression.kind === ts.SyntaxKind.ImportKeyword))) {
        const resolved = ts.resolveModuleName(node.text, file, program.getCompilerOptions(), ts.sys)
          .resolvedModule?.resolvedFileName;
        if (resolved && relative(resolved).startsWith('apps/web/src/')) {
          imports.push({ target: relative(resolved), syntax: node.parent.getText(source) });
        }
      }
      if ((ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) &&
          node.tagName.getText(source) === 'Route') {
        routes.push({ file: name, declaration: node.getText(source).replace(/\s+/g, ' ') });
      }
      if (ts.isCallExpression(node)) {
        const callee = node.expression.getText(source);
        const testCall = /^(it|test)(\.each\([\s\S]*\))?$/.test(callee);
        if (testCall && node.arguments.length && ts.isStringLiteral(node.arguments[0])) {
          tests.push({ file: name, name: node.arguments[0].text,
            cases: callee.includes('.each(') ? node.expression.arguments[0].getText(source) : null });
        }
        if (/localStorage|sessionStorage|setTimeout|setInterval|addEventListener|useSyncExternalStore/.test(callee)) {
          // Capture location/kind, not argument values (which could be sensitive).
          effects.push({ file: name, kind: callee });
        }
      }
      ts.forEachChild(node, visit);
    }
    visit(source);
    modules[name] = imports;
  }
  const store = sources.get(storePath);
  const exports = checker.getExportsOfModule(checker.getSymbolAtLocation(store)).map((s) => s.name).sort();
  const object = store.statements.filter(ts.isVariableStatement)
    .flatMap((statement) => [...statement.declarationList.declarations])
    .find((declaration) => declaration.name.getText(store) === 'Store').initializer;
  const storeMembers = object.properties.map((property) => property.name.getText(store)).sort();
  const consumers = new Set([storePath]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const [name, imports] of Object.entries(modules)) {
      if (!consumers.has(name) && imports.some((item) => consumers.has(item.target))) {
        consumers.add(name); changed = true;
      }
    }
  }
  // Hash directly coupled files too: catches alias mutations and changed test bodies
  // that an import/export-only inventory cannot interpret semantically.
  const coupled = [...consumers].sort();
  const support = ['apps/web/src/data/types.ts', 'apps/web/src/data/messages.ts',
    'apps/web/src/utils/image.ts', 'apps/web/src/components/m3/Controls.tsx'];
  const fingerprints = Object.fromEntries([...new Set([...coupled, ...support])].sort().map((name) => [name,
    createHash('sha256').update(readFileSync(path.join(root, name), 'utf8').replace(/\r\n/g, '\n')).digest('hex')]));
  return { exports, store_members: storeMembers, consumers: coupled, fingerprints,
    imports: Object.fromEntries(coupled.map((name) => [name, modules[name]])), routes, tests, effects };
}
