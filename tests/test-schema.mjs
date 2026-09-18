import assert from 'node:assert';
import SC from '../lib/schema-compile.js';

function noIds(cfg) {
    return JSON.parse(JSON.stringify(cfg));
}

let next = 0;
function mk(type, key, label, extra) {
    const f = {
        id: 'id' + (next++),
        type,
        key,
        label: label || key,
        required: false,
        grid: 12,
        validate: {},
        options: null,
        defaultValue: undefined,
        ...(extra || {})
    };
    if ((type === 'select' || type === 'radio') && !(extra && extra.options)) f.options = [];
    return f;
}

const config = {
    name: 'Đăng ký tham gia',
    description: 'Form mẫu cho builder',
    idPrefix: 'dkm',
    fields: [
        mk('radio', 'relation', 'Đối tượng liên kết', {
            required: true,
            grid: 12,
            defaultValue: '1',
            options: [
{ value: '1', label: 'Thành viên', children: [mk('text', 'ma_nhan_vien', 'Mã nhân viên', { required: true })] },
                    { value: '2', label: 'Khách hàng', children: [] },
                    { value: '3', label: 'Khác', children: [] }
            ]
        }),
        mk('select', 'don_vi', 'Đơn vị giới thiệu', {
            required: true,
            options: [
                { value: 'trụ sở', label: 'Trụ sở', children: [mk('text', 'phong_ban', 'Phòng ban'), mk('number', 'so_nv', 'Số nhân viên', { required: true })] },
                { value: 'cn', label: 'Chi nhánh', children: [] }
            ]
        }),
        mk('text', 'ho_ten', 'Họ tên', { required: true, grid: 6, validate: { minLength: 2, maxLength: 50 }, description: 'Họ tên đầy đủ như trên giấy tờ.' }),
        mk('number', 'nam_sinh', 'Năm sinh', { grid: 6, validate: { min: 1900, max: 2026 } }),
        mk('email', 'email', 'Email', { required: true }),
        mk('textarea', 'ghi_chu', 'Ghi chú', {}),
        mk('date', 'ngay_dk', 'Ngày đăng ký', {}),
        mk('checkbox', 'dong_y', 'Đồng ý', { grid: 6, defaultValue: true }),
        mk('hidden', 'token', 'Token', { defaultValue: 'abc123' })
    ]
};

const { schema, uiSchema } = SC.compile(config);

assert.strictEqual(schema.type, 'object');
assert.strictEqual(schema.description, 'Form mẫu cho builder');

assert.strictEqual(schema.properties.relation.oneOf.length, 3);
assert.strictEqual(schema.properties.relation.default, 1, 'radio defaults coerced to number when numeric');
assert.ok(schema.properties.relation.oneOf.every(o => typeof o.const === 'number'), 'numeric radio -> integer consts');

assert.deepStrictEqual(schema.allOf.filter(r => r.if.properties.relation).map(r => r.if.properties.relation.const), [1]);
assert.deepStrictEqual(schema.allOf.filter(r => r.if.properties.relation)[0].then.required, ['ma_nhan_vien']);

assert.deepStrictEqual(schema.allOf.filter(r => r.if.properties.don_vi && r.if.properties.don_vi.const === 'trụ sở')[0].then.required, ['phong_ban', 'so_nv']);
assert.strictEqual(schema.allOf.length, 2, 'only option-with-children produces allOf rule');

assert.ok(Array.isArray(schema.required));
assert.deepStrictEqual([...schema.required].sort(), ['relation', 'don_vi', 'ho_ten', 'email'].sort(), 'children not in top-level required');
assert.ok(!schema.required.includes('phong_ban'), 'child not in required');
assert.ok(!schema.required.includes('ma_nhan_vien'), 'radio child not required');

