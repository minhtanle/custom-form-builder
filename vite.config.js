import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import { existsSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';

export default defineConfig(({ mode }) => {
  if (mode === 'builder') {
    // Builder app (Preact): src/builder/ -> dist/
    // Engine được build riêng (npm run build) thành dist/custom-dynamic-form.js, index.html
    // nhúng nó như script độc lập — KHÔNG bundle vào builder.js.
    const distDir = resolve(process.cwd(), 'dist');
    const engineFile = resolve(distDir, 'custom-dynamic-form.js');
    return {
      root: 'src/builder',
      base: './',
      plugins: [
        preact(),
        {
          name: 'ensure-engine-in-dist',
          closeBundle() {
            // outDir dùng chung dist/ nên emptyOutDir tắt để không xoá engine đã build;
            // dọn nốt thư mục dist/builder cũ (kế thừa từ cấu hình trước) nếu còn.
            rmSync(resolve(distDir, 'builder'), { recursive: true, force: true });
            if (!existsSync(engineFile)) {
              console.warn('[ensure-engine] Thiếu dist/custom-dynamic-form.js — hãy chạy `npm run build` trước rồi build lại builder.');
              return;
            }
            console.log('[ensure-engine] dist/custom-dynamic-form.js sẵn sàng — engine dùng độc lập.');
          }
        }
      ],
      build: {
        outDir: '../../dist',
        emptyOutDir: false,
        rollupOptions: {
          output: {
            entryFileNames: 'builder.js',
            chunkFileNames: 'builder-[name].js',
            assetFileNames: 'builder.css'
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