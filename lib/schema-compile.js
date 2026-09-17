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
            divider: 'Phân cách'
        };
        return map[type] || type;
    }

    function makeField(type, usedKeys) {
        if (type === 'divider' || type === 'paragraph') {
            return {
                id: newId(),
                type: type,
                key: '__' + type + '_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 5),
                label: type === 'divider' ? 'Divider' : 'Paragraph',
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
        if (type === 'select' || type === 'radio') f.options = [];
        return f;
    }

    function coerceNumber(v) {
        var n = Number(v);
        return isNaN(n) ? v : n;
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
            default: return 'text';
        }
    }

    function propFrom(f) {
        var v = f.validate || {};
        var p = { title: f.label || f.key };
        if (f.description) p.description = f.description;

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
            setStringDefault(p, f);
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
            var seen = [];
            p.oneOf = (f.options || []).filter(function (o) {
                var v = String(o.value == null ? '' : o.value);
                if (seen.indexOf(v) !== -1) return false;
                seen.push(v);
                return true;
            }).map(function (o) {
                return { const: String(o.value == null ? '' : o.value), title: o.label != null && o.label !== '' ? o.label : String(o.value == null ? '' : o.value) };
            });
            if (f.defaultValue !== undefined && f.defaultValue !== null && seen.indexOf(String(f.defaultValue)) !== -1) {
                p.default = String(f.defaultValue);
            }
            return p;
        }

        if (f.type === 'radio') {
            var numeric = (f.options || []).length > 0 && (f.options || []).every(function (o) { return isNumericValue(o.value); });
            var type = numeric ? 'integer' : 'string';
            p.type = type;
            var seen2 = [];
            p.oneOf = (f.options || []).filter(function (o) {
                var v = String(o.value == null ? '' : o.value);
                if (seen2.indexOf(v) !== -1) return false;
                seen2.push(v);
                return true;
            }).map(function (o) {
                var val = numeric ? coerceNumber(o.value) : String(o.value == null ? '' : o.value);
                return { const: val, title: o.label || String(o.value == null ? '' : o.value) };
            });
            if (f.defaultValue !== undefined && f.defaultValue !== null) {
                var def = f.options.filter(function (o) { return String(o.value) === String(f.defaultValue); })[0];
                if (def) p.default = numeric ? coerceNumber(def.value) : String(def.value == null ? '' : def.value);
            }
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
        if (v.pattern) p.pattern = v.pattern;
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
            if (item.type === 'divider' || item.type === 'paragraph') {
                if (cur.length) { rows.push({ type: 'row', fields: cur }); cur = []; }
                rows.push({ type: 'row', fields: [], layoutElement: { type: item.type, text: item.text || '' } });
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

        fields.forEach(function (f) {
            var key = f.key;
            if (!key) return;
            if (f.type === 'divider' || f.type === 'paragraph') {
                layoutItems.push({ type: f.type, text: f.label || '', grid: 12 });
                return;
            }
            if (!properties[key]) properties[key] = propFrom(f);

            if (f.type !== 'hidden') {
                uiFields[key] = { 'ui:widget': widgetFor(f.type) };
                layoutItems.push({ name: key, grid: f.grid || 12 });
                if (f.required) topRequired.push(key);
            }

            var numeric = f.type === 'radio' && (f.options || []).length > 0 && (f.options || []).every(function (o) { return isNumericValue(o.value); });

            (f.options || []).forEach(function (opt) {
                var kids = (opt.children || []).filter(function (c) { return c && c.key; });
                if (!kids.length) return;
                var constVal = numeric ? coerceNumber(opt.value) : String(opt.value == null ? '' : opt.value);
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
                    if (f.type === 'select') layoutItems.push({ name: c.key, grid: c.grid || 12 });
                });
            });
        });

        var schema = { type: 'object' };
        if (config.description) schema.description = config.description;
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
            }
        };
    }

    function inferType(p, ui) {
        if (p.oneOf) return (ui && ui['ui:widget'] === 'custom-select') ? 'select' : 'radio';
        if (p.enum) return 'select';
        if (p.type === 'boolean') return 'checkbox';
        if (p.type === 'integer' || p.type === 'number') return 'number';
        if (p.type === 'string') {
            if (p.format === 'email') return 'email';
            if (p.format === 'uri' || p.format === 'url') return 'url';
            if (p.format === 'date' || p.format === 'date-time') return 'date';
            return 'text';
        }
        return 'text';
    }

    function fieldFromProp(key, p, type, required, grid) {
        var f = {
            id: newId(),
            type: type,
            key: key,
            label: p.title || key,
            required: !!required,
            grid: grid || 12,
            validate: {},
            options: null,
            defaultValue: undefined
        };
        if (p.default !== undefined) f.defaultValue = p.default;
        if (p.description !== undefined) f.description = p.description;
        if (type === 'number') {
            if (p.minimum !== undefined) f.validate.min = p.minimum;
            if (p.maximum !== undefined) f.validate.max = p.maximum;
        } else if (type === 'text') {
            if (p.minLength !== undefined) f.validate.minLength = p.minLength;
            if (p.maxLength !== undefined) f.validate.maxLength = p.maxLength;
            if (p.pattern !== undefined) f.validate.pattern = p.pattern;
        } else if (type === 'textarea') {
            if (p.minLength !== undefined) f.validate.minLength = p.minLength;
            if (p.maxLength !== undefined) f.validate.maxLength = p.maxLength;
        }
        if (type === 'select') {
            var selOpts = (p.oneOf || []).map(function (o) { return { value: String(o.const), label: o.title != null && o.title !== '' ? String(o.title) : String(o.const), children: [] }; });
            if (!selOpts.length) {
                var en = p.enum || [];
                selOpts = en.map(function (v) { return { value: String(v), label: String(v), children: [] }; });
            }
            f.options = selOpts;
        } else if (type === 'radio') {
            f.options = (p.oneOf || []).map(function (o) { return { value: String(o.const), label: o.title != null ? o.title : String(o.const), children: [] }; });
        }
        return f;
    }

    function importConfig(doc) {
        doc = doc || {};
        var schema = doc.schema || doc;
        var uiSchema = doc.uiSchema || {};
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
                orderEntries.push({
                    layout: true,
                    field: {
                        id: newId(),
                        type: le.type,
                        key: '__' + le.type + '_' + Math.random().toString(36).slice(2, 7),
                        label: le.text || (le.type === 'divider' ? 'Divider' : 'Paragraph'),
                        required: false,
                        grid: 12,
                        validate: {},
                        options: null,
                        defaultValue: undefined
                    }
                });
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
            var f = fieldFromProp(name, p, type, req.indexOf(name) !== -1, gridMap[name] || 12);
            rules.forEach(function (r) {
                if (r.parent !== name) return;
                var opt = (f.options || []).filter(function (o) { return String(o.value) === String(r.constVal); })[0];
                if (!opt) return;
                r.children.forEach(function (ck) {
                    if (!props[ck] || seen[ck]) return;
                    seen[ck] = true;
                    var cp = props[ck];
                    var ctype = inferType(cp, (uiSchema.fields || {})[ck]);
                    var cui = (uiSchema.fields || {})[ck] || {};
                    var cg = cui['ui:grid'] || gridMap[ck] || 12;
                    opt.children.push(fieldFromProp(ck, cp, ctype, true, cg));
                });
            });
            fields.push(f);
        });

        return {
            name: schema.title || schema.name || '',
            description: schema.description || '',
            idPrefix: uiSchema.idPrefix || '',
            fields: fields
        };
    }

    function childFieldTypes() {
        return ['text', 'number', 'email', 'url', 'phone', 'textarea', 'date', 'select', 'checkbox'];
    }

    function allTypes() {
        return ['text', 'number', 'email', 'url', 'phone', 'textarea', 'date', 'select', 'radio', 'checkbox', 'hidden', 'paragraph', 'divider'];
    }

    return {
        newId: newId,
        labelToKey: labelToKey,
        fieldDefaultLabel: fieldDefaultLabel,
        makeField: makeField,
        allTypes: allTypes,
        childFieldTypes: childFieldTypes,
        compile: compile,
        importConfig: importConfig
    };
});