assert.deepStrictEqual(schema.properties.don_vi.oneOf.map(o => o.const), ['trụ sở', 'cn'], 'select options compiled to oneOf consts');
assert.deepStrictEqual(schema.properties.don_vi.oneOf[0].title, { vi: 'Trụ sở', en: 'Trụ sở' }, 'select label compiles to {vi,en}');
assert.deepStrictEqual(schema.properties.don_vi.oneOf[1].title, { vi: 'Chi nhánh', en: 'Chi nhánh' });
assert.ok(!('enum' in schema.properties.don_vi), 'select no longer emits enum');
assert.strictEqual(schema.properties.ho_ten.minLength, 2);
assert.strictEqual(schema.properties.ho_ten.maxLength, 50);
assert.strictEqual(schema.properties.ho_ten.description, 'Họ tên đầy đủ như trên giấy tờ.', 'field description compiled');
assert.strictEqual(schema.properties.nam_sinh.minimum, 1900);
assert.strictEqual(schema.properties.nam_sinh.maximum, 2026);
assert.strictEqual(schema.properties.email.format, 'email');
assert.strictEqual(schema.properties.ngay_dk.format, 'date');
assert.strictEqual(schema.properties.dong_y.default, true);
assert.strictEqual(schema.properties.token.default, 'abc123');

assert.ok(!('token' in uiSchema.fields), 'hidden omitted from uiSchema.fields');
assert.ok(uiSchema.layout.every(r => r.fields.every(f => f.name !== 'token')), 'hidden omitted from layout');

const layoutNames = uiSchema.layout.flatMap(r => r.fields.map(f => f.name));
assert.deepStrictEqual(layoutNames, ['relation', 'don_vi', 'phong_ban', 'so_nv', 'ho_ten', 'nam_sinh', 'email', 'ghi_chu', 'ngay_dk', 'dong_y'], 'select children follow parent in layout, radio children not in layout');
const rowWithTwo = uiSchema.layout.find(r => r.fields.length === 2);
assert.deepStrictEqual(rowWithTwo.fields.map(f => f.name).sort(), ['ho_ten', 'nam_sinh']);
assert.strictEqual(uiSchema.idPrefix, 'dkm');

assert.strictEqual(uiSchema.fields.don_vi['ui:widget'], 'custom-select');
assert.strictEqual(uiSchema.fields.relation['ui:widget'], 'radio');
assert.strictEqual(uiSchema.fields.dong_y['ui:widget'], 'checkbox');
assert.strictEqual(uiSchema.fields.ho_ten['ui:widget'], 'text');

const round1 = { schema, uiSchema };
const cfgBack = SC.importConfig({ schema, uiSchema });
const round2 = SC.compile(cfgBack);
assert.deepStrictEqual(round2, round1, 'compile -> import -> compile is stable');

// Song ngữ: title field compile thành {vi,en}; import đọc lại label + labelEn
assert.deepStrictEqual(schema.properties.ho_ten.title, { vi: 'Họ tên', en: 'Họ tên' }, 'field title compiles to {vi,en} (en fallback = vi)');
assert.deepStrictEqual(schema.properties.ho_ten.description, 'Họ tên đầy đủ như trên giấy tờ.', 'description stays single-language string');
assert.deepStrictEqual(schema.properties.relation.oneOf.map(o => o.title), [{ vi: 'Thành viên', en: 'Thành viên' }, { vi: 'Khách hàng', en: 'Khách hàng' }, { vi: 'Khác', en: 'Khác' }], 'radio option titles are {vi,en}');

// Option labelEn round-trips
const lcOpt = SC.compile({ fields: [mk('radio', 'loai', 'Loại', { options: [{ value: 'a', label: 'Loại A', labelEn: 'Type A' }] })] });
assert.deepStrictEqual(lcOpt.schema.properties.loai.oneOf[0].title, { vi: 'Loại A', en: 'Type A' }, 'option labelEn compiled into title.en');
const optBack = SC.importConfig(lcOpt).fields.find(f => f.key === 'loai');
assert.strictEqual(optBack.options[0].labelEn, 'Type A', 'import restores option labelEn');
assert.deepStrictEqual(SC.compile(SC.importConfig(lcOpt)).schema, lcOpt.schema, 'option labelEn round-trips');

// oneOf title string cũ (legacy) import được; compile mới phát {vi,en}
const legacyOpt = SC.importConfig({
    schema: { type: 'object', properties: { s: { type: 'string', oneOf: [{ const: 'x', title: 'Legacy' }] } } },
    uiSchema: {
        fields: { s: { 'ui:widget': 'custom-select' } },
        layout: [{ type: 'row', fields: [{ name: 's', grid: 12 }] }]
    }
});
const legacyOptField = legacyOpt.fields.find(f => f.key === 's');
assert.strictEqual(legacyOptField.options[0].label, 'Legacy', 'string option title imports as label');
assert.strictEqual(legacyOptField.options[0].labelEn, undefined, 'string option title has no labelEn');
assert.deepStrictEqual(SC.compile(legacyOpt).schema.properties.s.oneOf[0].title, { vi: 'Legacy', en: 'Legacy' }, 'legacy string option title recompiles to {vi,en}');

