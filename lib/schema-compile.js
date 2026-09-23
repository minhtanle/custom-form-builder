(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.SchemaCompile = factory();
    }
})(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    var counter = 0;
    function newId() {
        counter += 1;
        return 'f' + Date.now().toString(36) + '_' + counter + '_' + Math.random().toString(36).slice(2, 7);
    }

    function normalizeLabel(s) {
        return String(s || '')
            .toLowerCase()
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/đ/g, 'd')
            .replace(/[^a-z0-9]+/g, '_')
            .replace(/^_+|_+$/g, '');
    }

    function labelToKey(label, used) {
        var s = normalizeLabel(label);
        if (!s) s = 'field';
        if (used && used.indexOf(s) !== -1) {
            var i = 2;
            while (used.indexOf(s + '_' + i) !== -1) i += 1;
            s = s + '_' + i;
        }
        return s;
    }

    // Tìm các key bị trùng (field cấp cao nhất + field con trong option).
    // Trả về mảng key trùng, mỗi key xuất hiện 1 lần.
    function duplicateKeys(config) {
        var seen = {};
        var dup = {};
        function visit(f) {
            if (!f || !f.key) return;
            if (seen[f.key]) dup[f.key] = true;
            else seen[f.key] = true;
        }
        (config && config.fields || []).forEach(function (f) {
            visit(f);
            (f.options || []).forEach(function (o) {
                (o.children || []).forEach(visit);
            });
        });
        return Object.keys(dup);
    }

    function fieldDefaultLabel(type) {
        var map = {
            text: 'Văn bản',
            number: 'Số',
            email: 'Email',
            url: 'URL / Đường dẫn',
            phone: 'Số điện thoại',
            textarea: 'Văn bản dài',
            date: 'Ngày',
            select: 'Dropdown',
            radio: 'Radio',
            checkbox: 'Checkbox',
            hidden: 'Ẩn',
            paragraph: 'Đoạn văn',
            divider: 'Phân cách',
            heading: 'Tiêu đề'
        };
        return map[type] || type;
    }

    function makeField(type, usedKeys) {
        if (type === 'divider' || type === 'paragraph' || type === 'heading') {
            return {
                id: newId(),
                type: type,
                key: '__' + type + '_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 5),
                label: type === 'divider' ? 'Divider' : type === 'heading' ? 'Tiêu đề' : 'Paragraph',
                labelEn: type === 'heading' ? 'Heading' : undefined,
                fontSize: type === 'heading' ? 'large' : undefined,
                required: false,
                grid: 12,
                validate: {},
                options: null,
                defaultValue: undefined
            };
        }
        var f = {
            id: newId(),
            type: type,
            key: labelToKey(fieldDefaultLabel(type), usedKeys),
            label: fieldDefaultLabel(type),
            required: false,
            grid: 12,
            validate: {},
            options: null,
            defaultValue: undefined
        };
        if (type === 'select' || type === 'radio') { f.options = []; f.apiData = false; }
        return f;
    }

    function coerceNumber(v) {
        var n = Number(v);
        return isNaN(n) ? v : n;
    }

    function optionString(o) {
        return String(o == null ? '' : o);
    }

    function coerceOptionValue(v, numeric) {
        return numeric ? coerceNumber(v) : optionString(v);
    }

    function isNumericOptions(options) {
        return Array.isArray(options) && options.length > 0 && options.every(function (o) { return isNumericValue(o.value); });
    }

    // Xây oneOf đúng thứ tự options, loại bỏ value trùng (so sánh chuỗi raw).
    // numeric=true: const ép về number (radio); title ưu tiên o.label rồi mới tới value.
    function optionOneOf(options, numeric) {
        var seen = [];
        var out = [];
        (options || []).forEach(function (o) {
            var v = optionString(o.value);
            if (seen.indexOf(v) !== -1) return;
            seen.push(v);
            out.push({
                const: coerceOptionValue(o.value, numeric),
                title: localeTextObj(o.label != null && o.label !== '' ? o.label : v, o.labelEn)
            });
        });
        return out;
    }

    // Giá trị mặc định chuẩn hoá theo loại option; khớp theo chuỗi raw trên options gốc như cũ.
    function defaultFromOptions(options, defaultValue, numeric) {
        if (defaultValue === undefined || defaultValue === null) return undefined;
        var found;
        (options || []).forEach(function (o) {
            if (found === undefined && String(o.value) === String(defaultValue)) found = o.value;
        });
        if (found === undefined) return undefined;
        return coerceOptionValue(found, numeric);
    }

    // Pattern regex dạng hiển thị có thể kèm dấu bao /.../ + cờ (VD /^[\p{L}\s]+$/u);
    // validator (engine) luôn thêm cờ 'u' nên chỉ giữ phần thân regex, bỏ dấu bao và cờ.
    function normalizePattern(s) {
        if (s == null) return undefined;
        var str = String(s).trim();
        if (str.charAt(0) === '/') {
            var last = str.lastIndexOf('/');
            if (last > 0) str = str.slice(1, last);
        }
        return str || undefined;
    }

    function isNumericValue(v) {
        if (typeof v === 'number') return true;
        var s = String(v == null ? '' : v).trim();
        return s !== '' && /^-?\d+$/.test(s);
    }

    function widgetFor(type) {
        switch (type) {
            case 'select': return 'custom-select';
            case 'radio': return 'radio';
            case 'checkbox': return 'checkbox';
            case 'time': return 'time-slider';
            default: return 'text';
        }
    }

    // Văn bản song ngữ lưu thẳng trong JSON: { vi, en }. En trống → fallback về vi
    // (không cần dictionary riêng; form ít field, không tái sử dụng).
    function localeTextObj(vi, en) {
        return { vi: vi || '', en: (en != null && en !== '') ? en : (vi || '') };
    }

    // Tách {vi,en} (hoặc chuỗi cũ) về cặp vi/en dùng cho import.
    function localeSplit(v) {
        if (v && typeof v === 'object') return { vi: v.vi, en: v.en };
        return { vi: v, en: undefined };
    }

    function propFrom(f) {
        var v = f.validate || {};
        var p = { title: localeTextObj(f.label, f.labelEn) };
        if ((f.description != null && f.description !== '') || (f.descriptionEn != null && f.descriptionEn !== '')) {
            p.description = localeTextObj(f.description, f.descriptionEn);
        }

        if (f.type === 'number') {
            p.type = 'number';
            if (v.min !== undefined && v.min !== '') p.minimum = coerceNumber(v.min);
            if (v.max !== undefined && v.max !== '') p.maximum = coerceNumber(v.max);
            if (f.defaultValue !== undefined && f.defaultValue !== null && f.defaultValue !== '') {
                p.default = coerceNumber(f.defaultValue);
            }
            return p;
        }

        if (f.type === 'email') {
            p.type = 'string';
            p.format = 'email';
            if (v.minLength) p.minLength = coerceNumber(v.minLength);
            if (v.maxLength) p.maxLength = coerceNumber(v.maxLength);
            setStringDefault(p, f);
            return p;
        }

        if (f.type === 'url') {
            p.type = 'string';
            p.format = 'uri';
            setStringDefault(p, f);
            return p;
        }

        if (f.type === 'phone') {
            p.type = 'string';
            p.format = 'phone';
            setStringDefault(p, f);
            return p;
        }

        if (f.type === 'textarea') {
            p.type = 'string';
            if (v.minLength) p.minLength = coerceNumber(v.minLength);
            if (v.maxLength) p.maxLength = coerceNumber(v.maxLength);
            setStringDefault(p, f);
            return p;
        }

        if (f.type === 'date') {
            p.type = 'string';
            p.format = 'date';
            if (v.min !== undefined && v.min !== '') p.formatMinimum = String(v.min);
            if (v.max !== undefined && v.max !== '') p.formatMaximum = String(v.max);
            setStringDefault(p, f);
            return p;
        }

        if (f.type === 'time') {
            p.type = 'number';
            // Builder nhập phút; schema/điện lưu giây để Opis/PHP validate numeric như số nguyên
            if (v.min !== undefined && v.min !== '') p.minimum = Math.round(Number(v.min) * 60);
            if (v.max !== undefined && v.max !== '') p.maximum = Math.round(Number(v.max) * 60);
            if (f.defaultValue !== undefined && f.defaultValue !== null && f.defaultValue !== '') {
                p.default = Math.round(Number(f.defaultValue) * 60);
            }
            return p;
        }

        if (f.type === 'checkbox') {
            p.type = 'boolean';
            if (f.defaultValue === true) p.default = true;
            else if (f.defaultValue === false) p.default = false;
            return p;
        }

        if (f.type === 'select') {
            p.type = 'string';
            // Dữ liệu từ API: không nhúng danh sách option vào schema
            if (f.apiData === true) return p;
            p.oneOf = optionOneOf(f.options, false);
            var dSel = defaultFromOptions(f.options, f.defaultValue, false);
            if (dSel !== undefined) p.default = dSel;
            return p;
        }

        if (f.type === 'radio') {
            // Dữ liệu từ API: không nhúng danh sách option vào schema
            if (f.apiData === true) { p.type = 'string'; return p; }
            var numeric = isNumericOptions(f.options);
            p.type = numeric ? 'integer' : 'string';
            p.oneOf = optionOneOf(f.options, numeric);
            var dRadio = defaultFromOptions(f.options, f.defaultValue, numeric);
            if (dRadio !== undefined) p.default = dRadio;
            return p;
        }

        if (f.type === 'hidden') {
            p.type = 'string';
            setStringDefault(p, f);
            return p;
        }

        p.type = 'string';
        if (v.minLength) p.minLength = coerceNumber(v.minLength);
        if (v.maxLength) p.maxLength = coerceNumber(v.maxLength);
        if (v.pattern) p.pattern = normalizePattern(v.pattern);
        setStringDefault(p, f);
        return p;
    }

    function setStringDefault(p, f) {
        if (f.defaultValue !== undefined && f.defaultValue !== null && f.defaultValue !== '') {
            p.default = String(f.defaultValue);
        }
    }

    function buildLayout(items) {
        var rows = [];
        var cur = [];
        items.forEach(function (item) {
            if (item.type === 'divider' || item.type === 'paragraph' || item.type === 'heading') {
                if (cur.length) { rows.push({ type: 'row', fields: cur }); cur = []; }
                var leText = (item.type === 'paragraph' || item.type === 'heading')
                    ? localeTextObj(item.text || '', item.textEn)
                    : (item.text || '');
                rows.push({ type: 'row', fields: [], layoutElement: { type: item.type, text: leText, fontSize: (item.type === 'heading' && item.fontSize === 'normal') ? 'normal' : undefined } });
                return;
            }
            if ((item.grid || 12) >= 12) {
                if (cur.length) { rows.push({ type: 'row', fields: cur }); cur = []; }
                rows.push({ type: 'row', fields: [item] });
            } else {
                if (cur.length >= 2) { rows.push({ type: 'row', fields: cur }); cur = []; }
                cur.push(item);
            }
        });
        if (cur.length) rows.push({ type: 'row', fields: cur });
        return rows;
    }

    function compile(config) {
        config = config || {};
        var fields = config.fields || [];
        var properties = {};
        var uiFields = {};
        var topRequired = [];
        var allOf = [];
        var layoutItems = [];
        var optionKeys = [];

        fields.forEach(function (f) {
            var key = f.key;
            if (!key) return;
            if (f.type === 'divider' || f.type === 'paragraph' || f.type === 'heading') {
                layoutItems.push({ type: f.type, text: f.label || '', textEn: f.labelEn || '', grid: 12, fontSize: f.type === 'heading' ? (f.fontSize || 'large') : undefined });
                return;
            }
            if (!properties[key]) properties[key] = propFrom(f);

            if (f.type !== 'hidden') {
                uiFields[key] = { 'ui:widget': widgetFor(f.type) };
                layoutItems.push({ name: key, grid: f.grid || 12 });
                if (f.required) topRequired.push(key);
            }

            if (f.apiData === true) {
                if (optionKeys.indexOf(key) === -1) optionKeys.push(key);
                return; // dropdown lấy dữ liệu từ API: không nhúng danh sách option, không field con
            }

            if (f.type === 'radio') {
                var uiOpts = {};
                if (f.labelHidden === true) uiOpts.hideLabel = true;
                if (f.optionsLayout === 'horizontal') uiOpts.optionsLayout = 'horizontal';
                if (Object.keys(uiOpts).length) uiFields[key]['ui:options'] = uiOpts;
            }

            // Dropdown (select) không hỗ trợ field con — chỉ radio có children theo option.
            if (f.type === 'radio') {
                var numeric = isNumericOptions(f.options);

                (f.options || []).forEach(function (opt) {
                    var kids = (opt.children || []).filter(function (c) { return c && c.key; });
                    if (!kids.length) return;
                    var constVal = coerceOptionValue(opt.value, numeric);
                    var rule = {
                        if: { properties: {} },
                        then: { required: kids.map(function (c) { return c.key; }) }
                    };
                    rule.if.properties[key] = { const: constVal };
                    allOf.push(rule);
                    kids.forEach(function (c) {
                        if (!properties[c.key]) properties[c.key] = propFrom(c);
                        uiFields[c.key] = { 'ui:widget': widgetFor(c.type) };
                        if (c.grid && c.grid < 12) uiFields[c.key]['ui:grid'] = c.grid;
                    });
                });
            }
        });

        var schema = { '$schema': 'http://json-schema.org/draft-07/schema#', type: 'object' };
        schema.properties = properties;
        if (topRequired.length) schema.required = topRequired;
        if (allOf.length) schema.allOf = allOf;

        var layout = buildLayout(layoutItems);
        if (!layout.length) layout = [{ type: 'row', fields: [] }];

        return {
            schema: schema,
            uiSchema: {
                idPrefix: config.idPrefix || '',
                fields: uiFields,
                layout: layout
            },
            optionKeys: optionKeys
        };
    }

    function inferType(p, ui) {
        if (ui && ui['ui:widget'] === 'time-slider') return 'time';
        if (ui && (ui['ui:widget'] === 'custom-select' || ui['ui:widget'] === 'select')) return 'select';
        if (ui && ui['ui:widget'] === 'radio') return 'radio';
        if (p.oneOf) return 'radio';
        if (p.enum) return 'select';
        if (p.type === 'boolean') return 'checkbox';
        if (p.type === 'integer' || p.type === 'number') return 'number';
        if (p.type === 'string') {
            if (p.format === 'email') return 'email';
            if (p.format === 'uri' || p.format === 'url') return 'url';
            if (p.format === 'phone' || p.format === 'tel') return 'phone';
            if (p.format === 'date' || p.format === 'date-time') return 'date';
            return 'text';
        }
        return 'text';
    }

    function optFromProp(o) {
        var t = o.title;
        var label = (t != null && t !== '') ? String(t) : String(o.const == null ? '' : o.const);
        var labelEn;
        if (t && typeof t === 'object') {
            labelEn = t.en;
            label = (t.vi != null && t.vi !== '') ? String(t.vi) : String(o.const == null ? '' : o.const);
        }
        var res = { value: String(o.const), label: label, children: [] };
        if (labelEn !== undefined) res.labelEn = labelEn;
        return res;
    }

    function fieldFromProp(key, p, type, required, grid, ui) {
        var t = p.title;
        var label = (t && typeof t === 'object') ? (t.vi != null && t.vi !== '' ? t.vi : key) : (t || key);
        var labelEn = (t && typeof t === 'object') ? t.en : undefined;
        var f = {
            id: newId(),
            type: type,
            key: key,
            label: label,
            required: !!required,
            grid: grid || 12,
            validate: {},
            options: null,
            defaultValue: undefined
        };
        if (labelEn !== undefined) f.labelEn = labelEn;
        if (p.default !== undefined) f.defaultValue = p.default;
        if (p.description !== undefined) {
            var descSplit = localeSplit(p.description);
            f.description = descSplit.vi != null ? descSplit.vi : '';
            if (descSplit.en !== undefined && descSplit.en !== '') f.descriptionEn = descSplit.en;
        }
        if (type === 'number') {
            if (p.minimum !== undefined) f.validate.min = p.minimum;
            if (p.maximum !== undefined) f.validate.max = p.maximum;
        } else if (type === 'time') {
            // Schema lưu giây; builder dùng phút
            if (p.minimum !== undefined) f.validate.min = Math.round(Number(p.minimum) / 60);
            if (p.maximum !== undefined) f.validate.max = Math.round(Number(p.maximum) / 60);
            if (f.defaultValue !== undefined && f.defaultValue !== null && f.defaultValue !== '') {
                f.defaultValue = Math.round(Number(f.defaultValue) / 60);
            }
        } else if (type === 'text') {
            if (p.minLength !== undefined) f.validate.minLength = p.minLength;
            if (p.maxLength !== undefined) f.validate.maxLength = p.maxLength;
            if (p.pattern !== undefined) f.validate.pattern = normalizePattern(p.pattern);
        } else if (type === 'textarea') {
            if (p.minLength !== undefined) f.validate.minLength = p.minLength;
            if (p.maxLength !== undefined) f.validate.maxLength = p.maxLength;
        } else if (type === 'date') {
            if (p.formatMinimum !== undefined) f.validate.min = String(p.formatMinimum);
            if (p.formatMaximum !== undefined) f.validate.max = String(p.formatMaximum);
        }
        if (type === 'select') {
            var selOpts = (p.oneOf || []).map(optFromProp);
            if (!selOpts.length) {
                var en = p.enum || [];
                selOpts = en.map(function (v) { return { value: String(v), label: String(v), children: [] }; });
            }
            f.options = selOpts;
        } else if (type === 'radio') {
            f.options = (p.oneOf || []).map(optFromProp);
            var uo = (ui && ui['ui:options']) || {};
            if (uo.hideLabel === true) f.labelHidden = true;
            if (uo.optionsLayout === 'horizontal') f.optionsLayout = 'horizontal';
        }
        return f;
    }

    function importConfig(doc) {
        doc = doc || {};
        var schema = doc.schema || doc;
        var uiSchema = doc.uiSchema || {};
        var optionKeys = Array.isArray(doc.optionKeys) ? doc.optionKeys : [];
        var props = schema.properties || {};
        var req = schema.required || [];
        var allOf = schema.allOf || [];

        var rules = [];
        allOf.forEach(function (rule) {
            var ifp = rule && rule.if && rule.if.properties;
            if (!ifp) return;
            var parent = Object.keys(ifp)[0];
            if (!parent || parent == null) return;
            var cv = ifp[parent].const;
            var kids = (rule.then && rule.then.required) || [];
            rules.push({ parent: parent, constVal: cv, children: kids });
        });

        var childKeys = {};
        rules.forEach(function (r) {
            r.children.forEach(function (k) {
                if (props[k]) childKeys[k] = true;
            });
        });

        var gridMap = {};
        var orderEntries = [];
        (uiSchema.layout || []).forEach(function (row) {
            if (row.layoutElement && row.layoutElement.type) {
                var le = row.layoutElement;
                var leLabel = le.text;
                var leLabelEn;
                if (leLabel && typeof leLabel === 'object') {
                    leLabelEn = leLabel.en;
                    leLabel = leLabel.vi;
                }
                var leType = le.type;
                var leF = {
                    id: newId(),
                    type: leType,
                    key: '__' + leType + '_' + Math.random().toString(36).slice(2, 7),
                    label: (leLabel != null && leLabel !== '') ? leLabel : (leType === 'divider' ? 'Divider' : leType === 'heading' ? 'Heading' : 'Paragraph'),
                    required: false,
                    grid: 12,
                    validate: {},
                    options: null,
                    defaultValue: undefined
                };
                if (leLabelEn !== undefined) leF.labelEn = leLabelEn;
                if (leType === 'heading') leF.fontSize = le.fontSize === 'normal' ? 'normal' : 'large';
                orderEntries.push({ layout: true, field: leF });
                return;
            }
            (row.fields || []).forEach(function (f) {
                var name = f && f.name;
                if (name === undefined || name === null) return;
                gridMap[name] = f.grid || 12;
                if (!orderEntries.some(function (e) { return !e.layout && e.name === name; })) {
                    orderEntries.push({ layout: false, name: name });
                }
            });
        });

        var hiddenSet = {};
        Object.keys(props).forEach(function (name) {
            if (orderEntries.some(function (e) { return !e.layout && e.name === name; })) return;
            if (childKeys[name]) return;
            hiddenSet[name] = true;
            orderEntries.push({ layout: false, name: name });
        });

        var fields = [];
        var seen = {};
        orderEntries.forEach(function (entry) {
            if (entry.layout) {
                fields.push(entry.field);
                return;
            }
            var name = entry.name;
            if (childKeys[name] || seen[name]) return;
            var p = props[name];
            if (!p) return;
            seen[name] = true;
            var type = hiddenSet[name] ? 'hidden' : inferType(p, (uiSchema.fields || {})[name]);
            var f = fieldFromProp(name, p, type, req.indexOf(name) !== -1, gridMap[name] || 12, (uiSchema.fields || {})[name]);
            if (optionKeys.indexOf(name) !== -1) {
                f.apiData = true;
                f.options = null; // dropdown lấy dữ liệu từ API: không có danh sách tĩnh
            }
            rules.forEach(function (r) {
                if (r.parent !== name) return;
                if (f.type !== 'radio') return; // dropdown không hỗ trợ field con
                var opt = (f.options || []).filter(function (o) { return String(o.value) === String(r.constVal); })[0];
                if (!opt) return;
                r.children.forEach(function (ck) {
                    if (!props[ck] || seen[ck]) return;
                    seen[ck] = true;
                    var cp = props[ck];
                    var ctype = inferType(cp, (uiSchema.fields || {})[ck]);
                    var cui = (uiSchema.fields || {})[ck] || {};
                    var cg = cui['ui:grid'] || gridMap[ck] || 12;
                    opt.children.push(fieldFromProp(ck, cp, ctype, true, cg, cui));
                });
            });
            fields.push(f);
        });

        return { name: schema.title || schema.name || '', idPrefix: uiSchema.idPrefix || '', fields: fields };
    }

    function childFieldTypes() {
        return ['text', 'number', 'email', 'url', 'phone', 'textarea', 'date', 'time', 'select', 'checkbox'];
    }

    function allTypes() {
        return ['text', 'number', 'email', 'url', 'phone', 'textarea', 'date', 'time', 'select', 'radio', 'checkbox', 'hidden', 'paragraph', 'divider', 'heading'];
    }

    return {
        newId: newId,
        labelToKey: labelToKey,
        duplicateKeys: duplicateKeys,
        fieldDefaultLabel: fieldDefaultLabel,
        makeField: makeField,
        allTypes: allTypes,
        normalizePattern: normalizePattern,
        childFieldTypes: childFieldTypes,
        compile: compile,
        importConfig: importConfig
    };
});