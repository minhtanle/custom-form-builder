# Development Notes — Tối ưu dung lượng build `custom-dynamic-form`

> Trạng thái: **PENDING — chưa triển khai** (ghi chú kế hoạch, không phải tài liệu code đã thực thi).

---

## 1. Mục tiêu

- Giảm `dist/custom-dynamic-form.js` từ **~51 kB → mục tiêu ~33-35 kB**.
- Tách CSS thành file riêng `dist/custom-dynamic-form.css` (load CSS trước, rồi JS).
- Không đổi hành vi validate/render trên trình duyệt.

## 2. Hiện trạng bundle (~51 kB)

| Thành phần | Nguồn | ~kB min | % bundle |
|---|---|---|---|
| `@cfworker/json-schema` | validate.js + dereference.js + format.js | ~16-18 | ~35% |
| `preact` + `preact/hooks` | proj | ~8 | ~16% |
| CSS nhúng (`?inline`) | `src/styles.css` | ~6-7 | ~12% |
| Logic component (JSX → JS) | `src/CustomDynamicForm.jsx` | ~12 | ~23% |
| `sanitize.js` + `i18n.js` | | ~3-4 | ~7% |

## 3. Khảo sát package thay thế (số liệu Bundlephobia — raw min / gzip)

| Package | Raw min | Gzip | full JSON Schema | `const` + `if/then` | Ghi chú |
|---|---|---|---|---|---|
| **`@cfworker/json-schema`** (đang dùng) | 21.9 kB | 6.0 kB | draft 4/7/2019/2020 | ✅ | nhẹ nhất nhóm full |
| `@exodus/schemasafe` | 55.2 kB | 18.9 kB | draft 4 → 2020-12 | ✅ | nặng gấp ~3x |
| `tv4` | 28.7 kB | 8.2 kB | draft-04 | ❌ | nặng hơn, thiếu keyword |
| `jsen` | 23.0 kB | 6.8 kB | draft-04 | ❌ | nặng hơn, bỏ hoang, sideEffects |
| `@sinclair/typebox` | 45.7 kB | 12.4 kB | (type-builder + Value) | — | TypeScript type-builder, **sai kiến trúc** với dự án JS thuần nhận JSON Schema JSON |

**Kết luận:** không có package full-validator nhẹ hơn cfworker. Muốn giảm tiếp phải tự viết validator mini cover đúng subset `lib/schema-compile.js` sinh ra.

## 4. Hướng đã chốt

- Tự viết **`src/validate-core.js`** (~5-7 kB raw): `createMiniValidator(schema)` → `{ validate(data) }` → `{ valid, errors }`.
- **Port trung thành** handler của cfworker cho subset cần dùng (không phát minh logic mới).
- **Giữ `@cfworker/json-schema` ở `devDependencies`** làm *oracle* cho differential test vĩnh viễn.

## 5. Các bước triển khai

1. Viết `src/validate-core.js` — port subset + `format.js` + `ucs2length`.
2. `src/CustomDynamicForm.jsx`: thay `import { Validator }` → `import { createMiniValidator }` (mã map field `:356-369` giữ nguyên).
3. `tests/test-validate-core.mjs` — unit test từng keyword.
4. `tests/diff-vs-cfworker.mjs` — differential: sinh corpus = `SchemaCompile.compile()` cho mọi kiểu field + hàng trăm data hợp lệ/không hợp lệ; assert `valid` + field-mapping **giống tuyệt đối**. Chạy trong `npm test`.
5. `package.json`: chuyển `@cfworker/json-schema` `dependencies` → `devDependencies`.
6. Tách CSS (`?url` + `<link>` trong shadow root; `assetsInlineLimit: 0`; `assetFileNames: 'custom-dynamic-form.css'`) + tighten terser (`passes: 2`, `drop_debugger`, `collapse_vars`, `hoist_props`).
7. Build engine + builder, so size trước/sau, mở `dist/index.html`.

## 6. Hành vi tinh tế của cfworker BẮT BUỘC port đúng

| Keyword | Hành vi |
|---|---|
| `type: integer` | `instance % 1 === 0 && instance === instance` (loại NaN) |
| `const` / `enum` | object/array → `deepCompareStrict`; primitive → `===` |
| `oneOf` | hợp lệ chỉ khi **đúng 1** subschema match (0 hoặc >1 đều lỗi) |
| `if/then/else` | chạy `if` → valid thì validate `then`, ngược lại `else` |
| `minimum/maximum` + `exclusive*` | **3 nhánh**: `exclusiveMinimum === true` → `instance <= minimum` fail; `minimum` → `instance < minimum` fail; `exclusiveMinimum` (số) → `instance <= exclusiveMinimum` fail |
| `multipleOf` | riêng nhánh `% !== 0` |
| `minLength/maxLength` | dùng **`ucs2length`** (surrogate pair = 1 code point) — quan trọng text tiếng Việt/emoji |
| `pattern` | `new RegExp(pattern, 'u')` — cờ unicode |
| `format` | chỉ chạy khi có trong registry; **thiếu format → bỏ qua** (lý do engine tự regex `phone`) |
| `properties` | chỉ validate key **có trong instance** (`key in instance`); error gồm wrapper `properties` + nested; shortCircuit break sau lỗi đầu |
| `required` | `!(key in instance)` |

> **Phạm vi parity:** engine chỉ đọc `valid` + map segment → tên field. So sánh cần đúng 2 điều: (1) `valid` giống, (2) tập field bị đánh lỗi giống. Không cần error-array byte-for-byte.

## 7. Giới hạn & rủi ro

- Keyword **ngoài subset** (`$ref`, `dependentSchemas`, `unevaluatedProperties`, `uniqueItems`, `contains`, draft machinery…) không được validate (cfworker có).
- Test add **assert schema do `schema-compile` sinh chỉ dùng keyword trong danh sách hỗ trợ** → bắt sớm nếu builder sinh keyword mới; lúc đó thêm handler + test parity tương ứng.
- **Backend PHP (`opis/json-schema`) vẫn là nguồn sự thật** — engine chỉ là lớp phản hồi nhanh.
- Nếu sau này vẫn muốn giảm nữa: mục tiêu kế tiếp là `preact` (~8 kB) — viết lại phần render bằng DOM thuần (cần cẩn thận focus/typing), tạm thời KHÔNG làm.

## 8. Verification checklist

- [ ] `npm test` (schema + sanitize + validate-core + diff-vs-cfworker) đều PASS
- [ ] `npm run build` → `dist/custom-dynamic-form.js` + `.css` tồn tại; JS giảm về ~33-35 kB
- [ ] grep `dist/custom-dynamic-form.js` không còn `Validator`/`@cfworker` code
- [ ] `npm run build:builder` → preview builder vẫn style đúng
- [ ] Mở `dist/index.html` qua Laragon → form style đúng, submit OK (email/phone/number/radio con)