'use strict';

function normalizeOptionList(list) {
    var out = [];
    var seen = {};
    (list || []).forEach(function (o) {
        if (!o || o.value == null || o.value === '') return;
        var value = String(o.value);
        if (seen[value]) return;
        seen[value] = true;
        out.push({ value: value, label: String(o.label == null ? '' : o.label) });
    });
    return out;
}

function normalizeOptionListsByKey(listsByKey) {
    var out = {};
    var keys = Object.keys(listsByKey || {});
    for (var i = 0; i < keys.length; i++) {
        var key = keys[i];
        out[key] = normalizeOptionList(listsByKey[key]);
    }
    return out;
}

export { normalizeOptionList, normalizeOptionListsByKey };