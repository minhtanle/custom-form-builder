# Custom Form Builder

Công cụ xây dựng **form động theo JSON Schema** gồm 3 phần chính:

1. **Engine (FE)** — Web Component `<custom-dynamic-form>` tự render form, validate phía client và emit dữ liệu hợp lệ khi submit.
2. **Builder (FE)** — Giao diện kéo-thả để thiết kế form, xuất ra bộ `{ schema, uiSchema, optionKeys }`.
3. **Validator (PHP)** — Backend validate lại dữ liệu theo đúng JSON Schema bằng [opis/json-schema](https://github.com/opis/json-schema) (nguồn sự thật là backend).

> **Luồng dùng:** Builder **thiết kế** form → lưu bộ `{ schema, uiSchema, optionKeys }` → Engine **render + validate** phía client → PHP validate lại phía server.

---

## Mục lục

- [Cách sử dụng nhanh](#cách-sử-dụng-nhanh)
- [1. Cài đặt](#1-cài-đặt)
  - [1.1 Bắt đầu sau khi clone](#11-bắt-đầu-sau-khi-clone)
  - [1.2 Scripts hay dùng](#12-scripts-hay-dùng)
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
  - [4.3 Xử lý kết quả submit](#43-xử-lý-kết-quả-submit)
  - [4.4 Luồng edit lại thông tin (formEl.data)](#44-luồng-edit-lại-thông-tin-formeldata)
  - [4.5 Options nạp từ API (setLists và optionKeys)](#45-options-nạp-từ-api-setlists-và-optionkeys)
  - [4.6 Triển khai select phụ thuộc (Tỉnh và Xã)](#46-triển-khai-select-phụ-thuộc-tỉnh-và-xã)
  - [4.7 Events](#47-events)
- [5. Phát triển (engine và builder)](#5-phát-triển-engine-và-builder)
- [6. Validator PHP (backend)](#6-validator-php-backend)
  - [6.1 Dùng trong endpoint](#61-dùng-trong-endpoint)
  - [6.2 Contract FE-BE](#62-contract-fe-be)
  - [6.3 Layered validations (bắt buộc)](#63-layered-validations-bắt-buộc)
- [7. Lưu ý khi triển khai production](#7-lưu-ý-khi-triển-khai-production)

---

## Cách sử dụng nhanh

Ba vai trò tích hợp: **FE** (hiển thị + thu thập dữ liệu), **API** (cấp cấu hình form + options), **BE** (validate lại — **nguồn sự thật**).

### FE — nhúng & vận hành form

```html
<script src="dist/custom-dynamic-form.js"></script>
<custom-dynamic-form id="f"></custom-dynamic-form>
```

```js
const f = document.getElementById('f');
f.schema   = cfg.schema;      // JSON Schema (viết tay / export từ Builder / từ API)
f.uiSchema = cfg.uiSchema;    // widget + layout (đi kèm schema)

// Submit hợp lệ → e.detail là toàn bộ dữ liệu form (đã áp `default`, đúng kiểu theo schema).
// Gửi thẳng `e.detail` lên backend:
//
//   e.detail =
//   {
//     "relation": 1,                // radio/select → const value (số giữ số)
//     "ho_ten": "Nguyễn Văn A",     // text/textarea → chuỗi
//     "gio_ht": 28800,              // time-slider → giây (số)
//     "ngay_dk": "2026-09-23",      // date → "YYYY-MM-DD" (chuỗi)
//     "dang_ky_nhan_tin": true      // checkbox → boolean
//   };
// Field trong nhánh conditional đang bị ẩn sẽ KHÔNG xuất hiện trong payload.
// Có lỗi validate → STILL phát onFormSubmit với e.detail = { isValid: false, errors } (xem §4.3).

f.addEventListener('onFormSubmit', (e) =>
  fetch('/api/submit', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(e.detail),
  })
);

// Sửa bản ghi đã lưu (prefill, gán 1 lần khi mở form):
f.data = { relation: 2, ho_ten: 'Nguyễn Văn A' };

// Dropdown/radio có toggle "Dữ liệu từ API" → gán options tại runtime:
f.setLists({ don_vi: [ { value: 'ha_noi', label: 'Hà Nội' }, { value: 'hcm', label: 'TP.HCM' } ] });
```

### API — cấp cấu hình & options

- Endpoint **cấu hình** trả đúng `{ schema, uiSchema, optionKeys }` (lấy từ file Builder export, hoặc `compile(config)` trong `lib/schema-compile.js`).
- Endpoint **options** trả `{ fieldName: [ { value, label }, … ] }` — chỉ cho field nằm trong `optionKeys`; FE nạp bằng `setLists()`. Field này **không** có `oneOf`/`default` trong schema.
- Muốn đổi danh sách (theo thao tác người dùng) chỉ cần gọi lại `setLists` — form render ngay list mới.

### BE — validate lại (bắt buộc)

```php
require_once __DIR__ . '/vendor/autoload.php';
require_once __DIR__ . '/validate_form.php';

$r = csValidateFormData(json_decode(file_get_contents('php://input'), true), __DIR__ . '/schema.json');
http_response_code($r['ok'] ? 200 : 422);
echo json_encode($r);   // { ok, errors, data }
```

- FE validate chỉ để trải nghiệm; **BE phải xác nhận lại mọi gửi lên**.
- Chi tiết: FE → [§4](#4-tích-hợp-engine-vào-trang-fe) · options API → [§4.5](#45-options-nạp-từ-api-setlists-và-optionkeys) · BE → [§6](#6-validator-php-backend).

---

## 1. Cài đặt

**Yêu cầu môi trường:**

| Thành phần | Yêu cầu | Ghi chú |
|---|---|---|
| Node.js | **v22 trở lên** | Vite/Rolldown cần `node:util.styleText` |
| PHP | **7.4 trở lên** | Chỉ cần khi dùng phần validate backend |
| Composer | có | `composer --working-dir=php install` |
| Trình duyệt | Chrome/Edge + | Hỗ trợ Custom Elements + Shadow DOM |

### 1.1 Bắt đầu sau khi clone

```powershell
git clone <url-của-repo> custom-form-builder
cd custom-form-builder
npm install                          # dependency FE
composer --working-dir=php install   # dependency PHP (chỉ nếu dùng validator backend)
npm test                             # bắt buộc PASS trước khi build/commit
```

### 1.2 Scripts hay dùng

| Lệnh | Dùng khi |
|---|---|
| `npm run dev` | Dev builder (HMR, preview dùng engine từ source) — mở `http://localhost:5173/` |
| `npm test` | Chạy cả 3 bộ test (schema/sanitize/conditional) — bắt buộc PASS trước commit |
| `npm run build` | Build engine + builder vào `dist/` (đúng thứ tự: engine trước) |
| `npm run build:engine` / `npm run build:builder` | Build riêng từng phần |
| `npm run build -- --watch` | Engine tự rebuild mỗi lần save source |
| `npm run prod` | Build + mở bản production tại `http://localhost:4173/` |
| `npm run preview:builder` | Phục vụ bản `dist/` đã có qua HTTP tại `http://localhost:4173/` |

---

## 2. Cấu trúc thư mục

```
custom-form-builder/
├── src/                          # Nguồn FE
│   ├── CustomDynamicForm.jsx    # ENGINE: định nghĩa <custom-dynamic-form>
│   ├── styles.css                # CSS của form (inline thẳng vào bundle)
│   ├── i18n.js                   # Chuỗi giao diện / lỗi (vi, en)
│   ├── sanitize.js               # Vệ sinh HTML nhúng từ schema (XSS)
│   ├── conditional.js            # Logic if/then — nguồn duy nhất mọi nơi bên engine
│   ├── options.js                # Chuẩn hóa option list (runtime + tĩnh)
│   ├── package.json              # {"type":"module"} để test chạy được ESM
│   └── builder/                  # BUILDER app (Preact + SortableJS)
│       ├── builder.jsx           # Logic builder: palette, canvas, settings, JSON out
│       ├── builder.css           # Style của builder
│       └── index.html            # Trang dev của builder
├── lib/
│   └── schema-compile.js         # UMD: compile config <-> JSON Schema (+ optionKeys)
├── php/                          # Backend validate
│   ├── validate_form.php         # csValidateFormData() + làm phẳng lỗi
│   ├── example_validate.php      # Endpoint mẫu (200/422/400)
│   ├── composer.json / composer.lock
│   └── vendor/                   # Composer (gitignore)
├── examples/
│   └── sample-form.json          # Demo đủ loại field + radio children (song ngữ)
├── dist/                         # Build (không sửa tay)
│   ├── custom-dynamic-form.js    # Engine bundle (IIFE) — nhúng độc lập
│   ├── builder.js / builder.css / index.html
├── tests/
│   ├── test-schema.mjs           # schema-compile: apiData, select-children, round-trip
│   ├── test-sanitize.mjs         # safeHtml/stripTags
│   └── test-conditional.mjs      # list/resolve/allOf conditional
├── docs/development-notes.md     # Ghi chú hướng phát triển / tối ưu build
├── deploy-gh.sh                  # Build dist/ rồi push lên gh-pages
├── vite.config.js                # Build 2 chế độ: engine lib / builder app
└── package.json
```

---

## 3. Chức năng từng phần

### 3.1 Engine

**File:** `src/CustomDynamicForm.jsx` → build ra `dist/custom-dynamic-form.js`.

- Đăng ký Web Component **`<custom-dynamic-form>`**; CSS nằm trong Shadow DOM → không phụ thuộc CSS của trang chủ.
- Render theo `formEl.schema` (JSON Schema) + `formEl.uiSchema` (widget + layout + `idPrefix`). Field: `text, number, email, url, phone, textarea, date, select, custom-select, radio, checkbox, hidden, time-slider`; element layout: `heading, paragraph, divider`.
- Hiện/ẩn field theo điều kiện `if/then` (option con của radio); validate client bằng `@cfworker/json-schema`.

#### Mục lục API — `<custom-dynamic-form>`

- **Properties**: [`schema`](#schema) · [`uiSchema`](#uischema) · [`data`](#data) · [`lang`](#lang)
- **Methods**: [`submitForm()`](#submitform) · [`setValue(name, value)`](#setvaluename-value) · [`setLists(byField)`](#setlistsbyfield)
- **Events**: [`onFormSubmit`](#onformsubmit) · [`onFieldChange`](#onfieldchange)

**Ví dụ trong mục này — mặc định có sẵn:**

```html
<custom-dynamic-form id="f"></custom-dynamic-form>
```

```js
const formEl = document.getElementById('f');   // formEl dùng chung cho mọi ví dụ dưới đây
```

---

#### `schema`

**Mô tả** — gán JSON Schema; setter render lại form ngay (khi `uiSchema` đã gán).

```js
formEl.schema = {
  type: 'object',
  properties: {
    relation: { type: 'integer', title: 'Đối tượng liên kết', default: 1 },
    ho_ten:   { type: 'string',  title: 'Họ tên', minLength: 2, maxLength: 50 },
  },
  required: ['relation', 'ho_ten'],
  allOf: [ { if: { properties: { relation: { const: 1 } } }, then: { required: ['ma_nhan_vien'] } } ],
};
```

Gán rồi liền `uiSchema` là form render ngay; hoặc gán schema lấy từ API:

```js
const { schema, uiSchema } = await fetch('/api/form-config').then((r) => r.json());
formEl.schema = schema;
formEl.uiSchema = uiSchema;
```

**Kết quả trả về** — `undefined` (setter).

**Các case:**
- Widget theo kiểu `properties[name].type`: text, number, email, url, phone, textarea, date, select, custom-select, radio, checkbox, hidden, time-slider.
- Chưa gán `uiSchema` → form chưa render (hiện loading); gán thêm `uiSchema` là render.
- Lấy schema từ: Builder export, viết tay, hoặc API cấp cấu hình ([§4.2](#42-gán-schemauischema-trực-tiếp-bằng-js)).

---

#### `uiSchema`

**Mô tả** — widget + layout + `idPrefix` cho schema đã gán.

```js
formEl.uiSchema = {
  idPrefix: 'demo',                                        // prefix id input, tránh trùng page
  fields: {
    relation: { 'ui:widget': 'radio' },                    // đổi widget (mặc định theo kiểu schema)
    ho_ten:   { placeholder: 'Nhập họ và tên' },
  },
  layout: [
    { type: 'row', fields: [ { name: 'relation', grid: 12 } ] },
    { type: 'row', fields: [ { name: 'ho_ten', grid: 6 }, { name: 'gio_ht', grid: 6 } ] },
    // layout cũng có thể là element: { type: 'heading' | 'paragraph' | 'divider', text: '…' }
  ],
};
```

**Kết quả trả về** — `undefined` (setter).

**Các case:**
- Không khai `layout` → tự sinh lưới theo thứ tự `schema.properties`.
- Bỏ `layout` cho field trong nhánh conditional (`then.required`) — engine tự render lồng.

---

#### `data`

**Mô tả** — prefill bản ghi khi sửa edit; gán **đúng 1 lần** khi mở form ([§4.4](#44-luồng-edit-lại-thông-tin-formeldata)).

```js
// Mở form sửa bản ghi: gán schema/uiSchema rồi gán data — value khớp payload onFormSubmit
formEl.schema   = cfg.schema;
formEl.uiSchema = cfg.uiSchema;
formEl.data = {
  relation: 2,                    // select/radio → const value
  gio_ht: 28800,                  // time-slider  → giây (số)
  ngay_dk: '2026-09-23',          // date         → 'YYYY-MM-DD' (chuỗi)
  dang_ky_nhan_tin: false,        // checkbox/boolean → false
};
```

**Kết quả trả về** — `undefined` (setter).

**Các case:**
- Key có trong `data` (kể cả `0`/`false`) → dùng giá trị đó; key không có → dùng `default` hoặc rỗng.
- Giá trị tự coerce đúng kiểu theo `schema.properties`.
- Mỗi lần gán `data` = **remount** core (state khởi tạo lại từ data).

---

#### `lang`

**Mô tả** — attribute chuẩn của HTMLElement; đổi ngôn ngữ i18n của engine.

```js
// Đổi ngôn ngữ theo lựa chọn của người dùng
document.querySelector('#lang-switch').addEventListener('change', (e) => {
  formEl.lang = e.target.value;          // 'vi' | 'en' (mặc định '') — render lại toàn bộ
});
```

**Kết quả trả về** — `undefined` (attribute).

**Các case:**
- Ngôn ngữ lỗi validate lấy từ `src/i18n.js`.

---

#### `submitForm()`

**Mô tả** — cách dùng với nút submit ngoài form (validate + bôi đỏ lỗi inline + phát `onFormSubmit`, chi tiết [§4.3](#43-xử-lý-kết-quả-submit)).

**Tham số** — không có.

```js
// Nút submit đặt NGOÀI <custom-dynamic-form>:
document.querySelector('#btn-submit').addEventListener('click', () => {
  const r = formEl.submitForm();

  if (!r.isValid) {
    // r.errors = { fieldName: "message" } — lỗi đã bôi đỏ inline, dừng không gửi
    console.warn('Form chưa hợp lệ:', r.errors);
    return;
  }
  // r.isValid === true
  // r.data = { field: value, ... } — chỉ field đang hiển thị, đã ép đúng kiểu
  fetch('/api/submit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(r.data),
  });
});
```

**Kết quả trả về** — các trường hợp:

```js
const r = formEl.submitForm();

// → { isValid: true, data }                     HỢP LỆ
//     data = { field: value, ... }  chỉ field đang hiển thị, đã ép đúng kiểu
//                                    (number → số, boolean → true/false,
//                                     time-slider → giây, date → 'YYYY-MM-DD')

// → { isValid: false, errors }                  LỖI VALIDATE
//     errors = { fieldName: "message" }  lỗi đồng thời render inline
//     onFormSubmit vẫn phát detail = { isValid: false, errors }

// → null                                        CHƯA GÁN schema / uiSchema
```

- Nút submit bên trong form (nếu có) cũng đi qua cùng luồng — không cần return.

---

#### `setValue(name, value)`

**Mô tả** — gán/reset 1 field từ bên ngoài; ví dụ điển hình: đổi Tỉnh phải reset Xã ([§4.6](#46-triển-khai-select-phụ-thuộc-tỉnh-và-xã)).

```js
// Luồng "Tỉnh → Xã": khi user đổi Tỉnh thì reset Xã cũ rồi mới nạp list Xã mới
formEl.addEventListener('onFieldChange', ({ detail }) => {
  if (detail.name !== 'tinh') return;

  formEl.setValue('xa', '');                       // reset Xã cũ + xóa lỗi Xã (không remount)
  if (!detail.value) { formEl.setLists({ xa: [] }); return; }

  const xaList = await fetch(`/api/xa?tinh=${encodeURIComponent(detail.value)}`).then((r) => r.json());
  formEl.setLists({ xa: xaList });
});
```

**Tham số:**
- `name` — `string`: key field, cần có trong `schema.properties`.
- `value` — giá trị mới theo kiểu field (tự coerce).

**Kết quả trả về** — `undefined`.

**Các case:**
- KHÔNG remount form (khác `data`).
- Xóa lỗi của field đó; không đụng lỗi field khác.
- KHÔNG phát sự kiện `onFieldChange`.
- No-op nếu form chưa render (chưa gán `schema`/`uiSchema`).

---

#### `setLists(byField)`

**Mô tả** — gán options runtime cho select/radio "Dữ liệu từ API" ([§4.5](#45-options-nạp-từ-api-setlists-và-optionkeys)).

```js
// Nạp list trước khi render form (hoặc khi user đổi Tỉnh):
const tinh = await fetch('/api/tinh').then((r) => r.json());
// tinh = [ { value: '01', label: 'Hà Nội' }, { value: '79', label: 'TP. Hồ Chí Minh' }, ... ]

formEl.setLists({ tinh });
```

**Tham số** — `byField`: `{ [fieldName]: Array<{ value: string, label: string }> }`.

**Kết quả trả về** — `undefined`.

**Các case:**
- List runtime **ưu tiên hơn** `oneOf` tĩnh; gọi lại nhiều lần được, form render ngay list mới.
- Tự chuẩn hóa: chuỗi hóa `value`, dedup theo `value`, bỏ item thiếu `value`.
- Nên chỉ gọi cho field nằm trong `optionKeys`.
- Chưa gọi `setLists` → select/custom-select hiện "-- Chọn --".

---

#### `onFormSubmit`

**Mô tả** — kết quả xử lý submit (thành công hoặc lỗi).

```js
// Cách phổ biến nhất: gửi dữ liệu form lên BE khi submit (không cần nút ngoài)
formEl.addEventListener('onFormSubmit', async (e) => {
  if (e.detail && e.detail.isValid === false) {
    // e.detail = { isValid: false, errors: { fieldName: "message" } }   — LỖI
    // (lỗi đã render inline; ở đây có thể log/popup)
    console.error('Form lỗi:', e.detail.errors);
    return;
  }
  // e.detail = { field: value, ... } — toàn bộ dữ liệu đã coerce, payload gửi BE — HỢP LỆ
  await fetch('/api/submit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(e.detail),
  });
});
```

**Khi phát:**
- Mỗi lần submit — nút trong form hoặc `formEl.submitForm()`; **kể cả khi validate lỗi**.
- Nghe trực tiếp trên element.

---

#### `onFieldChange`

**Mô tả** — field thay đổi giá trị do user thao tác.

```js
// Log mọi thay đổi field — vd: "tinh = 01"
formEl.addEventListener('onFieldChange', ({ detail }) => {
  const { name, value } = detail;
  console.log(`${name} = ${value}`);
  // detail = { name: "tinh", value: "01" } — value đã coerce đúng kiểu theo schema
});
```

**Các case:**
- Phát khi user: gõ input/textarea, chọn select/radio/custom-select, bật checkbox, kéo time-slider… (mọi field).
- KHÔNG phát khi gán qua `formEl.data`, `formEl.setValue()`, hay field ẩn/hiện theo conditional.
- Chọn lại đúng giá trị cũ vẫn phát (chưa dedup) — app tự lọc theo `detail.name`.
- KHÔNG có `prevValue`/`formData` trong detail — cần giá trị cũ thì tự giữ map.

Lưu ý chung events: phát với `bubbles:false, composed:false` → **phải `addEventListener` trực tiếp trên element** (dùng `document.getElementById`, không qua wrapper/document — tránh listener hụt).

### 3.2 Builder

**Folder:** `src/builder/` → build ra `dist/builder.js` + `dist/index.html`.

- Kéo-thả field (SortableJS), chỉnh thuộc tính trong panel phải (label, key, required, grid, default, validate).
- **Select / Radio**: quản lý từng option (thêm/sửa/xóa, đánh dấu mặc định), khai báo **field con** theo điều kiện (sinh `if/then`), toggle **"Dữ liệu từ API"** → bỏ nhập option tĩnh, key tự vào `optionKeys` ([4.5](#45-options-nạp-từ-api-setlists-và-optionkeys)).
- Preview bằng chính engine; xuất/import JSON ra textarea `json-out`; tự lưu `localStorage` (`custom-form-builder:forms`).

### 3.3 lib/schema-compile.js

- Chuyển đổi hai chiều:
  - `compile(config)` → `{ schema, uiSchema, optionKeys }`.
  - `importConfig({ schema, uiSchema, optionKeys })` → config của Builder.
- **Select/Radio luôn xuất `oneOf: [{ const, title }]`** (không dùng `enum` khi compile mới); import vẫn đọc `enum`/`enumNames` (legacy).
- Field **"Dữ liệu từ API"** (`apiData: true`): schema KHÔNG nhúng `oneOf`/`enum`/`default`; key vào `optionKeys`; import đọc `doc.optionKeys` để khôi phục `apiData`.

### 3.4 PHP

- `csValidateFormData(array $data, string $schemaPath): array`
  - Validate bằng `Opis\JsonSchema\Validator`; trả `['ok', 'errors' => [['field','code','message']]]`.
  - Lỗi làm phẳng, map đúng tên field, kể cả `required` trong `if/then` và `oneOf` (so `const`).
- `example_validate.php` — endpoint mẫu: `200` hợp lệ, `422` sai rule, `400` body không phải JSON.

### 3.5 Tests

- `npm test` → 3 bộ: compile/import round-trip + apiData + select-children, sanitize, conditional.

---

## 4. Tích hợp engine vào trang FE

Cách nhúng bundle + khởi tạo `{ schema, uiSchema }` + submit đã có ở [Cách sử dụng nhanh](#cách-sử-dụng-nhanh). Dưới đây là chi tiết cho các trường hợp cụ thể.

### 4.1 Nhúng bundle vào trang

```html
<script src="dist/custom-dynamic-form.js"></script>
<custom-dynamic-form id="my-dynamic-form"></custom-dynamic-form>

<script>
  const formEl = document.getElementById('my-dynamic-form');
  Promise.all([fetch('./data/schema.json'), fetch('./data/uiSchema.json')])
    .then(async ([s, u]) => { formEl.schema = await s.json(); formEl.uiSchema = await u.json(); });
</script>
```

Điều kiện tiên quyết: trang phải phục vụ qua **HTTP** (không mở `file://`).

### 4.2 Gán schema/uiSchema trực tiếp bằng JS

```js
formEl.schema = {
  type: 'object',
  properties: {
    relation: {
      type: 'integer', title: 'Đối tượng liên kết', default: 1,
      oneOf: [ { const: 1, title: 'Thành viên' }, { const: 2, title: 'Khách hàng / đối tác' } ],
    },
  },
  required: ['relation'],
  allOf: [ { if: { properties: { relation: { const: 1 } } }, then: { required: ['ma_nhan_vien'] } } ],
};
formEl.uiSchema = {
  idPrefix: 'demo',
  fields: { relation: { 'ui:widget': 'radio' } },
  layout: [{ type: 'row', fields: [{ name: 'relation', grid: 12 }] }],
};
```

Gợi ý widget: `text`, `textarea`, `number`, `email`, `url`, `phone`, `date`, `select`, `custom-select`, `radio`, `checkbox`, `hidden`, `time-slider`.

### 4.3 Xử lý kết quả submit

Khi form **có lỗi** (`handleFormSubmit` trong engine):

- KHÔNG ngăn submit event listener — `onFormSubmit` **vẫn phát**, với `e.detail = { isValid: false, errors: {...} }` để FE chủ động xử lý (log, popup, v.v.):
  ```js
  f.addEventListener('onFormSubmit', (e) => {
    if (e.detail && e.detail.isValid === false) {
      console.error('Form lỗi:', e.detail.errors);  // { field: "msg", ... }
      return;
    }
    // ngược lại: e.detail = dữ liệu form (payload gửi BE)
  });
  ```
- `e.detail.errors` = map `{ fieldName: message }`, lỗi đồng thời được render inline cạnh từng field (i18n).
- Khi `isValid: false` KHÔNG có `data` trong `e.detail`; payload không phải `{ isValid: false, ... }` là dữ liệu thành công.
- Luôn bắt được nhánh lỗi ở FE, nhưng **vẫn phải chặn lại ở backend** ([§6](#6-validator-php-backend) — 422 + `{field, code, message}`) vì form có thể bỏ qua validate client.

Nếu **không muốn dựa vào sự kiện** (nút submit nằm ngoài form của engine), gọi `formEl.submitForm()` — nó validate, hiện lỗi inline như bình thường, **và trả luôn kết quả**:

```js
const r = formEl.submitForm();
if (!r.isValid) return;               // r.errors = { field: "msg" } — đã bôi đỏ field lỗi
fetch('/api/submit', {                // r.data = payload gửi BE (giống e.detail success)
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(r.data),
});
```

- `r.data` giống hệt `e.detail` của `onFormSubmit` success; `r.errors` giống hệt `{ isValid: false, errors }`.
- Event `onFormSubmit` **vẫn phát** song song — code cũ dùng event không ảnh hưởng.
- `submitForm()` trả `null` nếu chưa gán `schema`/`uiSchema`.

### 4.4 Luồng edit lại thông tin (`formEl.data`)

Gắn `data` đúng 1 lần khi mở form sửa bản ghi; giá trị cùng key/kiểu như payload `e.detail` (time = giây, date = `YYYY-MM-DD`, select/radio = `const`). Data override `default`; không gắn = form mới:

```js
formEl.schema = savedSchema;
formEl.uiSchema = savedUiSchema;
formEl.data = {
  relation: 2,                        // field con "ten_don_vi_gioi_thieu" hiện lại theo if/then
  ten_don_vi_gioi_thieu: 'VRB Vũng Tàu',
  dang_ky_nhan_tin: false,            // đè default: true
};
```

Lưu ý: mỗi lần gán `data` là một lần khởi tạo lại form (state không lẫn bản ghi trước) — chỉ gắn khi thật sự cần, sau đó user sửa và submit.

### 4.5 Options nạp từ API (`setLists` và `optionKeys`)

Danh sách select/radio **không nhúng cứng vào schema** mà nạp từ API khi render:

- Trên **Builder** bật toggle **"Dữ liệu từ API"** → không nhập option tĩnh; JSON export có dạng `{ schema, uiSchema, optionKeys }`; field này KHÔNG có `oneOf`/`default` trong schema.
- Nạp list bằng `formEl.setLists()`:

```js
fetch('/api/form-options')
  .then((r) => r.json())
  .then((lists) => formEl.setLists(lists));
// lists: { "don_vi": [ { "value": "ha_noi", "label": "Hà Nội" },
//                      { "value": "hcm",    "label": "TP. Hồ Chí Minh" } ] }
```

Quy tắc:

- Item dạng `{ value, label }` (chuỗi hóa, dedup theo `value`, bỏ item thiếu value). `value` là dữ liệu gửi lên khi submit.
- **Chỉ gọi cho field trong `optionKeys`** — App tự lọc; engine không chặn mạnh.
- List runtime **ưu tiên hơn** `oneOf` tĩnh; trước khi `setLists` được gọi field chưa có option — nên nạp list sớm (trước khi user thấy form). Gọi lại nhiều lần được, form render ngay list mới.
- Radio có **field con** (if/then) vẫn chạy: children khai báo trong schema; API chỉ cung cấp `value`/`label`.

### 4.6 Triển khai select phụ thuộc (Tỉnh và Xã)

Mô hình: **2 field select thường**, đều bật **"Dữ liệu từ API"** — không có widget/plugin riêng. **App tự lo logic** (fetch Xã theo Tỉnh), **engine chỉ** hiển thị + validate `required` như mọi select.

**Bước 1 — Builder:** kéo 2 field select `tinh` (Tỉnh/Thành phố) và `xa` (Xã/Phường); bật "Dữ liệu từ API" cho cả hai; tick "Bắt buộc" theo nhu cầu. Export JSON có `optionKeys: ["tinh", "xa"]`.

**Bước 2 — API** (backend cấp 2 endpoint, trả `[{ value, label }]` chuỗi):

```
GET /api/tinh        → 200 [ { "value": "01", "label": "Hà Nội" }, … ]
GET /api/xa?tinh=01  → 200 [ { "value": "2650", "label": "Xã Yên Sở" }, … ]
```

Nếu DB/API nguồn trả `id`/`name`, map sang `value`/`label` ở lớp fetch (engine tự chuẩn hóa + dedup theo `value`).

**Bước 3 — Tích hợp vào trang:**

```js
const f = document.getElementById('f');

const loadXa = (tinh) =>
  fetch(`/api/xa?tinh=${encodeURIComponent(tinh)}`).then(r => r.json());

function initForm(schema, uiSchema, record) {   // record = bản ghi đang sửa (hoặc null)
  f.schema = schema;
  f.uiSchema = uiSchema;
  f.data = record;                              // prefill xa/tinh cũ khi edit

  fetch('/api/tinh').then(r => r.json()).then(tinhList => {
    f.setLists({ tinh: tinhList });
    // edit: đổ lại Xã của tỉnh đã lưu để select hiện đúng giá trị cũ
    if (record?.tinh) loadXa(record.tinh).then(xaList => f.setLists({ xa: xaList }));
  });

  f.addEventListener('onFieldChange', async ({ detail }) => {
    if (detail.name !== 'tinh') return;
    f.setValue('xa', '');                       // reset Xã cũ của Tỉnh vừa đổi — bắt buộc
    if (!detail.value) { f.setLists({ xa: [] }); return; }
    const xaList = await loadXa(detail.value).catch(() => []);
    f.setLists({ xa: xaList });                 // list rỗng → select hiện "-- Chọn --"
  });
}
```

Quy ước:

- `formEl.setValue('xa', '')` reset đúng 1 field (không remount form, khác `formEl.data`) và xóa lỗi Xã; gọi **trước** `setLists` để tránh submit nhầm Xã cũ của Tỉnh vừa đổi.
- **Luồng edit**: gán `formEl.data` trước, rồi mới `setLists` Xã của tỉnh đã lưu — list chứa value cũ nên không bị reset. Trong lần đổi Tỉnh, list Xã mới không chứa value cũ là bình thường (đã reset bằng `setValue`).
- Engine chỉ validate tồn tại (`required`); kiểm tra "Xã thuộc Tỉnh đã chọn" là **backend** đảm nhận (nghiệp vụ, xử lý ở [§6](#6-validator-php-backend) như mọi luật khác).

### 4.7 Events

Các custom event phát từ `<custom-dynamic-form>` — lắng nghe bằng `addEventListener` (mọi event `detail` là giá trị được phát kèm):

| Event | Description | Event detail | Emitted when |
| --- | --- | --- | --- |
| `onFormSubmit` | Kết quả xử lý submit, thành công hoặc lỗi. | Thành công: `{ field: value, … }` — dữ liệu form đã coerce, là payload gửi BE (không bọc `isValid`).<br>Lỗi: `{ isValid: false, errors: { field: msg } }`. | Mỗi lần submit (nút trong form hoặc `submitForm()`); kể cả khi validate lỗi. Chi tiết: [4.3](#43-xử-lý-kết-quả-submit). |
| `onFieldChange` | Field thay đổi giá trị. | `{ name: string, value: any }` — tên field + giá trị mới, đã coerce đúng kiểu schema. | User sửa field (input, select, radio, checkbox, slider…). Không phát khi gán qua `data`, `setValue()`, hay field ẩn/hiện theo conditional. |

Ví dụ:

```js
f.addEventListener('onFieldChange', ({ detail }) => {
  const { name, value } = detail;
  if (name === 'tinh') console.log('Tỉnh mới:', value);
});
```

Lưu ý:

- Phát cho **mọi field** user thao tác, chưa dedup (chọn lại đúng giá trị cũ vẫn phát) — app tự lọc `detail.name`.
- Không có `prevValue`/`formData`: cần giá trị cũ thì tự giữ map trong app.

---

## 5. Phát triển (engine và builder)

Chỉ cần **một** lệnh `npm run dev` cho việc code hằng ngày (mở `http://localhost:5173/`): builder nạp engine **trực tiếp từ source** (`import.meta.env.DEV`) nên sửa cả builder lẫn engine (`src/CustomDynamicForm.jsx`, `styles.css`, `i18n.js`, `sanitize.js`) là preview reload ngay theo HMR — **không cần build**. Muốn tạo bundle engine liên tục khi save: `npm run build -- --watch`.

Trước khi commit/build: **`npm test` phải PASS** (3 bộ: schema/sanitize/conditional).

Build: `npm run build` (engine trước, builder sau — `dist/index.html` chèn `<script src="custom-dynamic-form.js">` lúc build). Chạy bản production: `npm run prod` (mở `http://localhost:4173/`). Hai bundle trong `dist/` độc lập — copy thẳng lên web server tĩnh (Apache/Nginx/Laragon) là chạy; đừng mở `dist/index.html` bằng `file://` (module bị chặn → trang trắng).

---

## 6. Validator PHP (backend)

### 6.1 Dùng trong endpoint

```bash
composer --working-dir=php install
```

Copy `php/validate_form.php` sang project backend (kèm `vendor/`). Endpoint mẫu đầy đủ ở `php/example_validate.php`:

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

### 6.2 Contract FE-BE

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

Quy ước: `code` là keyword JSON Schema (`required`, `type`, `oneOf`, `format`, …); `field` là tên field nếu xác định được; `message` để log/hiển thị.

### 6.3 Layered validations (bắt buộc)

- FE validate để trải nghiệm (phản hồi nhanh).
- **Backend luôn validate lại** — đây là nguồn sự thật, không tin dữ liệu FE.

---

## 7. Lưu ý khi triển khai production

- `dist/` là build tĩnh → phục vụ trực tiếp nếu chỉ có form (kèm file `{ schema, uiSchema, optionKeys }`).
- Nếu gửi schema qua API, version hóa theo chiến dịch/sự kiện: `schema.v1.json`, `schema.v2.json`, ...
- Phân tách message hiển thị cho người dùng (i18n) và message kỹ thuật cho log.
- Log toàn bộ `errors` từ PHP để theo dõi chất lượng dữ liệu.