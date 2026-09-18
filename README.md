# Custom Form Builder

Công cụ xây dựng **form động theo JSON Schema** gồm 3 phần chính:

1. **Engine (FE)** — Web Component `<custom-dynamic-form>` tự render form, validate phía client và emit dữ liệu hợp lệ khi submit.
2. **Builder (FE)** — Giao diện kéo-thả để thiết kế form, xuất ra bộ `schema.json + uiSchema.json`.
3. **Validator (PHP)** — Backend validate lại dữ liệu theo đúng JSON Schema bằng [opis/json-schema](https://github.com/opis/json-schema) (nguồn sự thật là backend).

> **Luồng dùng:** Builder **thiết kế** form → lưu bộ schema/uiSchema → Engine **render + validate** phía client → PHP validate lại phía server.

---

## Mục lục

- [1. Cài đặt & bắt đầu nhanh](#1-cài-đặt--bắt-đầu-nhanh)
  - [1.1 Bắt đầu sau khi clone](#11-bắt-đầu-sau-khi-clone)
  - [1.2 Chạy dev server](#12-chạy-dev-server)
  - [1.3 Xem demo production](#13-xem-demo-production)
  - [1.4 Scripts hay dùng](#14-scripts-hay-dùng)
- [2. Cấu trúc thư mục](#2-cấu-trúc-thư-mục)
- [3. Chức năng từng phần](#3-chức-năng-từng-phần)
  - [3.1 Engine](#31-engine)
  - [3.2 Builder](#32-builder)
  - [3.3 lib/schema-compile.js](#33-libschema-compilejs)
  - [3.4 PHP](#34-php)
  - [3.5 Tests](#35-tests)
- [4. Tích hợp engine vào trang FE](#4-tích-hợp-engine-vào-trang-fe)
  - [4.1 Nhúng bundle vào trang](#41-nhúng-bundle-vào-trang)
  - [4.2 Gán schema/uiSchema trực tiếp bằng JS](#42-gán-schemauischema-trực-tiếp-bằng-js)
  - [4.3 Xử lý kết quả submit](#43-xử-lý-kết-quả-submit-onformsubmit)
- [5. Phát triển (chỉnh sửa engine & builder)](#5-phát-triển-chỉnh-sửa-engine--builder)
  - [5.1 Sửa Builder](#51-sửa-builder)
  - [5.2 Sửa Engine](#52-sửa-engine)
  - [5.3 Xem demo production](#53-xem-demo-production)
  - [5.4 Kiểm thử & Build bundle](#54-kiểm-thử--build-bundle)
- [6. Validator PHP (backend)](#6-validator-php-backend)
  - [6.1 Chuẩn bị](#61-chuẩn-bị)
  - [6.2 Dùng trong endpoint](#62-dùng-trong-endpoint)
  - [6.3 Contract FE-BE](#63-contract-fe-be)
  - [6.4 Layered validations (bắt buộc)](#64-layered-validations-bắt-buộc)
- [7. Lưu ý khi triển khai production](#7-lưu-ý-khi-triển-khai-production)

---

## 1. Cài đặt & bắt đầu nhanh

**Yêu cầu môi trường:**

| Thành phần | Yêu cầu | Ghi chú |
|---|---|---|
| Node.js | **v22 trở lên** | Vite/Rolldown cần `node:util.styleText` |
| npm | kèm theo Node | `npm install` |
| PHP | **7.4 trở lên** | Chỉ cần khi dùng phần validate backend (`opis/json-schema` hỗ trợ từ PHP 7.4) |
| Composer | có | `composer --working-dir=php install` |
| Trình duyệt | Chrome/Edge + | Hỗ trợ Custom Elements + Shadow DOM |

### 1.1 Bắt đầu sau khi clone

```powershell
# 1) Clone dự án
git clone <url-của-repo> custom-form-builder
cd custom-form-builder

# 2) Cài dependency FE
npm install

# 3) Cài dependency PHP (chỉ cần nếu dùng validator backend)
composer --working-dir=php install
# Nếu Laragon chưa có composer trong PATH: dùng Laragon terminal (đã có sẵn)
# hoặc trỏ thẳng tới composer.phar.

# 4) Kiểm tra nhanh: unit test (bắt buộc PASS trước khi build/commit)
npm test
```

### 1.2 Chạy dev server

```powershell
npm run dev:builder        # mở http://localhost:5173/
```

Trang mở ra là Builder (kéo-thả field, chỉnh thuộc tính, preview form ngay trong canvas). Vite có HMR — sửa code là trang reload ngay. Sửa `src/builder/` thì tự thấy; sửa engine `src/CustomDynamicForm.jsx` cũng ra ngay vì preview dùng engine từ source — chi tiết ở [mục 5](#5-phát-triển-chỉnh-sửa-engine--builder).

### 1.3 Xem demo production

```powershell
npm run build:all          # build engine + builder vào dist/
npm run preview:builder    # mở http://localhost:4173/ (Vite preview phục vụ đúng bản dist)
```

> **Đừng mở `dist/index.html` bằng double-click (`file://`).** Trang dùng `<script type="module" src="./builder.js">` nên trình duyệt chặn module khi không qua HTTP → trang trắng. Luôn phục vụ qua HTTP — dùng `preview:builder` như trên, hoặc bất kỳ web server tĩnh nào (Laragon: `http://localhost/custom-form-builder/dist/index.html`).

### 1.4 Scripts hay dùng

| Lệnh | Khi nào dùng |
|---|---|
| `npm run dev:builder` | Sửa builder **và/hoặc** engine (HMR, preview dùng chính engine từ source) — mở `http://localhost:5173/` |
| `npm test` | Unit test schema-compile (bắt buộc PASS trước khi commit/build) |
| `npm run build` | Build engine → `dist/custom-dynamic-form.js` |
| `npm run build:builder` | Build builder → `dist/builder.js`, `dist/builder.css`, `dist/index.html` (tự chèn script engine vào HTML) |
| `npm run build:all` | Build engine + builder (đúng thứ tự) — dùng trước demo production/deploy |
| `npm run preview:builder` | Phục vụ bản build đã có trong `dist/` qua HTTP tại `http://localhost:4173/` |
| `npm run build -- --watch` | Vừa sửa engine vừa tự cập nhật `dist/custom-dynamic-form.js` |

---

## 2. Cấu trúc thư mục

```
custom-form-builder/
├── src/                          # Nguồn FE
│   ├── CustomDynamicForm.jsx    # ENGINE: định nghĩa <custom-dynamic-form>
│   ├── styles.css                # CSS của form (được inline thẳng vào bundle)
│   ├── i18n.js                   # Chuỗi giao diện / lỗi (vi, en)
│   ├── sanitize.js               # Vệ sinh/chuẩn hóa dữ liệu form (XSS, ép kiểu theo schema)
│   └── builder/                  # BUILDER app (Preact + SortableJS)
│       ├── builder.jsx           # Logic builder: palette, canvas, settings, JSON out
│       ├── builder.css           # Style của builder
│       └── index.html            # Trang dev của builder
├── lib/
│   └── schema-compile.js         # UMD: compile config <-> JSON Schema (dùng chung Builder & Tests)
├── php/                          # Backend validate
│   ├── validate_form.php         # Hàm csValidateFormData() + collect/làm phẳng lỗi
│   ├── example_validate.php      # Endpoint mẫu (đọc body JSON, trả 200/422/400)
│   ├── composer.json             # require opis/json-schema ^2.6
│   ├── composer.lock
│   └── vendor/                   # Composer (bỏ vào .gitignore)
├── dist/                         # Kết quả build (không sửa tay) — cả 2 file nằm chung 1 thư mục
│   ├── custom-dynamic-form.js    # Engine bundle (IIFE) — nhúng qua <script src>, chạy độc lập
│   ├── builder.js                # Builder app (KHÔNG bundle engine vào chung)
│   ├── builder.css               # Style của builder
│   └── index.html                # Trang builder: nạp custom-dynamic-form.js + builder.js
├── tests/
│   └── test-schema.mjs           # Unit test cho schema-compile (chạy bằng `npm test`)
├── docs/
│   └── development-notes.md      # Ghi chú hướng phát triển / tối ưu build
├── deploy-gh.sh                  # Build dist/ rồi push lên branch gh-pages
├── vite.config.js                # Cấu hình build 2 chế độ: engine lib / builder app
└── package.json
```

---

## 3. Chức năng từng phần

### 3.1 Engine

**File:** `src/CustomDynamicForm.jsx` → build ra `dist/custom-dynamic-form.js`.

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

### 3.2 Builder

**Folder:** `src/builder/` → build ra `dist/builder.js` + `dist/index.html`.

- Kéo-thả field từ palette xuống canvas (SortableJS), xóa/di chuyển/kéo thả sắp xếp.
- Chỉnh sửa thuộc tính field trong panel phải: label, key, required, grid, value mặc định, quy tắc validate.
- **Select / Radio**: thêm/sửa/xóa từng option; đánh dấu **mặc định** ngay trong từng option; khai báo **field con** theo điều kiện (sinh ra `if/then`).
- Preview trực tiếp bằng chính engine.
- Xuất JSON trực tiếp ra textarea `json-out` (schema + uiSchema); có Import để nạp lại.
- Tự lưu vào `localStorage` (key `custom-form-builder:forms`); có form mẫu "Đăng ký tham gia".

### 3.3 lib/schema-compile.js

- Chuyển đổi hai chiều giữa config đơn giản của Builder và JSON Schema chuẩn:
  - `compile(config, uiSchema)` → bộ `{ schema, uiSchema }`.
  - `importConfig(schema, uiSchema)` → config của Builder.
- **Select/Radio luôn xuất `oneOf: [{ const, title }]`** (không dùng `enum` khi compile mới).
- Khi import schema cũ vẫn đọc được `enum`/`enumNames` (legacy) rồi chuyển về `oneOf`.

### 3.4 PHP

**Folder:** `php/`

- `csValidateFormData(array $data, string $schemaPath): array`
  - Nạp schema từ file, validate bằng `Opis\JsonSchema\Validator`.
  - Trả `['ok' => bool, 'errors' => [['field', 'code', 'message'], …]]`.
  - Lỗi được làm phẳng (giữ node lá, gỡ trùng), map đúng tên field, kể cả lỗi `required` trong `if/then` và lỗi `oneOf` (so khớp `const`).
- `example_validate.php` — endpoint mẫu:
  - `200` nếu hợp lệ, `422` nếu sai rule, `400` nếu body không phải JSON hợp lệ.

### 3.5 Tests

- `npm test` → chạy `tests/test-schema.mjs`: kiểm tra compile/import round-trip, migration `enum → oneOf`, dedup option trùng, `default` theo `const`…

---

## 4. Tích hợp engine vào trang FE

### 4.1 Nhúng bundle vào trang

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

(`dist/` trong `src` chỉ là ví dụ tùy nơi bạn host; điều kiện tiên quyết là trang phải chạy qua HTTP.)

### 4.2 Gán schema/uiSchema trực tiếp bằng JS

Không cần fetch — gán object trực tiếp:

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

### 4.3 Xử lý kết quả submit (`onFormSubmit`)

**Khi form hợp lệ — event `onFormSubmit` được phát, `e.detail` là toàn bộ dữ liệu form** (đã áp giá trị `default`, đúng kiểu dữ liệu theo schema):

```js
formEl.addEventListener('onFormSubmit', (e) => {
  // e.detail — ví dụ:
  // {
  //   "relation": 1,               // number (khớp const), không phải chuỗi
  //   "ma_nhan_vien": "NV001",
  //   "dang_ky_nhan_tin": true
  // }
  fetch('/api/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(e.detail),
  });
});
```

**Khi form có lỗi — event `onFormSubmit` KHÔNG được phát.** Engine tự hiển thị lỗi ngay cạnh từng field (message đã chuẩn hóa qua i18n, kiểu `"Vui lòng kiểm tra lại trường [Tên]"`) và KHÔNG có event/payload lỗi nào khác; bạn không nên tự render lỗi FE trong listener này.

> Vì thế FE chỉ xử lý nhánh *thành công* trong `onFormSubmit`. Mọi trường hợp lỗi còn thiếu sót phải được chặn lại ở backend — xem phần [6. Validator PHP (backend)](#6-validator-php-backend) (backend trả `ok: false` + danh sách lỗi `{field, code, message}` khi HTTP 422).

---

## 5. Phát triển (chỉnh sửa engine & builder)

Làm việc code hằng ngày chỉ cần **một** lệnh `npm run dev:builder` (vừa sửa được builder, vừa sửa được engine qua preview). Build chỉ cần khi muốn chạy thử bản production, trước khi commit/test, hoặc deploy.

### 5.1 Sửa Builder

**File:** `src/builder/builder.jsx`, `src/builder/builder.css`.

```powershell
npm run dev:builder        # mở http://localhost:5173/
```

Vite chạy ở chế độ builder, có HMR: sửa file → trang reload ngay, không cần build lại.

### 5.2 Sửa Engine

**File:** `src/CustomDynamicForm.jsx` (và `src/styles.css`, `src/i18n.js`, `src/sanitize.js`).

```powershell
npm run dev:builder        # vẫn cùng cổng dev trên
```

Trong dev server, builder nạp engine **trực tiếp từ source** (`builder.jsx` — `import.meta.env.DEV`), nên preview trong canvas chính là engine bạn vừa sửa và cập nhật ngay theo HMR. **Không cần build.** Cách này sửa được cả text hiển thị, style, logic render, validate của engine.

```powershell
# Tùy chọn: muốn vừa sửa vừa tạo bundle engine liên tục
npm run build -- --watch   # ghi đè dist/custom-dynamic-form.js mỗi lần save
```

### 5.3 Xem demo production

Xem đúng bản user thực sự dùng (engine nạp độc lập qua `<script src="custom-dynamic-form.js">`, tách khỏi `builder.js`):

```powershell
npm run build:all          # build engine + builder
npm run preview:builder    # mở http://localhost:4173/
```

### 5.4 Kiểm thử & Build bundle

**Bắt buộc `npm test` PASS trước khi build/commit:**

```powershell
npm test
```

```powershell
# Build đầy đủ
npm run build:all

# Hoặc build từng phần (chú ý thứ tự — cần file engine trước):
npm run build              # engine -> dist/custom-dynamic-form.js
npm run build:builder      # builder -> dist/builder.js + dist/builder.css + dist/index.html
```

- Build builder riêng lẻ: chạy `npm run build` **trước** để có sẵn `dist/custom-dynamic-form.js` (plugin chèn `<script src="custom-dynamic-form.js">` vào `dist/index.html` lúc build).
- Kiểm tra kết quả: `dist/custom-dynamic-form.js`, `dist/builder.js`, `dist/index.html` phải vừa được sinh/chạm lại đúng thời điểm build.
- Hai bundle độc lập — copy thẳng lên web server tĩnh (Apache/Nginx/Laragon public) là chạy.

---

## 6. Validator PHP (backend)

### 6.1 Chuẩn bị

```bash
composer --working-dir=php install
```

Copy file cần dùng vào project backend: `php/validate_form.php`
(nếu chưa có `vendor/` thì cài lại composer ở thư mục đó).

### 6.2 Dùng trong endpoint

```php
require_once __DIR__ . '/vendor/autoload.php';
require_once __DIR__ . '/validate_form.php';

$payload = json_decode(file_get_contents('php://input'), true);
$result  = csValidateFormData($payload, __DIR__ . '/schema.json');

if ($result['ok']) {
    http_response_code(200);
    echo json_encode(['ok' => true, 'errors' => [], 'data' => $payload]);
} else {
    http_response_code(422);
    echo json_encode(['ok' => false, 'errors' => $result['errors']]);
}
```

Tham khảo endpoint hoàn chỉnh ở `php/example_validate.php`.

### 6.3 Contract FE-BE

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

---

## 7. Lưu ý khi triển khai production

- `dist/` là build tĩnh → phục vụ trực tiếp nếu chỉ có form (kèm file schema/uiSchema).
- Nếu gửi schema qua API, version hóa theo chiến dịch/sự kiện: `schema.v1.json`, `schema.v2.json`, ...
- Phân tách message hiển thị cho người dùng (i18n) và message kỹ thuật cho log.
- Log toàn bộ `errors` từ PHP để theo dõi chất lượng dữ liệu.