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
assert.strictEqual(schema.properties.don_vi.oneOf[0].title, 'Trụ sở', 'select label compiled to oneOf title');
assert.strictEqual(schema.properties.don_vi.oneOf[1].title, 'Chi nhánh');
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

assert.strictEqual(cfgBack.idPrefix, 'dkm');
assert.strictEqual(cfgBack.fields.length, 9);
const hoTen = cfgBack.fields.find(f => f.key === 'ho_ten');
assert.strictEqual(hoTen.description, 'Họ tên đầy đủ như trên giấy tờ.', 'field description re-imported');
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

const empty = SC.compile({ name: '', fields: [] });
assert.deepStrictEqual(empty.schema.properties, {});
assert.deepStrictEqual(empty.uiSchema.layout, [{ type: 'row', fields: [] }]);

console.log('ALL SCHEMA-COMPILE TESTS PASSED');
console.log('sample schema:', JSON.stringify(schema, null, 2));