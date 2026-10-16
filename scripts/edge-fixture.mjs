import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
const require = createRequire(import.meta.url);
export function loadEdgeFunction(slug, mocks = {}, env = {}) {
  let handler;
  const source = readFileSync(
    new URL('../supabase/functions/' + slug + '/index.ts', import.meta.url),
    'utf8',
  );
  const code = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const module = { exports: {} };
  const sandbox = {
    module,
    exports: module.exports,
    Request,
    Response,
    URL,
    URLSearchParams,
    AbortSignal,
    console,
    fetch:
      mocks.fetch ??
      (() => {
        throw Error('Unmocked fetch');
      }),
    require: (name) => {
      if (name in mocks) return mocks[name];
      if (name.startsWith('jsr:')) return {};
      if (name === 'node:buffer') return require(name);
      throw Error('Unmocked ' + name);
    },
    Deno: { serve: (fn) => (handler = fn), env: { get: (name) => env[name] } },
  };
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox);
  return { handler, sandbox };
}
