import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';

export default defineConfig(({ mode }) => {
  if (mode === 'builder') {
    // Builder app (Preact): src/builder/ -> dist/builder/
    return {
      root: 'src/builder',
      base: './',
      plugins: [preact()],
      build: {
        outDir: '../../dist/builder',
        emptyOutDir: true,
        rollupOptions: {
          output: {
            manualChunks(id) {
              if (id.includes('node_modules/preact')) return 'preact';
              if (id.includes('node_modules/sortablejs')) return 'dnd';
            }
          }
        }
      }
    };
  }

  // Engine lib (iife): src/CustomDynamicForm.jsx -> dist/custom-dynamic-form.js
  return {
    plugins: [preact()],
    build: {
      emptyOutDir: false, // keep dist/builder (built separately via build:builder)
      lib: {
        entry: './src/CustomDynamicForm.jsx',
        name: 'CustomDynamicForm',
        fileName: () => 'custom-dynamic-form.js',
        formats: ['iife'] // Biên dịch ra định dạng chạy trực tiếp trên trình duyệt qua thẻ <script>
      },
      minify: 'terser', // Nén code ở mức tối đa
      terserOptions: {
        compress: {
          drop_console: true, // Tự động xóa các dòng console.log để giảm dung lượng file
        }
      }
    },
    define: {
      'process.env.NODE_ENV': JSON.stringify('production') // Ép môi trường production để thư viện tối ưu dung lượng
    }
  };
});