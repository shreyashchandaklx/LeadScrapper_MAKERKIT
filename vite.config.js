import { defineConfig, transformWithOxc } from 'vite';
import react from '@vitejs/plugin-react';

const transformJsxInJs = () => ({
  name: 'transform-jsx-in-js',
  enforce: 'pre',
  async transform(code, id) {
    if (!id.match(/\.js$/) || id.includes('node_modules')) {
      return null;
    }
    return await transformWithOxc(code, id, { lang: 'jsx' });
  },
});

export default defineConfig({
  plugins: [react(), transformJsxInJs()],
  optimizeDeps: {
    esbuild: {
      loader: { '.js': 'jsx' },
    },
  },
  server: {
    open: true,
  },
  build: {
    outDir: 'dist',
  },
});
