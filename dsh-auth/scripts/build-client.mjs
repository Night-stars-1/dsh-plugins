/**
 * Build lib/client.js in the dsh client-module format: a closure-factory
 * artifact calling window.__ModuleLoader__.load({id, factory}) whose
 * externals resolve through the loader's injected require (platform module
 * table: react and friends are provided by the shell, never bundled).
 */

import { build } from 'esbuild'

const ID = '@night-stars-1/dsh-host-auth'

await build({
  entryPoints: ['client-src/index.ts'],
  bundle: true,
  format: 'cjs',
  platform: 'browser',
  target: 'es2022',
  jsx: 'automatic',
  outfile: 'lib/client.js',
  external: [
    'react', 'react/jsx-runtime', 'react-dom', 'react-dom/client',
    '@deepseek-ai/cordis',
    '@deepseek-ai/dsh-client-ui-slots',
    '@deepseek-ai/dsh-client-web-react',
    '@deepseek-ai/dsh-client-ui-primitives',
  ],
  banner: { js: `window.__ModuleLoader__.load({ id: ${JSON.stringify(ID)}, factory: (require) => { var module = { exports: {} }; var exports = module.exports;` },
  footer: { js: 'return module.exports; } });' },
})
console.log('client bundle written: lib/client.js')
