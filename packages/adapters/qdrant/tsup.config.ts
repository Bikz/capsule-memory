import { defineConfig } from 'tsup';

const OPTIONAL_EXTERNALS = new Set([
  'aws-sdk',
  'mock-aws-s3',
  'nock',
  '@babel/preset-typescript/package.json',
  'lightningcss',
  '@mapbox/node-pre-gyp'
]);

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  sourcemap: true,
  clean: true,
  bundle: false,
  external: [
    '@qdrant/js-client-rest',
    'aws-sdk',
    'mock-aws-s3',
    'nock',
    '@babel/preset-typescript/package.json',
    'lightningcss',
    '@mapbox/node-pre-gyp',
    '@mapbox/node-pre-gyp/lib/util/nw-pre-gyp/index.html'
  ],
  target: 'node18',
  esbuildOptions(options) {
    const externals = new Set(options.external ?? []);
    options.platform = 'node';
    options.conditions = ['node'];
    const existing = options.plugins ?? [];
    existing.push({
      name: 'ignore-optional-deps',
      setup(build) {
        build.onResolve({ filter: /.*/ }, (args) => {
          if (externals.has(args.path) || OPTIONAL_EXTERNALS.has(args.path)) {
            return { path: args.path, external: true };
          }
          return undefined;
        });
        build.onResolve({ filter: /@mapbox\/node-pre-gyp\/.*/ }, (args) => ({
          path: args.path,
          external: true
        }));
        build.onResolve({ filter: /\.html$/ }, () => ({ external: true }));
      }
    });
    options.plugins = existing;
  }
});
