# Custom Form Builder

Công cụ xây dựng **form động theo JSON Schema** gồm 3 phần chính:

1. **Engine (FE)** — Web Component `<custom-dynamic-form>` tự render form, validate phía client và emit dữ liệu hợp lệ khi submit.
2. **Builder (FE)** — Giao diện kéo-thả để thiết kế form, xuất ra bộ `schema.json + uiSchema.json`.
3. **Validator (PHP)** — Backend validate lại dữ liệu theo đúng JSON Schema bằng [opis/json-schema](https://github.com/opis/json-schema) (nguồn sự thật là backend).

---

## Mục lục

- [1. Yêu cầu môi trường](#1-yêu-cầu-môi-trường)
- [2. Cấu trúc thư mục](#2-cấu-trúc-thư-mục)
- [3. Chức năng từng phần](#3-chức-năng-từng-phần)
- [4. Cấu hình & cài đặt](#4-cấu-hình--cài-đặt)
- [5. Triển khai FE](#5-triển-khai-fe)
- [6. Triển khai PHP](#6-triển-khai-php)
- [7. Lưu ý khi triển khai production](#7-lưu-ý-khi-triển-khai-production)

---

## 1. Yêu cầu môi trường

| Thành phần | Yêu cầu | Ghi chú |
|---|---|---|
| Node.js | **v22 trở lên** | Vite/Rolldown cần `node:util.styleText` |
| npm | kèm theo Node | `npm install` |
| PHP | 8.0+ | Chỉ cần khi dùng phần validate backend |
| Composer | có | `composer --working-dir=php install` |
| Trình duyệt | Chrome/Edge + | Hỗ trợ Custom Elements + Shadow DOM |

---

## 2. Cấu trúc thư mục

```
custom-form-builder/
├── src/                          # Nguồn FE
│   ├── CustomDynamicForm.jsx    # ENGINE: định nghĩa <custom-dynamic-form>
│   ├── styles.css                # CSS của form (được inline thẳng vào bundle)
│   ├── i18n.js                   # Chuỗi giao diện / lỗi (vi, en)
│   └── builder/                  # BUILDER app (Preact + SortableJS)
│       ├── builder.jsx           # Logic builder: palette, canvas, settings, JSON out
│       ├── builder.css           # Style của builder
│       └── index.html            # Trang dev của builder
├── lib/
│   └── schema-compile.js         # UMD: compile config <-> JSON Schema (dùng chung Builder & Tests)
├── php/                          # Backend validate
│   ├── validate_form.php         # Hàm vraceValidateFormData() + collect/làm phẳng lỗi
│   ├── example_validate.php      # Endpoint mẫu (đọc body JSON, trả 200/422/400)
│   ├── composer.json             # require opis/json-schema ^2.6
│   └── vendor/                   # Composer (đã bỏ vào .gitignore)
├── dist/                         # Kết quả build (không sửa tay)
│   ├── custom-dynamic-form.js    # Engine bundle (IIFE) — nhúng qua <script src>
│   └── builder/                  # Builder đã build — chạy tĩnh như trang thường
├── examples/
│   ├── index.html                # Nhúng engine + gán schema/uiSchema bằng JS
│   ├── live.html                 # Nhúng bundle dist + tải schema từ file JSON
│   └── data/
│       ├── schema.json           # JSON Schema sinh từ builder (ém dưới dạng oneOf)
│       └── uiSchema.json         # UI schema (widget, layout, idPrefix)
├── tests/
│   └── test-schema.mjs           # Unit test cho schema-compile (chạy bằng `npm test`)
├── docs/
│   └── integration-php.md        # Hướng dẫn chi tiết tích hợp PHP
├── vite.config.js                # Cấu hình build 2 chế độ: engine lib / builder app
└── package.json
```

---

## 3. Chức năng từng phần

### 3.1 Engine — `src/CustomDynamicForm.jsx` → `dist/custom-dynamic-form.js`

- Đăng ký Web Component **`<custom-dynamic-form>`**.
- Nhận cấu hình qua 2 property: `formEl.schema` (JSON Schema) và `formEl.uiSchema` (widget + layout + `idPrefix`).
- Render động các loại field: `text, number, email, url, phone, textarea, date, select, radio, checkbox, hidden`.
- Hiện/ẩn field theo điều kiện `if/then` trên schema (dùng cho option con của radio/select).
- Validate phía client bằng `@cfworker/json-schema` (required, type, oneOf/const, if/then…).
- CSS nằm sẵn trong Shadow DOM → không phụ thuộc Tailwind/Bootstrap của trang chủ.
- API công khai:
  - `formEl.schema = …` / `formEl.uiSchema = …` — thuộc tính setter, tự render lại.
  - `formEl.submitForm()` — gọi validate + emit từ nút ngoài form.
  - Event `onFormSubmit` — emit khi validate thành công, `e.detail` là dữ liệu form.

### 3.2 Builder — `src/builder/` → `dist/builder/`

- Kéo-thả field từ palette xuống canvas (SortableJS), xóa/di chuyển/kéo thả sắp xếp.
- Chỉnh sửa thuộc tính field trong panel phải: label, key, required, grid, value mặc định, quy tắc validate.
- **Select / Radio**: thêm/sửa/xóa từng option; đánh dấu **mặc định** ngay trong từng option; khai báo **field con** theo điều kiện (sinh ra `if/then`).
- Preview trực tiếp bằng chính engine.
- Xuất JSON trực tiếp ra textarea `json-out` (schema + uiSchema); có Import để nạp lại.
- Tự lưu vào `localStorage` (key `custom-form-builder:forms`); có form mẫu "Đăng ký tham gia".

### 3.3 `lib/schema-compile.js`

- Chuyển đổi hai chiều giữa config đơn giản của Builder và JSON Schema chuẩn:
  - `compile(config, uiSchema)` → bộ `{ schema, uiSchema }`.
  - `importConfig(schema, uiSchema)` → config của Builder.
- **Select/Radio luôn xuất `oneOf: [{ const, title }]`** (không dùng `enum` khi compile mới).
- Khi import schema cũ vẫn đọc được `enum`/`enumNames` (legacy) rồi chuyển về `oneOf`.

### 3.4 PHP — `php/`

- `vraceValidateFormData(array $data, string $schemaPath): array`
  - Nạp schema từ file, validate bằng `Opis\JsonSchema\Validator`.
  - Trả `['ok' => bool, 'errors' => [['field', 'code', 'message'], …]]`.
  - Lỗi được làm phẳng (giữ node lá, gỡ trùng), map đúng tên field, kể cả lỗi `required` trong `if/then` và lỗi `oneOf` (so khớp `const`).
- `example_validate.php` — endpoint mẫu:
  - `200` nếu hợp lệ, `422` nếu sai rule, `400` nếu body không phải JSON hợp lệ.

### 3.5 Tests

- `npm test` → chạy `tests/test-schema.mjs`: kiểm tra compile/import round-trip, migration `enum → oneOf`, dedup option trùng, `default` theo `const`…

---

## 4. Cấu hình & cài đặt

### 4.1 Các bước thao tác sau khi clone về

```powershell
# 1) Clone dự án
git clone <url-của-repo> custom-form-builder
cd custom-form-builder

# 2) Cài dependency FE
npm install

# 3) Cài dependency PHP (bắt buộc nếu dùng validator backend)
composer --working-dir=php install

# 4) Kiểm tra nhanh: chạy unit test (bắt buộc phải PASS trước khi build)
npm test

# 5) Build 2 bundle FE
npm run build                 # -> dist/custom-dynamic-form.js (engine)
npm run build:builder         # -> dist/builder/ (app builder)

# 6) (Tùy chọn) Test nhanh PHP validator
php -l php/validate_form.php
php -l php/example_validate.php
```

> Kiểm tra kết quả bước 5: hai thư mục `dist/custom-dynamic-form.js` và `dist/builder/`
> phải vừa được sinh/chạm lại đúng thời điểm build.

**Sau đó mở trang demo theo 1 trong 2 cách:**

```powershell
# Cách A — Dev server Vite (nhanh, tự reload khi sửa code)
npm run dev                 # engine demo:  http://localhost:5173/examples/index.html
npm run dev:builder         # builder demo: http://localhost:5173/      (khi port trống)

# Cách B — Copy build ra web server tĩnh (giống production)
#   - Mở examples/live.html trong Laragon http://localhost/custom-form-builder/examples/live.html
#   - Builder: http://localhost/custom-form-builder/dist/builder/index.html
```

### 4.2 Cài dependency

```bash
# FE
npm install

# PHP (chỉ cần nếu dùng validator)
composer --working-dir=php install
```

Nếu laragon chưa có `composer` trong PATH: chạy trong Laragon terminal (đã có sẵn)
hoặc trỏ thẳng tới `composer.phar`.

### 4.3 Scripts hay dùng

| Lệnh | Mô tả |
|---|---|
| `npm run dev` | Dev server cho engine (Vite mặc định port `5173`) |
| `npm run dev:builder` | Dev server cho builder (`vite --mode builder`) |
| `npm test` | Chạy unit test schema-compile |
| `npm run build` | Build engine → `dist/custom-dynamic-form.js` |
| `npm run build:builder` | Build builder → `dist/builder/` |
| `npm run build -- --watch` | Build engine chế độ watch (pass-through Vite) |

---

## 5. Triển khai FE

### 5.1 Build

```powershell
# 1) Build engine
npm run build

# 2) Build builder
npm run build:builder
```

Kết quả: `dist/custom-dynamic-form.js` và `dist/builder/`.
Hai bundle này độc lập — có thể copy thẳng lên web server tĩnh (Apache/Nginx/Laragon public).

### 5.2 Nhúng engine vào trang

```html
<!-- 1. Nạp bundle IIFE -->
<script src="dist/custom-dynamic-form.js"></script>

<!-- 2. Khai báo thẻ ở đúng vị trí muốn hiện form -->
<custom-dynamic-form id="my-dynamic-form"></custom-dynamic-form>

<script>
  window.addEventListener('load', async () => {
    const formEl = document.getElementById('my-dynamic-form');

    // Nạp cấu hình (có thể từ file tĩnh hoặc API PHP)
    const [schemaRes, uiSchemaRes] = await Promise.all([
      fetch('./data/schema.json'),
      fetch('./data/uiSchema.json'),
    ]);
    formEl.schema = await schemaRes.json();
    formEl.uiSchema = await uiSchemaRes.json();

    // Nhận dữ liệu khi form hợp lệ
    formEl.addEventListener('onFormSubmit', (e) => {
      console.log('Payload gửi lên backend:', e.detail);
    });
  });
</script>
```

### 5.3 Gán schema trực tiếp bằng JS

Không cần fetch — gán object như `examples/index.html`:

```js
formEl.schema = {
  type: 'object',
  properties: {
    relation: {
      type: 'integer', title: 'Đối tượng liên kết', default: 1,
      oneOf: [
        { const: 1, title: 'Thành viên' },
        { const: 2, title: 'Khách hàng / đối tác' },
      ],
    },
  },
  required: ['relation'],
  allOf: [
    { if: { properties: { relation: { const: 1 } } }, then: { required: ['ma_nhan_vien'] } },
  ],
};
formEl.uiSchema = {
  idPrefix: 'demo',
  fields: { relation: { 'ui:widget': 'radio' } },
  layout: [{ type: 'row', fields: [{ name: 'relation', grid: 12 }] }],
};
```

Gợi ý widget: `text`, `textarea`, `number`, `email`, `url`, `phone`, `date`,
`select`, `custom-select` (dropdown kiểu mới), `radio`, `checkbox`, `hidden`.

---

## 6. Triển khai PHP

### 6.1 Chuẩn bị

```bash
composer --working-dir=php install
```

Copy 2 file cần dùng vào project backend: `php/validate_form.php`
(nếu chưa có `vendor/` thì cài lại composer ở thư mục đó).

### 6.2 Dùng trong endpoint

```php
require_once __DIR__ . '/vendor/autoload.php';
require_once __DIR__ . '/validate_form.php';

$payload = json_decode(file_get_contents('php://input'), true);
$result  = vraceValidateFormData($payload, __DIR__ . '/schema.json');

if ($result['ok']) {
    http_response_code(200);
    echo json_encode(['ok' => true, 'errors' => [], 'data' => $payload]);
} else {
    http_response_code(422);
    echo json_encode(['ok' => false, 'errors' => $result['errors']]);
}
```

Tham khảo endpoint hoàn chỉnh ở `php/example_validate.php`.

### 6.3 Contract FE–BE

**Request**
```json
{ "relation": 1, "ma_nhan_vien": "NV001" }
```

**Response thành công (200)**
```json
{ "ok": true, "errors": [], "data": { "relation": 1, "ma_nhan_vien": "NV001" } }
```

**Response lỗi (422)**
```json
{
  "ok": false,
  "errors": [ { "field": "ma_nhan_vien", "code": "required", "message": "[ma_nhan_vien] is required." } ]
}
```

Quy ước: `code` là keyword JSON Schema (`required`, `type`, `oneOf`, `format`, …);
`field` là tên field nếu xác định được; `message` dùng để log/hiển thị.

### 6.4 Layered validations (bắt buộc)

- FE validate để trải nghiệm (phản hồi nhanh).
- **Backend luôn validate lại** — đây là nguồn sự thật, không tin dữ liệu FE.
- Xem thêm các case test bắt buộc và lưu ý production trong `docs/integration-php.md`.

---

## 7. Lưu ý khi triển khai production

- `dist/` là build tĩnh → phục vụ trực tiếp nếu chỉ có form (kèm file schema/uiSchema).
- Nếu gửi schema qua API, version hóa theo chiến dịch/sự kiện: `schema.v1.json`, `schema.v2.json`, ...
- Phân tách message hiển thị cho người dùng (i18n) và message kỹ thuật cho log.
- Log toàn bộ `errors` từ PHP để theo dõi chất lượng dữ liệu.