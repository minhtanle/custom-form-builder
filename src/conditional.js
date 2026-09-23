// Logic if/then dùng chung cho engine: mọi nơi muốn biết "rule nào đang kích hoạt" / "field
// nào thuộc nhánh conditional" đều đọc từ đây — không viết tay duyệt schema.allOf ở nhiều chỗ.
//
// Ngữ nghĩa match được giữ NGUYÊN như engine vẫn dùng (single-key + so khớp const):
// - triggerField = key đầu tiên của if.properties
// - constValue = if.properties[triggerField].const
// - match = formData[triggerField] === constValue (strict)
// Cờ hasIf tách bạch rule "có điều kiện" (mới match) với rule chỉ khai `then.required` (chỉ dùng để ẩn field).

export function listConditionalRules(schema) {
    const out = [];
    ((schema && schema.allOf) || []).forEach(rule => {
        if (!rule || !rule.then || !Array.isArray(rule.then.required)) return;
        const entry = {
            hasIf: false,
            triggerField: undefined,
            constValue: undefined,
            requiredFields: rule.then.required
        };
        if (rule.if && rule.if.properties) {
            const triggerField = Object.keys(rule.if.properties)[0];
            const propCond = triggerField && rule.if.properties[triggerField];
            if (propCond) {
                entry.hasIf = true;
                entry.triggerField = triggerField;
                entry.constValue = propCond.const;
            }
        }
        out.push(entry);
    });
    return out;
}

// Toàn bộ field nằm trong nhánh "then": ẩn trước, rồi mới hiện lại theo resolveConditionalRules.
export function allConditionalFields(schema) {
    const fields = new Set();
    listConditionalRules(schema).forEach(rule => {
        rule.requiredFields.forEach(f => fields.add(f));
    });
    return fields;
}

// Các rule đang được kích hoạt bởi formData hiện tại.
export function resolveConditionalRules(schema, formData) {
    const fd = formData || {};
    return listConditionalRules(schema).filter(rule => rule.hasIf && fd[rule.triggerField] === rule.constValue);
}