const lc = SC.compile({ fields: [mk('text', 'terms', 'Điều khoản', { labelEn: 'Terms' })] });
assert.deepStrictEqual(lc.schema.properties.terms.title, { vi: 'Điều khoản', en: 'Terms' }, 'labelEn compiled into title.en');
const termsBack = SC.importConfig(lc).fields.find(f => f.key === 'terms');
assert.strictEqual(termsBack.labelEn, 'Terms', 'import restores labelEn');
assert.deepStrictEqual(SC.compile(SC.importConfig(lc)).schema.properties.terms.title, { vi: 'Điều khoản', en: 'Terms' }, 'labelEn round-trips');

// Song ngữ cho paragraph + heading: layoutElement.text thành {vi,en}
const lp = SC.compile({ fields: [mk('paragraph', '__p1', 'Đoạn A', { labelEn: 'Paragraph A' }), mk('heading', '__h1', 'Tiêu đề', { labelEn: 'Heading' })] });
const lpTexts = lp.uiSchema.layout.map(r => (r.layoutElement && r.layoutElement.text) || {}).filter(t => Object.keys(t).length);
assert.deepStrictEqual(lpTexts[0], { vi: 'Đoạn A', en: 'Paragraph A' }, 'paragraph text {vi,en}');
assert.deepStrictEqual(lpTexts[1], { vi: 'Tiêu đề', en: 'Heading' }, 'heading text {vi,en}');
assert.deepStrictEqual(SC.compile(SC.importConfig(lp)).schema, lp.schema, 'layout element round-trips');
assert.deepStrictEqual(SC.compile(SC.importConfig(lp)).uiSchema.layout, lp.uiSchema.layout, 'layout element uiSchema round-trips');

assert.strictEqual(cfgBack.idPrefix, 'dkm');
assert.strictEqual(cfgBack.fields.length, 9);
const hoTen = cfgBack.fields.find(f => f.key === 'ho_ten');
assert.strictEqual(hoTen.description, 'Họ tên đầy đủ như trên giấy tờ.', 'field description re-imported');
assert.strictEqual(hoTen.labelEn, 'Họ tên', 'import re-adds labelEn (fallback vi)');
const rel = cfgBack.fields.find(f => f.key === 'relation');
assert.strictEqual(rel.options[0].label, 'Thành viên');
assert.strictEqual(rel.options[0].children.length, 1);
assert.strictEqual(rel.options[0].children[0].key, 'ma_nhan_vien');
assert.strictEqual(rel.required, true);
const donVi = cfgBack.fields.find(f => f.key === 'don_vi');
assert.strictEqual(donVi.options[0].children.length, 2);
assert.strictEqual(donVi.options[0].label, 'Trụ sở', 'select label re-imported from oneOf title');
assert.strictEqual(donVi.options[1].label, 'Chi nhánh');

// Back-compat: schema cũ dạng enum vẫn import được; compile mới chuyển sang oneOf
const legacy = SC.importConfig({
    schema: { type: 'object', properties: { old_sel: { type: 'string', title: 'Cũ', enum: ['a', 'b'] } } },
    uiSchema: {
        fields: { old_sel: { 'ui:widget': 'custom-select' } },
        layout: [{ type: 'row', fields: [{ name: 'old_sel', grid: 12 }] }]
    }
});
const oldSel = legacy.fields.find(f => f.key === 'old_sel');
assert.strictEqual(oldSel.type, 'select', 'legacy enum imports as select');
assert.deepStrictEqual(oldSel.options.map(o => o.label), ['a', 'b'], 'legacy enum labels fall back to values');
assert.ok(SC.compile(legacy).schema.properties.old_sel.oneOf, 'legacy enum migrated to oneOf on compile');
const token = cfgBack.fields.find(f => f.key === 'token');
assert.strictEqual(token.type, 'hidden', 'hidden field re-imported as hidden');

