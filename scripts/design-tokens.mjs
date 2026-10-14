import { readFileSync, writeFileSync } from 'node:fs';
const tokens = JSON.parse(readFileSync('src/design-tokens.json', 'utf8'));
const block =
  '/* generated-tokens:start */\n' +
  Object.entries(tokens)
    .map(
      ([mode, colors]) =>
        `${mode === 'light' ? ':root' : ":root[data-theme='dark']"} {\n${Object.entries(colors)
          .map(([key, value]) => `  --${key}: ${value};`)
          .join('\n')}\n}`,
    )
    .join('\n') +
  '\n/* generated-tokens:end */';
const path = 'preview-design.css',
  source = readFileSync(path, 'utf8').replace(/\r\n/g, '\n');
const next = source.includes('/* generated-tokens:start */')
  ? source.replace(/\/\* generated-tokens:start \*\/[\s\S]*?\/\* generated-tokens:end \*\//, block)
  : source + '\n' + block + '\n';
if (process.argv.includes('--check')) {
  if (source !== next) {
    console.error('Preview tokens differ from native. Run pnpm tokens:sync.');
    process.exitCode = 1;
  }
} else writeFileSync(path, next);
