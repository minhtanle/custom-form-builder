import assert from 'assert';
import { listConditionalRules, allConditionalFields, resolveConditionalRules } from '../src/conditional.js';

let pass = 0;
function t(name, fn) {
    fn();
    pass++;
    console.log('  ok -', name);
}

// requiredFields của từng rule đã resolve (dạng mảng)
const reqsOf = rules => rules.map(r => r.requiredFields.slice());

console.log('listConditionalRules / resolveConditionalRules:');

t('string const: match khi formData đúng, ko match khi khác', () => {
    const schema = {
        type: 'object',
        properties: { loai: {}, inp_a: {} },
        allOf: [{ if: { properties: { loai: { const: 'a' } } }, then: { required: ['inp_a'] } }]
    };
    assert.deepStrictEqual(reqsOf(resolveConditionalRules(schema, { loai: 'a' })), [['inp_a']]);
    assert.deepStrictEqual(resolveConditionalRules(schema, { loai: 'b' }), []);
    assert.deepStrictEqual(resolveConditionalRules(schema, {}), []);
});

t('const số (radio số): match strict với number', () => {
    const schema = {
        allOf: [{ if: { properties: { relation: { const: 1 } } }, then: { required: ['ma_nhan_vien'] } }]
    };
    assert.deepStrictEqual(reqsOf(resolveConditionalRules(schema, { relation: 1 })), [['ma_nhan_vien']]);
});

t('strict ===: chuỗi "1" KHÔNG match const 1', () => {
    const schema = {
        allOf: [{ if: { properties: { relation: { const: 1 } } }, then: { required: ['ma_nhan_vien'] } }]
    };
    assert.deepStrictEqual(resolveConditionalRules(schema, { relation: '1' }), []);
});

t('rule không có if (chỉ then.required): chỉ ẩn field, không bao giờ resolve', () => {
    const schema = { allOf: [{ then: { required: ['x'] } }] };
    assert.ok(allConditionalFields(schema).has('x'), 'x nằm trong nhánh conditional (bị ẩn trước)');
    assert.deepStrictEqual(resolveConditionalRules(schema, {}), []);
    const r = listConditionalRules(schema)[0];
    assert.strictEqual(r.hasIf, false);
});

t('if tồn tại nhưng không có properties → không match', () => {
    const schema = { allOf: [{ if: { required: ['x'] }, then: { required: ['x'] } }] };
    assert.deepStrictEqual(resolveConditionalRules(schema, {}), []);
    assert.strictEqual(listConditionalRules(schema)[0].hasIf, false);
});

t('if.properties rỗng {} → coi như không có điều kiện, không crash, field bị ẩn', () => {
    const schema = { allOf: [{ if: { properties: {} }, then: { required: ['y'] } }] };
    const r = listConditionalRules(schema)[0];
    assert.strictEqual(r.hasIf, false);
    assert.ok(allConditionalFields(schema).has('y'), 'y vẫn thuộc nhánh conditional (bị ẩn)');
    assert.deepStrictEqual(resolveConditionalRules(schema, {}), []);
});

t('if.properties có key nhưng không có const → constValue undefined, match khi field chưa set (ngữ nghĩa sống)', () => {
    const schema = { allOf: [{ if: { properties: { loai: {} } }, then: { required: ['x'] } }] };
    const r = listConditionalRules(schema)[0];
    assert.strictEqual(r.hasIf, true);
    assert.strictEqual(r.triggerField, 'loai');
    assert.strictEqual(r.constValue, undefined);
    assert.deepStrictEqual(reqsOf(resolveConditionalRules(schema, {})), [['x']], 'field chưa set → match');
    assert.deepStrictEqual(resolveConditionalRules(schema, { loai: 'a' }), [], 'field có giá trị → không match');
});

t('resolveConditionalRules với formData undefined → coi như {}', () => {
    const schema = { allOf: [{ if: { properties: { loai: { const: 'a' } } }, then: { required: ['x'] } }] };
    assert.deepStrictEqual(resolveConditionalRules(schema, undefined), []);
});

t('allConditionalFields: union nhiều rule + dedupe qua Set', () => {
    const schema = {
        allOf: [
            { if: { properties: { a: { const: 1 } } }, then: { required: ['x', 'y'] } },
            { if: { properties: { b: { const: 2 } } }, then: { required: ['y', 'z'] } }
        ]
    };
    const s = allConditionalFields(schema);
    assert.deepStrictEqual(Array.from(s).sort(), ['x', 'y', 'z']);
});

t('nhiều rule cùng trigger, const khác nhau → chỉ rule đúng match', () => {
    const schema = {
        allOf: [
            { if: { properties: { loai: { const: 'a' } } }, then: { required: ['inp_a'] } },
            { if: { properties: { loai: { const: 'b' } } }, then: { required: ['inp_b'] } }
        ]
    };
    assert.deepStrictEqual(reqsOf(resolveConditionalRules(schema, { loai: 'b' })), [['inp_b']]);
    assert.deepStrictEqual(reqsOf(resolveConditionalRules(schema, { loai: 'a' })), [['inp_a']]);
});

t('radio children: lọc theo triggerField + constValue gắn đúng children từng option', () => {
    const schema = {
        allOf: [
            { if: { properties: { loai: { const: 'a' } } }, then: { required: ['inp_a'] } },
            { if: { properties: { loai: { const: 'b' } } }, then: { required: ['inp_b'] } }
        ]
    };
    const childrenOf = (fieldName, optValue) =>
        listConditionalRules(schema)
            .filter(r => r.hasIf && r.triggerField === fieldName && r.constValue === optValue)
            .flatMap(r => r.requiredFields);
    assert.deepStrictEqual(childrenOf('loai', 'a'), ['inp_a']);
    assert.deepStrictEqual(childrenOf('loai', 'b'), ['inp_b']);
    assert.deepStrictEqual(childrenOf('loai', 'c'), []);
    assert.deepStrictEqual(childrenOf('khac', 'a'), [], 'field khác không ảnh hưởng radio này');
});

t('then.required thiếu / không phải mảng → rule bị bỏ qua (không crash)', () => {
    assert.deepStrictEqual(listConditionalRules({ allOf: [{ if: { properties: { a: { const: 1 } } }, then: {} }] }), []);
    assert.deepStrictEqual(listConditionalRules({ allOf: [{ if: { properties: { a: { const: 1 } } }, then: { required: 'x' } }] }), []);
});

t('schema null/undefined/không allOf → trả rỗng an toàn', () => {
    assert.deepStrictEqual(listConditionalRules(null), []);
    assert.deepStrictEqual(listConditionalRules(undefined), []);
    assert.deepStrictEqual(listConditionalRules({}), []);
    assert.strictEqual(allConditionalFields(null).size, 0);
    assert.strictEqual(allConditionalFields(undefined).size, 0);
    assert.deepStrictEqual(resolveConditionalRules({}, {}), []);
});

console.log('ALL CONDITIONAL TESTS PASSED (' + pass + ')');