const radioChildOnly = mk('radio', 'loai', 'Loại', {
    options: [
        { value: 'x', label: 'X', children: [mk('email', 'email_x', 'Email X')] }
    ]
});
const simple = SC.compile({ name: '', fields: [radioChildOnly] });
assert.ok(simple.uiSchema.layout.every(r => r.fields.every(f => f.name !== 'email_x')), 'radio children skipped in layout');

// Radio child grid: emit ui:grid, round-trip preserves grid
const radioChildGrid = mk('radio', 'loai2', 'Loại 2', {
    options: [
        { value: 'a', label: 'A', children: [mk('text', 'inp_a', 'Input A', { grid: 6 }), mk('select', 'sel_a', 'Select A', { grid: 6 })] }
    ]
});
const gridCfg = SC.compile({ name: '', fields: [radioChildGrid] });
assert.strictEqual(gridCfg.uiSchema.fields.inp_a['ui:grid'], 6, 'compile emits ui:grid for radio child');
assert.strictEqual(gridCfg.uiSchema.fields.sel_a['ui:grid'], 6, 'compile emits ui:grid for select child');
const gridBack = SC.importConfig({ schema: gridCfg.schema, uiSchema: gridCfg.uiSchema });
var parentField = gridBack.fields.find(f => f.key === 'loai2');
var childInp = parentField.options[0].children.find(c => c.key === 'inp_a');
var childSel = parentField.options[0].children.find(c => c.key === 'sel_a');
assert.strictEqual(childInp.grid, 6, 'import preserves radio child grid 6');
assert.strictEqual(childSel.grid, 6, 'import preserves select child grid 6');
const gridRound = SC.compile(gridBack);
assert.deepStrictEqual(gridRound, gridCfg, 'child grid round-trip is stable');

const empty = SC.compile({ name: '', fields: [] });
assert.deepStrictEqual(empty.schema.properties, {});
assert.deepStrictEqual(empty.uiSchema.layout, [{ type: 'row', fields: [] }]);

// --- Layout-only elements: paragraph + divider ---
const p = mk('paragraph', '__paragraph_1', 'Ghi chú quan trọng');
const d = mk('divider', '__divider_1', 'Divider');
const named = mk('text', 'ten', 'Tên người');
const mixedCfg = { name: 'Mix', fields: [named, p, d] };
const mixed = SC.compile(mixedCfg);

assert.ok(!('__paragraph_1' in mixed.schema.properties), 'paragraph not in schema.properties');
assert.ok(!('__divider_1' in mixed.schema.properties), 'divider not in schema.properties');
assert.ok(mixed.uiSchema.layout.some(r => r.layoutElement && r.layoutElement.type === 'paragraph'), 'layout contains paragraph element');
assert.ok(mixed.uiSchema.layout.some(r => r.layoutElement && r.layoutElement.type === 'divider'), 'layout contains divider element');
const pRow = mixed.uiSchema.layout.find(r => r.layoutElement && r.layoutElement.type === 'paragraph');
assert.strictEqual(pRow.layoutElement.text.vi, 'Ghi chú quan trọng', 'paragraph text preserved (vi)');
assert.strictEqual(pRow.layoutElement.text.en, 'Ghi chú quan trọng', 'paragraph text en falls back to vi');
assert.deepStrictEqual(pRow.fields, [], 'layout-only row has empty fields');
assert.ok(mixed.schema.properties.ten, 'data field alongside layouts still compiles');

const mixedBack = SC.importConfig({ schema: mixed.schema, uiSchema: mixed.uiSchema });
assert.strictEqual(mixedBack.fields.length, 3, 'import restores layout-only fields');
assert.strictEqual(mixedBack.fields[0].key, 'ten', 'data field order preserved');
assert.strictEqual(mixedBack.fields[1].type, 'paragraph', 'paragraph restored in order');
assert.strictEqual(mixedBack.fields[1].label, 'Ghi chú quan trọng', 'paragraph text restored');
assert.strictEqual(mixedBack.fields[2].type, 'divider', 'divider restored in order');
const mixedRound = SC.compile(mixedBack);
assert.deepStrictEqual(mixedRound, mixed, 'layout-only round-trip is stable');

console.log('ALL SCHEMA-COMPILE TESTS PASSED');
console.log('sample schema:', JSON.stringify(schema, null, 2));