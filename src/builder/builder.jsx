import { h, render } from 'preact';
import { useEffect } from 'preact/hooks';
import Sortable from 'sortablejs';
import * as SCNS from '../../lib/schema-compile.js';
// Dev: nạp engine trực tiếp (prod dùng dist/builder/custom-dynamic-form.js qua <script>).
if (import.meta.env.DEV) { import('../CustomDynamicForm.jsx'); }
import './builder.css';

// schema-compile.js is UMD: vite dev serves it without CJS interop (global gets set on
// evaluation), while rolldown build wraps it in CJS (default export = the lib object).
const SC = (SCNS && SCNS.default && SCNS.default.SchemaCompile) || SCNS.default || window.SchemaCompile;

var TYPE_NAMES = {
    text: 'Text',
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
var GLYPHS = {
    text: 'Aa', number: '123', email: '\u2709', url: 'URI', phone: 'TEL',
    textarea: '\u00b6', date: '\u25f7', select: '\u25be', radio: '\u25c9', checkbox: '\u2611', hidden: '\u25cc',
    paragraph: '\u00b6', divider: '\u2500', heading: 'H'
};
var CHILD_TYPES = SC.childFieldTypes();

function Builder() {
    useEffect(function () {
        'use strict';

        var STORE_KEY = 'custom-form-builder:forms';

        function $(id) { return document.getElementById(id); }

        var canvasEl = $('canvas');
        var paletteEl = $('palette-list');
        var settingsEl = $('settings-body');
        var jsonOut = $('json-out');
        var previewForm = $('preview-form');
        var canvasCol = document.querySelector('.canvas-col');

        var state = {
            config: { name: '', idPrefix: '', fields: [] },
            selectedId: null,
            editingChild: null,
            confirmDel: false,
            tab: 'preview',
            editLocale: 'vi',
            previewLocale: 'vi'
        };

        function el(tag, cls, text) {
            var n = document.createElement(tag);
            if (cls) n.className = cls;
            if (text !== undefined && text !== null) n.textContent = text;
            return n;
        }

        // Văn bản hiển thị trên canvas theo ngôn ngữ đang nhập (EN fallback về VI).
        function dispText(f) {
            return state.editLocale === 'en'
                ? (f.labelEn != null && f.labelEn !== '' ? f.labelEn : f.label)
                : f.label;
        }
        function dispOptLabel(o) {
            return state.editLocale === 'en'
                ? (o.labelEn != null && o.labelEn !== '' ? o.labelEn : o.label)
                : o.label;
        }
        function stripHtml(s) {
            return String(s).replace(/<[^>]*>/g, '');
        }

        function walkFields(cb) {
            state.config.fields.forEach(function (f) {
                cb(f, null, null, null);
                (f.options || []).forEach(function (opt) {
                    (opt.children || []).forEach(function (c) {
                        cb(c, f, opt);
                    });
                });
            });
        }

        function isChildField(f) {
            return state.config.fields.indexOf(f) === -1;
        }

        function parentOf(f) {
            var found = null;
            walkFields(function (x, p) {
                if (x.id === f.id) found = p;
            });
            return found;
        }

        function parentOptionOf(f) {
            var p = parentOf(f), found = null;
            if (p) (p.options || []).forEach(function (o) {
                (o.children || []).forEach(function (c) { if (c.id === f.id) found = o; });
            });
            return found;
        }

        function findFieldById(id) {
            var res = null;
            walkFields(function (f) { if (f.id === id) res = f; });
            return res;
        }

        function usedKeys() {
            var s = {};
            walkFields(function (f) { if (f.key) s[f.key] = true; });
            return s;
        }

        function childIndex(node) {
            var i = 0;
            while ((node = node.previousElementSibling)) i += 1;
            return i;
        }

        function normalizeDefault(f, val) {
            if (val === '') return undefined;
            if (f.type === 'number') {
                var n = Number(val);
                return isNaN(n) ? undefined : n;
            }
            if (f.type === 'checkbox') return val === 'true';
            return val;
        }

        function shareDefaults(f) {
            var c = {};
            if (f.defaultValue !== undefined) c.defaultValue = f.defaultValue;
            if (f.validate) c.validate = f.validate;
            return c;
        }

        function sanitizeKey(f) {
            var used = usedKeys();
            delete used[f.key];
            f.key = SC.labelToKey(f.key || f.label, Object.keys(used));
        }

        function toast(msg, kind) {
            var t = $('toast');
            t.textContent = msg;
            t.classList.remove('ok', 'err');
            if (kind) t.classList.add(kind);
            t.classList.add('show');
            clearTimeout(toast._t);
            toast._t = setTimeout(function () { t.classList.remove('show'); }, 2400);
        }

        function compiled() {
            return SC.compile(state.config);
        }

        function renderJSON() {
            jsonOut.value = JSON.stringify(compiled(), null, 2);
            renderKeyWarning();
        }

        function findDuplicateKeys() {
            return SC.duplicateKeys(state.config);
        }

        function renderKeyWarning() {
            var elw = $('key-warning');
            if (!elw) return;
            var dups = findDuplicateKeys();
            if (!dups.length) {
                elw.classList.add('hidden');
                elw.textContent = '';
                return;
            }
            elw.textContent = '\u26a0 Trùng key: ' + dups.join(', ') + ' \u2014 các field trùng key sẽ ghi đè nhau trong JSON schema, hãy đổi key khác.';
            elw.classList.remove('hidden');
        }

        // Chuỗi cảnh báo trùng key (rỗng nếu không có) để ghép vào toast.
        function dupKeyHint() {
            var d = findDuplicateKeys();
            return d.length ? ' — cảnh báo trùng key: ' + d.join(', ') : '';
        }

        var previewTimer = null;
        function schedulePreview() {
            clearTimeout(previewTimer);
            previewTimer = setTimeout(refreshPreview, 250);
        }
        function refreshPreview() {
            var c = compiled();
            var pf = $('preview-form');
            if (pf) {
                // Dev: engine nạp async qua import() → custom element có thể chưa upgrade;
                // bỏ property shadow để setter trên prototype chạy đúng (dựa vào class đã define).
                delete pf.schema;
                delete pf.uiSchema;
                pf.schema = c.schema;
                pf.uiSchema = c.uiSchema;
            }
            $('preview-status').textContent = 'Cập nhật ' + new Date().toLocaleTimeString() + ' [' + (state.previewLocale || 'vi') + ']';
            renderKeyWarning();
        }

        function setPreviewLocale(loc) {
            state.previewLocale = loc;
            var pf = $('preview-form');
            if (pf) pf.lang = loc;
            document.querySelectorAll('.locale-group .locale-btn').forEach(function (b) {
                b.classList.toggle('active', b.getAttribute('data-locale') === loc);
            });
            refreshPreview();
        }

        function setEditLocale(loc) {
            state.editLocale = loc;
            document.querySelectorAll('.modal-locale-group .locale-btn').forEach(function (b) {
                b.classList.toggle('active', b.getAttribute('data-act') === 'edit-locale-' + loc);
            });
            renderCanvas();
            renderSettings();
            renderJSON();
            schedulePreview();
        }

        function buildCardNode(f) {
            if (f.type === 'divider' || f.type === 'paragraph' || f.type === 'heading') {
                var lcard = el('div', 'canvas-field layout-field' + (f.id === state.selectedId ? ' selected' : ''));
                lcard.setAttribute('data-id', f.id);
                lcard.appendChild(el('div', 'drag-handle', '\u22ee\u22ee'));
                var lmain = el('div', 'field-main');
                if (f.type === 'divider') {
                    lmain.appendChild(el('div', 'layout-divider-visual'));
                } else if (f.type === 'heading') {
                    lmain.appendChild(el('div', 'field-label layout-heading-text', dispText(f) || '(chưa có tiêu đề)'));
                } else {
                    lmain.appendChild(el('div', 'field-label layout-paragraph-text', dispText(f) || '(trống)'));
                }
                var lmeta = el('div', 'field-meta');
                lmeta.appendChild(el('span', 'badge layout-badge', TYPE_NAMES[f.type] || f.type));
                lmain.appendChild(lmeta);
                lcard.appendChild(lmain);
                var ldel = el('button', 'ibtn del', '\u2715');
                ldel.setAttribute('data-role', 'del-field');
                ldel.setAttribute('data-id', f.id);
                ldel.title = 'Xóa';
                lcard.appendChild(ldel);
                return lcard;
            }
            var card = el('div', 'canvas-field' + (f.id === state.selectedId ? ' selected' : ''));
            card.setAttribute('data-id', f.id);
            card.appendChild(el('div', 'drag-handle', '\u22ee\u22ee'));
            var main = el('div', 'field-main');
            main.appendChild(el('div', 'field-label', dispText(f) || f.key || '(chưa có nhãn)'));
            var meta = el('div', 'field-meta');
            meta.appendChild(el('span', 'badge', TYPE_NAMES[f.type] || f.type));
            meta.appendChild(el('span', 'badge key', f.key || ''));
            if (f.required) meta.appendChild(el('span', 'badge req', '* bắt buộc'));
            meta.appendChild(el('span', 'badge grid', String(f.grid || 12)));
            var kids = childCount(f);
            if (kids) meta.appendChild(el('span', 'badge child', 'children ' + kids));
            if (f.type === 'hidden') meta.appendChild(el('span', 'badge', 'ẩn'));
            main.appendChild(meta);
            if (f.options && f.options.length) {
                var optBox = el('div', 'canvas-options');
                f.options.forEach(function (o) {
                    if (f.type === 'radio') {
                        var line = el('div', 'opt-line');
                        line.appendChild(el('span', 'opt-line-mark', '\u25c9'));
                        line.appendChild(el('span', 'opt-line-label', dispOptLabel(o) || o.value || '(trống)'));
                        if (o.children && o.children.length) line.appendChild(el('span', 'badge child', 'children ' + o.children.length));
                        optBox.appendChild(line);
                    } else {
                        optBox.appendChild(el('span', 'badge opt-badge', dispOptLabel(o) || o.value || '(trống)'));
                    }
                });
                main.appendChild(optBox);
            }
            card.appendChild(main);
            var del = el('button', 'ibtn del', '\u2715');
            del.setAttribute('data-role', 'del-field');
            del.setAttribute('data-id', f.id);
            del.title = 'Xóa field';
            card.appendChild(del);
            return card;
        }

        function childCount(f) {
            var n = 0;
            (f.options || []).forEach(function (o) { n += (o.children || []).length; });
            return n;
        }

        function renderCanvas() {
            canvasEl.innerHTML = '';
            state.config.fields.forEach(function (f) {
                canvasEl.appendChild(buildCardNode(f));
            });
            updateEmptyHint();
        }

        function updateEmptyHint() {
            canvasCol.classList.toggle('has-empty', state.config.fields.length === 0);
        }

        function touchCard(f) {
            var t = isChildField(f) ? parentOf(f) : f;
            if (!t) return;
            var card = canvasEl.querySelector('.canvas-field[data-id="' + t.id + '"]');
            if (card) card.replaceWith(buildCardNode(t));
        }

        function renderPalette() {
            SC.allTypes().forEach(function (t) {
                var item = el('div', 'palette-item');
                item.setAttribute('data-type', t);
                item.appendChild(el('span', 'glyph', GLYPHS[t]));
                item.appendChild(el('span', 'pname', TYPE_NAMES[t]));
                paletteEl.appendChild(item);
            });
        }

        function settingRow(labelText, inputNode) {
            var row = el('div', 'setting-row');
            var lb = el('label', 'row-label', labelText);
            row.appendChild(lb);
            row.appendChild(inputNode);
            return row;
        }

        function inlineRow(labelText, inputNode, hint) {
            var row = settingRow(labelText, inputNode);
            row.classList.add('inline');
            if (hint !== undefined && hint !== null) {
                var lb = row.querySelector('.row-label');
                lb.appendChild(document.createElement('br'));
                lb.appendChild(el('span', 'hint', hint));
            }
            return row;
        }

        function textInput(val, bind) {
            var i = document.createElement('input');
            i.type = 'text';
            i.className = 'input';
            i.value = val == null ? '' : val;
            i.setAttribute('data-bind', bind);
            i.autocomplete = 'off';
            i.spellcheck = false;
            return i;
        }

        function numInput(val, bind) {
            var i = document.createElement('input');
            i.type = 'number';
            i.className = 'input';
            i.value = val == null ? '' : val;
            i.setAttribute('data-bind', bind);
            return i;
        }

        function dateInput(val, bind) {
            var i = document.createElement('input');
            i.type = 'date';
            i.className = 'input';
            i.value = val == null ? '' : val;
            i.setAttribute('data-bind', bind);
            return i;
        }

        function bindButton(label, role) {
            var b = el('button', 'sub-btn', label);
            b.setAttribute('data-role', role);
            b.type = 'button';
            return b;
        }

        function insertLinkAtCursor(ta) {
            var start = ta.selectionStart;
            var end = ta.selectionEnd;
            var sel = ta.value.slice(start, end) || 'Liên kết';
            var open = '<a href="https://">';
            ta.value = ta.value.slice(0, start) + open + sel + '</a>' + ta.value.slice(end);
            ta.focus();
            var caret = start + open.length;
            ta.setSelectionRange(caret, caret + sel.length);
            ta.dispatchEvent(new Event('input', { bubbles: true }));
        }

        function quickLinkButton(ta) {
            var b = el('button', 'sub-btn', '\u2795 Gắn nhanh thẻ <a>…</a>');
            b.type = 'button';
            b.title = 'Chèn link tại con trỏ (bôi đen văn bản để bọc vào thẻ a)';
            b.addEventListener('click', function () { insertLinkAtCursor(ta); });
            return b;
        }

        function labelControl(f) {
            var isEn = state.editLocale === 'en';
            var bind = isEn ? 'label-en' : 'label';
            var val = isEn ? f.labelEn : f.label;
            var ph;
            if (isEn) {
                ph = val
                    ? 'Nhập nhãn tiếng Anh… Có thể dùng thẻ <a href="https://…">…</a>'
                    : (f.label
                        ? 'Đang hiển thị (VI): ' + stripHtml(f.label)
                        : 'Nhập nhãn tiếng Anh… Có thể dùng thẻ <a href="https://…">…</a>');
            } else {
                ph = 'Nhập nhãn… Có thể dùng thẻ <a href="https://…">…</a>';
            }
            if (f.type !== 'checkbox') { var i = textInput(val, bind); i.placeholder = ph; return i; }
            var ta = document.createElement('textarea');
            ta.className = 'input';
            ta.rows = 3;
            ta.value = val || '';
            ta.setAttribute('data-bind', bind);
            ta.spellcheck = false;
            ta.placeholder = ph;
            var wrap = el('div');
            wrap.appendChild(ta);
            wrap.appendChild(quickLinkButton(ta));
            return wrap;
        }

        function buildValidationSection(f) {
            var wrap = el('div', 'setting-group');
            wrap.appendChild(el('label', 'setting-label', 'Ràng buộc'));
            if (f.type === 'number') {
                wrap.appendChild(settingRow('Giá trị nhỏ nhất', numInput(f.validate.min, 'min')));
                wrap.appendChild(settingRow('Giá trị lớn nhất', numInput(f.validate.max, 'max')));
            } else if (f.type === 'date') {
                wrap.appendChild(inlineRow('Ngày nhỏ nhất', dateInput(f.validate.min, 'date-min'), 'Định dạng YYYY-MM-DD, để trống nếu không giới hạn'));
                wrap.appendChild(inlineRow('Ngày lớn nhất', dateInput(f.validate.max, 'date-max'), 'Chặn chọn ngày ngoài khoảng khi submit'));
            } else if (f.type === 'text' || f.type === 'textarea') {
                wrap.appendChild(settingRow('Độ dài tối thiểu', numInput(f.validate.minLength, 'minlen')));
                wrap.appendChild(settingRow('Độ dài tối đa', numInput(f.validate.maxLength, 'maxlen')));
                if (f.type === 'text') wrap.appendChild(settingRow('Pattern (regex)', textInput(f.validate.pattern, 'pattern')));
            } else {
                wrap.appendChild(el('p', 'col-hint', 'Không có ràng buộc cho loại này.'));
            }
            return wrap;
        }

function buildRadioSection(f) {
            var wrap = el('div', 'setting-group');
            wrap.appendChild(el('label', 'setting-label', 'Hiển thị (Radio)'));

            var labelGroup = el('div', 'btn-group');
            [['0', 'Hiện'], ['1', 'Ẩn']].forEach(function (pair) {
                var b = el('button', 'btn-opt' + ((f.labelHidden === true) === (pair[0] === '1') ? ' active' : ''), pair[1]);
                b.setAttribute('data-role', 'radio-label-toggle');
                b.setAttribute('data-hidden', pair[0]);
                b.type = 'button';
                labelGroup.appendChild(b);
            });
            wrap.appendChild(inlineRow('Nhãn field', labelGroup, 'Hiện/Ẩn tiêu đề của nhóm radio'));

            var layoutGroup = el('div', 'btn-group');
            [['vertical', 'Dọc'], ['horizontal', 'Ngang']].forEach(function (pair) {
                var b = el('button', 'btn-opt' + ((f.optionsLayout || 'vertical') === pair[0] ? ' active' : ''), pair[1]);
                b.setAttribute('data-role', 'radio-layout-toggle');
                b.setAttribute('data-layout', pair[0]);
                b.type = 'button';
                layoutGroup.appendChild(b);
            });
            wrap.appendChild(inlineRow('Danh sách lựa chọn', layoutGroup, 'Dọc: mỗi option 1 dòng (mặc định) · Ngang: options xếp ngang và tự xuống dòng'));

            return wrap;
        }

function buildDefaultInput(f) {
            if (f.type === 'checkbox') {
                var s = document.createElement('select');
                s.className = 'input';
                s.setAttribute('data-bind', 'defval-boolean');
                [['', 'Mặc định: không'], ['true', 'Mặc định: có (đã tick)'], ['false', 'Mặc định: không tick']].forEach(function (pair) {
                    var o = document.createElement('option');
                    o.value = pair[0]; o.textContent = pair[1];
                    if (String(f.defaultValue) === pair[0]) o.selected = true;
                    s.appendChild(o);
                });
                return s;
            }
            if (f.type === 'date') {
                var d = dateInput(f.defaultValue, 'defval');
                d.title = 'Định dạng YYYY-MM-DD';
                return d;
            }
            return textInput(f.defaultValue, 'defval');
        }

        function buildCommonSection(f) {
            var wrap = el('div', 'setting-group');
            wrap.appendChild(el('label', 'setting-label', 'Cơ bản'));
            wrap.appendChild(settingRow(state.editLocale === 'en' ? 'Nhãn — EN (tiếng Anh)' : 'Nhãn (tên hiển thị)', labelControl(f)));

            var descRow = el('div', 'setting-row');
            descRow.appendChild(el('label', 'row-label', state.editLocale === 'en' ? 'Mô tả — EN (hiện phía dưới field)' : 'Mô tả (hiện phía dưới field, có thể để trống)'));
            var descInput = document.createElement('textarea');
            descInput.className = 'input';
            descInput.rows = 2;
            descInput.value = state.editLocale === 'en' ? (f.descriptionEn || '') : (f.description || '');
            descInput.setAttribute('data-bind', state.editLocale === 'en' ? 'description-en' : 'description');
            descInput.spellcheck = false;
            descInput.placeholder = state.editLocale === 'en'
                ? (f.description ? 'Đang hiển thị (VI): ' + stripHtml(f.description) : 'Nhập mô tả tiếng Anh…')
                : 'Nhập mô tả…';
            descRow.appendChild(descInput);
            wrap.appendChild(descRow);

            var keyRow = el('div', 'setting-row inline');
            var keyLb = el('label', 'row-label', 'Key');
            keyLb.appendChild(document.createElement('br'));
            keyLb.appendChild(el('span', 'hint', 'Giá trị được gửi lên API và lưu trữ'));
            keyRow.appendChild(keyLb);
            var keyInput = textInput(f.key, 'key');
            keyRow.appendChild(keyInput);
            wrap.appendChild(keyRow);

            var reqGroup = el('div', 'btn-group');
            [['0', 'Không'], ['1', 'Có']].forEach(function (pair) {
                var rb = el('button', 'btn-opt' + ((!!f.required) === (pair[0] === '1') ? ' active' : ''), pair[1]);
                rb.type = 'button';
                rb.setAttribute('data-role', 'req-toggle');
                rb.setAttribute('data-req', pair[0]);
                reqGroup.appendChild(rb);
            });
            wrap.appendChild(inlineRow('Bắt buộc', reqGroup, 'Hiển thị dấu hoa thị đỏ (*)'));

            if (!isChildField(f)) {
                var gridGroup = el('div', 'btn-group');
                [[6, '50%'], [12, '100%']].forEach(function (pair) {
                    var gb = el('button', 'btn-opt' + ((f.grid || 12) === pair[0] ? ' active' : ''), pair[1]);
                    gb.type = 'button';
                    gb.setAttribute('data-role', 'grid-toggle');
                    gb.setAttribute('data-grid', String(pair[0]));
                    gridGroup.appendChild(gb);
                });
                wrap.appendChild(inlineRow('Chiều rộng', gridGroup, 'Toàn hàng (100%) hoặc một nửa (50%)'));
            }
            return wrap;
        }

        function buildOptionsEditor(f) {
            var wrap = el('div', 'setting-group');
            wrap.appendChild(el('label', 'setting-label', 'Lựa chọn + field con (children)'));
            var list = el('div', 'opt-list');
            (f.options || []).forEach(function (opt, i) {
                list.appendChild(buildOptionNode(f, opt, i));
            });
            wrap.appendChild(list);
            var add = bindButton('+ Thêm lựa chọn', 'add-opt');
            wrap.appendChild(add);
            if ((f.options || []).length === 0) {
                var hint = el('p', 'col-hint', 'Chưa có lựa chọn nào. Thêm lựa chọn để tạo field con theo option.');
                wrap.insertBefore(hint, list);
            }
            return wrap;
        }

        function arrowBtn(label, role, idx) {
            var b = el('button', 'ibtn', label);
            b.setAttribute('data-role', role);
            b.setAttribute('data-opt', String(idx));
            b.type = 'button';
            b.title = role;
            return b;
        }

        function buildOptionNode(f, opt, i) {
            var item = el('div', 'opt-item');
            var row = el('div', 'opt-row');
            var up = arrowBtn('\u2191', 'opt-up', i);
            up.title = 'Di chuyển lên';
            row.appendChild(up);
            var dn = arrowBtn('\u2193', 'opt-down', i);
            dn.title = 'Di chuyển xuống';
            row.appendChild(dn);
            var isEn = state.editLocale === 'en';
            var lab = textInput(isEn ? opt.labelEn : opt.label, isEn ? 'opt-label-en' : 'opt-label');
            lab.setAttribute('data-opt', String(i));
            lab.classList.add('opt-label');
            lab.placeholder = isEn ? 'Nhãn EN (label)' : 'Nhãn (label)';
            var val = textInput(opt.value, 'opt-value');
            val.classList.add('opt-value');
            val.setAttribute('data-opt', String(i));
            val.placeholder = 'Giá trị (value)';
            row.appendChild(lab);
            row.appendChild(val);
            var hasKids = !!(opt.children && opt.children.length);
            var kidsBtn = el('button', 'sub-btn btn-sm', hasKids ? 'Field con (' + opt.children.length + ')' : '+ Field con');
            kidsBtn.setAttribute('data-role', 'opt-children-toggle');
            kidsBtn.setAttribute('data-opt', String(i));
            kidsBtn.type = 'button';
            kidsBtn.title = hasKids ? 'Thu gọn / mở rộng field con của option này' : 'Thêm field con xuất hiện khi chọn option này';
            row.appendChild(kidsBtn);
            var del = el('button', 'ibtn del', '\u2715');
            del.setAttribute('data-role', 'del-opt');
            del.setAttribute('data-opt', String(i));
            del.type = 'button';
            row.appendChild(del);

            var defWrap = el('label', 'opt-default-wrap');
            defWrap.title = 'Giá trị mặc định (chọn 1 lựa chọn duy nhất)';
            var defCb = document.createElement('input');
            defCb.type = 'checkbox';
            defCb.className = 'opt-default';
            defCb.setAttribute('data-bind', 'opt-default');
            defCb.setAttribute('data-opt', String(i));
            defCb.checked = (f.defaultValue !== undefined && f.defaultValue !== null && String(f.defaultValue) === String(opt.value));
            defWrap.appendChild(defCb);
            defWrap.appendChild(el('span', null, 'mặc định'));
            row.appendChild(defWrap);

            item.appendChild(row);

            if (opt.children) {
                var cwrap = el('div', 'opt-children');
                var ct = el('div', 'opt-children-title');
                ct.appendChild(el('span', null, 'Field con xuất hiện khi chọn "' + (dispOptLabel(opt) || opt.value || '?') + '"'));
                ct.appendChild(el('span', 'hint', '(bắt buộc khi hiển thị)'));
                cwrap.appendChild(ct);
                opt.children.forEach(function (c, ci) {
                    cwrap.appendChild(buildChildNode(opt, c, ci));
                });
                var addc = bindButton('+ Thêm field con', 'add-child');
                addc.setAttribute('data-opt', String(i));
                cwrap.appendChild(addc);
                item.appendChild(cwrap);
            }
            return item;
        }

        function buildChildNode(opt, c, ci) {
            var box = el('div', 'child-item');
            var top = el('div', 'child-top');
            var sel = document.createElement('select');
            sel.className = 'input';
            sel.setAttribute('data-bind', 'child-type');
            sel.setAttribute('data-child', c.id);
            CHILD_TYPES.forEach(function (t) {
                var o = document.createElement('option');
                o.value = t;
                o.textContent = TYPE_NAMES[t];
                if (t === c.type) o.selected = true;
                sel.appendChild(o);
            });
            top.appendChild(sel);
            var isEn = state.editLocale === 'en';
            var lab = textInput(isEn ? c.labelEn : c.label, isEn ? 'child-label-en' : 'child-label');
            lab.setAttribute('data-child', c.id);
            top.appendChild(lab);
            var edit = el('button', 'ibtn', '\u270e');
            edit.setAttribute('data-role', 'edit-child');
            edit.setAttribute('data-child', c.id);
            edit.type = 'button';
            edit.title = 'Chi tiết';
            top.appendChild(edit);
            var del = el('button', 'ibtn del', '\u2715');
            del.setAttribute('data-role', 'del-child');
            del.setAttribute('data-child', c.id);
            del.type = 'button';
            top.appendChild(del);
            box.appendChild(top);
            if (state.editingChild === c.id) {
                box.appendChild(buildChildEdit(c));
            }
            return box;
        }

        function buildChildEdit(c) {
            var wrap = el('div', 'child-edit');
            var keyRow = el('div', 'setting-row');
            keyRow.appendChild(el('label', 'row-label', 'Key'));
            var keyIn = textInput(c.key, 'child-key');
            keyIn.setAttribute('data-child', c.id);
            keyRow.appendChild(keyIn);
            wrap.appendChild(keyRow);

            var cgridGroup = el('div', 'btn-group');
            [[6, '50%'], [12, '100%']].forEach(function (pair) {
                var gb = el('button', 'btn-opt' + ((c.grid || 12) === pair[0] ? ' active' : ''), pair[1]);
                gb.type = 'button';
                gb.setAttribute('data-role', 'grid-toggle');
                gb.setAttribute('data-grid', String(pair[0]));
                gb.setAttribute('data-child', c.id);
                cgridGroup.appendChild(gb);
            });
            wrap.appendChild(inlineRow('Chiều rộng', cgridGroup, 'Toàn hàng (100%) hoặc một nửa (50%)'));

            if (c.type === 'checkbox') {
                var s = document.createElement('select');
                s.className = 'input';
                s.setAttribute('data-bind', 'child-defval-boolean');
                s.setAttribute('data-child', c.id);
                [['', 'Mặc định: không'], ['true', 'Mặc định: có'], ['false', 'Mặc định: không tick']].forEach(function (p) {
                    var o = document.createElement('option');
                    o.value = p[0]; o.textContent = p[1];
                    if (String(c.defaultValue) === p[0]) o.selected = true;
                    s.appendChild(o);
                });
                wrap.appendChild(settingRow('Mặc định', s));
            } else if (c.type === 'select') {
                var ol = el('div', 'opt-list');
                (c.options || []).forEach(function (o, idx) {
                    var orow = el('div', 'opt-item');
                    var ro = el('div', 'opt-row');
                    var ock = document.createElement('input');
                    ock.type = 'checkbox';
                    ock.className = 'opt-default';
                    ock.title = 'Giá trị mặc định';
                    ock.setAttribute('data-bind', 'copt-default');
                    ock.setAttribute('data-child', c.id);
                    ock.setAttribute('data-copt', String(idx));
                    ock.checked = (c.defaultValue !== undefined && c.defaultValue !== null && String(c.defaultValue) === String(o.value));
                    ro.appendChild(ock);
                    var isEn = state.editLocale === 'en';
                    var olb = textInput(isEn ? o.labelEn : o.label, isEn ? 'copt-label-en' : 'copt-label');
                    olb.setAttribute('data-child', c.id);
                    olb.setAttribute('data-copt', String(idx));
                    olb.classList.add('opt-label');
                    olb.placeholder = isEn ? 'Nhãn EN (label)' : 'Nhãn (label)';
                    var ov = textInput(o.value, 'copt-value');
                    ov.setAttribute('data-child', c.id);
                    ov.setAttribute('data-copt', String(idx));
                    ov.classList.add('opt-value');
                    ov.placeholder = 'Giá trị (value)';
                    var od = el('button', 'ibtn del', '\u2715');
                    od.setAttribute('data-role', 'del-copt');
                    od.setAttribute('data-child', c.id);
                    od.setAttribute('data-copt', String(idx));
                    od.type = 'button';
                    ro.appendChild(olb); ro.appendChild(ov); ro.appendChild(od);
                    orow.appendChild(ro);
                    ol.appendChild(orow);
                });
                wrap.appendChild(ol);
                var addc = bindButton('+ Thêm lựa chọn', 'add-copt');
                addc.setAttribute('data-child', c.id);
                wrap.appendChild(addc);
                wrap.appendChild(el('p', 'col-hint', 'Dropdown này không có field con (chỉ cấp 1).'));
            } else {
                var defVal = (c.type === 'date') ? dateInput(c.defaultValue, 'child-defval') : textInput(c.defaultValue, 'child-defval');
                wrap.appendChild(settingRow(('number' === c.type) ? 'Mặc định (số)' : 'Mặc định', defVal));
            }

            if (c.type === 'number') {
                wrap.appendChild(settingRow('Giá trị nhỏ nhất', withChild(numInput(c.validate.min, 'child-min'), c.id)));
                wrap.appendChild(settingRow('Giá trị lớn nhất', withChild(numInput(c.validate.max, 'child-max'), c.id)));
            } else if (c.type === 'date') {
                wrap.appendChild(inlineRow('Ngày nhỏ nhất', withChild(dateInput(c.validate.min, 'child-date-min'), c.id), 'Định dạng YYYY-MM-DD, để trống nếu không giới hạn'));
                wrap.appendChild(inlineRow('Ngày lớn nhất', withChild(dateInput(c.validate.max, 'child-date-max'), c.id), 'Chặn chọn ngày ngoài khoảng khi submit'));
            } else if (c.type === 'text' || c.type === 'textarea') {
                wrap.appendChild(settingRow('Độ dài tối thiểu', withChild(numInput(c.validate.minLength, 'child-minlen'), c.id)));
                wrap.appendChild(settingRow('Độ dài tối đa', withChild(numInput(c.validate.maxLength, 'child-maxlen'), c.id)));
            }
            return wrap;
        }

        function withChild(inputNode, attr) {
            inputNode.setAttribute('data-child', attr);
            return inputNode;
        }

        function renderSettings() {
            if (!$('settings-modal').classList.contains('hidden')) renderSettingsBody();
        }

        function buildSettingsFooter() {
            var foot = el('div', 'settings-footer');
            var delBtn = el('button', 'btn btn-sm btn-danger del-field-btn', 'Xóa field');
            delBtn.type = 'button';
            delBtn.setAttribute('data-role', 'del-field');
            foot.appendChild(delBtn);
            var doneBtn = el('button', 'btn btn-sm btn-primary', 'Xong');
            doneBtn.type = 'button';
            doneBtn.setAttribute('data-act', 'close-settings');
            foot.appendChild(doneBtn);
            return foot;
        }

        function renderSettingsBody() {
            state.confirmDel = false;
            settingsEl.innerHTML = '';
            var f = findFieldById(state.selectedId);
            if (!f) {
                settingsEl.innerHTML = '';
                return;
            }
            var titleText = (f.label || '') + ' — ' + (TYPE_NAMES[f.type] || f.type);
            var titleEl = $('settings-title');
            titleEl.textContent = titleText.length > 50 ? titleText.slice(0, 50) + '…' : titleText;
            titleEl.title = titleText;
            var box = el('div');
            var banner = el('div', 'field-type-banner');
            banner.appendChild(el('span', null, TYPE_NAMES[f.type] || f.type));
            if (isChildField(f)) {
                var po = parentOptionOf(f);
                banner.appendChild(el('span', 'badge child', 'field con · "' + ((po && (po.label || po.value)) || '?') + '"'));
            }
            box.appendChild(banner);

            if (f.type === 'divider' || f.type === 'paragraph' || f.type === 'heading') {
                var isEn = state.editLocale === 'en';
                if (f.type === 'heading') {
                    var hgroup = el('div', 'setting-group');
                    hgroup.appendChild(el('label', 'setting-label', isEn ? 'Heading (tiếng Anh)' : 'Tiêu đề'));
                    var hta = document.createElement('textarea');
                    hta.style.width = '100%';
                    hta.className = 'input';
                    hta.rows = 10;
                    hta.value = isEn ? (f.labelEn || '') : (f.label || '');
                    hta.setAttribute('data-bind', isEn ? 'paragraph-text-en' : 'paragraph-text');
                    hta.spellcheck = false;
                    hta.placeholder = isEn
                        ? (f.label ? 'Đang hiển thị (VI): ' + stripHtml(f.label) : 'Nhập nội dung tiếng Anh…')
                        : 'Nhập tiêu đề hiển thị trong form…';
                    hgroup.appendChild(hta);
                    var hnote = document.createElement('p');
                    hnote.className = 'html-note';
                    hnote.innerHTML = 'Hiển thị dạng tiêu đề (H3). Chỉ văn bản thuần, không hỗ trợ thẻ HTML.';
                    hgroup.appendChild(hnote);
                    box.appendChild(hgroup);
                } else if (f.type === 'paragraph') {
                    var pgroup = el('div', 'setting-group');
                    pgroup.appendChild(el('label', 'setting-label', isEn ? 'Nội dung — EN (tiếng Anh)' : 'Nội dung'));
                    var pta = document.createElement('textarea');
                    pta.style.width = '100%';
                    pta.className = 'input';
                    pta.rows = 10;
                    pta.value = isEn ? (f.labelEn || '') : (f.label || '');
                    pta.setAttribute('data-bind', isEn ? 'paragraph-text-en' : 'paragraph-text');
                    pta.spellcheck = false;
                    pta.placeholder = isEn
                        ? (f.label ? 'Đang hiển thị (VI): ' + stripHtml(f.label) : 'Nhập nội dung tiếng Anh…')
                        : 'Nhập đoạn văn hiển thị trong form…';
                    pgroup.appendChild(pta);
                    pgroup.appendChild(quickLinkButton(pta));
                    var pnote = document.createElement('p');
                    pnote.className = 'html-note';
                    pnote.innerHTML = 'Hỗ trợ thẻ <code>&lt;a href="https://…"&gt;…&lt;/a&gt;</code> để chèn liên kết. Các thẻ khác (div, b, span, script…) và thuộc tính style/class/on* sẽ bị bỏ khi hiển thị.';
                    pgroup.appendChild(pnote);
                    box.appendChild(pgroup);
                } else {
                    box.appendChild(el('p', 'col-hint', 'Kẻ đường phân cách toàn chiều rộng form. Không cần cấu hình thêm.'));
                }
                box.appendChild(buildSettingsFooter());
                settingsEl.appendChild(box);
                return;
            }

            box.appendChild(buildCommonSection(f));
            if (f.type !== 'select' && f.type !== 'radio') box.appendChild(settingRow('Giá trị mặc định', buildDefaultInput(f)));
            if (f.type === 'select' || f.type === 'radio') box.appendChild(buildOptionsEditor(f));
            if (f.type === 'radio') box.appendChild(buildRadioSection(f));
            box.appendChild(buildValidationSection(f));
            box.appendChild(buildSettingsFooter());
            settingsEl.appendChild(box);
        }

        function openSettings(f) {
            state.selectedId = f && f.id;
            state.editingChild = null;
            renderCanvas();
            renderSettingsBody();
            $('settings-modal').classList.remove('hidden');
            renderJSON();
            refreshPreview();
        }

        function closeSettings() {
            state.selectedId = null;
            state.editingChild = null;
            setEditLocale('vi');
            $('settings-modal').classList.add('hidden');
            renderCanvas();
        }

        function refreshAll() {
            renderCanvas();
            renderSettings();
            renderJSON();
            refreshPreview();
        }

        function lightRefresh(f) {
            touchCard(f);
            renderJSON();
            schedulePreview();
        }

        function findChild(id) {
            var res = null;
            var found = false;
            for (var i = 0; i < state.config.fields.length; i++) {
                var f = state.config.fields[i];
                (f.options || []).forEach(function (opt) {
                    (opt.children || []).forEach(function (c) {
                        if (c.id === id) { res = c; found = true; }
                    });
                });
                if (found) break;
            }
            return res;
        }

        function findOptObj(f, parentId) {
            var res = null;
            (f.options || []).forEach(function (o) { if (o.id === parentId) res = o; });
            return res;
        }

        function ensureOptions(f) { if (!f.options) f.options = []; }

        function refreshLoadSelect(selected) {
            var sel = $('load-select');
            sel.innerHTML = '<option value="">-- Mở form đã lưu --</option>';
            var map = listForms();
            Object.keys(map).forEach(function (n) {
                var o = document.createElement('option');
                o.value = n;
                o.textContent = n;
                sel.appendChild(o);
            });
            if (selected) sel.value = selected;
        }

        function listForms() {
            try { return JSON.parse(localStorage.getItem(STORE_KEY) || '{}'); }
            catch (e) { return {}; }
        }

        function syncTopbar() {
            $('form-name').value = state.config.name || '';
            $('form-idprefix').value = state.config.idPrefix || '';
        }

        function saveForm() {
            var map = listForms();
            var name = (state.config.name || '').trim();
            if (!name) name = 'form-' + new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
            state.config.name = name;
            map[name] = JSON.parse(JSON.stringify(state.config));
            localStorage.setItem(STORE_KEY, JSON.stringify(map));
            syncTopbar();
            refreshLoadSelect(name);
            toast('Đã lưu form "' + name + '"', 'ok');
        }

        function loadConfig(cfg) {
            state.config = JSON.parse(JSON.stringify(cfg));
            state.selectedId = null;
            state.editingChild = null;
            syncTopbar();
            refreshAll();
        }

        function exportJson() {
            var blob = new Blob([JSON.stringify(compiled(), null, 2)], { type: 'application/json' });
            var a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = ((state.config.name || 'form').trim().replace(/\s+/g, '-') || 'form') + '.schema.json';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
        }

        function copyJson() {
            var text = JSON.stringify(compiled(), null, 2);
            function done() { toast('Đã copy JSON', 'ok'); }
            function fail() { toast('Không thể copy (cần HTTPS/localhost)', 'err'); }
            if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(text).then(done, fail);
            } else {
                var ta = document.createElement('textarea');
                ta.value = text;
                document.body.appendChild(ta);
                ta.select();
                try { document.execCommand('copy'); done(); } catch (e) { fail(); }
                document.body.removeChild(ta);
            }
        }

        /* ---- Sortable init ---- */

        new Sortable(paletteEl, {
            group: { name: 'form', pull: 'clone', put: false },
            sort: false,
            animation: 120
        });

        new Sortable(canvasEl, {
            group: { name: 'form', pull: true, put: true },
            handle: '.drag-handle',
            animation: 120,
            onAdd: function (evt) {
                var type = evt.item.getAttribute('data-type');
                var idx = childIndex(evt.item);
                evt.item.remove();
                if (!type) return;
                var f = SC.makeField(type, Object.keys(usedKeys()));
                state.config.fields.splice(idx, 0, f);
                openSettings(f);
            },
            onEnd: function () {
                var order = Array.prototype.map.call(canvasEl.querySelectorAll('.canvas-field'), function (c) { return c.getAttribute('data-id'); });
                var byId = {};
                state.config.fields.forEach(function (f) { byId[f.id] = f; });
                state.config.fields = order.map(function (id) { return byId[id]; }).filter(Boolean);
                refreshAll();
            }
        });

        /* ---- Canvas clicks ---- */

        canvasEl.addEventListener('click', function (e) {
            var del = e.target.closest('[data-role="del-field"]');
            if (del) {
                var id = del.getAttribute('data-id');
                var idx = -1;
                state.config.fields.forEach(function (f, i) { if (f.id === id) idx = i; });
                if (idx !== -1) {
                    state.config.fields.splice(idx, 1);
                    if (state.selectedId === id) closeSettings();
                    refreshAll();
                }
                return;
            }
            if (e.target.closest('.drag-handle')) return;
            var cardEl = e.target.closest('.canvas-field');
            if (!cardEl) return;
            var f = findFieldById(cardEl.getAttribute('data-id'));
            if (f) openSettings(f);
        });

        /* ---- Settings events ---- */

        settingsEl.addEventListener('input', function (e) {
            var t = e.target;
            var bind = t.getAttribute ? t.getAttribute('data-bind') : null;
            if (!bind) return;
            var f = findFieldById(state.selectedId);
            if (!f) return;

            if (bind === 'label') f.label = t.value;
            else if (bind === 'label-en') f.labelEn = t.value;
            else if (bind === 'paragraph-text') f.label = t.value;
            else if (bind === 'paragraph-text-en') f.labelEn = t.value;
            else if (bind === 'description') f.description = t.value;
            else if (bind === 'description-en') f.descriptionEn = t.value;
            else if (bind === 'key') f.key = t.value;
            else if (bind === 'defval') f.defaultValue = normalizeDefault(f, t.value);
            else if (bind === 'min') f.validate.min = t.value === '' ? undefined : Number(t.value);
            else if (bind === 'max') f.validate.max = t.value === '' ? undefined : Number(t.value);
            else if (bind === 'date-min') f.validate.min = t.value || undefined;
            else if (bind === 'date-max') f.validate.max = t.value || undefined;
            else if (bind === 'minlen') f.validate.minLength = t.value === '' ? undefined : Number(t.value);
            else if (bind === 'maxlen') f.validate.maxLength = t.value === '' ? undefined : Number(t.value);
            else if (bind === 'pattern') f.validate.pattern = t.value || undefined;
            else if (bind === 'opt-value') { var oi = Number(t.getAttribute('data-opt')); if (f.options[oi]) f.options[oi].value = t.value; }
            else if (bind === 'opt-label') { var ob = Number(t.getAttribute('data-opt')); if (f.options[ob]) f.options[ob].label = t.value; }
            else if (bind === 'opt-label-en') { var oeb = Number(t.getAttribute('data-opt')); if (f.options[oeb]) f.options[oeb].labelEn = t.value; }
            else if (bind === 'child-label') { var cl = findChild(t.getAttribute('data-child')); if (cl) cl.label = t.value; }
            else if (bind === 'child-label-en') { var cle = findChild(t.getAttribute('data-child')); if (cle) cle.labelEn = t.value; }
            else if (bind === 'child-key') { var ck = findChild(t.getAttribute('data-child')); if (ck) ck.key = t.value; }
            else if (bind === 'child-defval') { var cd = findChild(t.getAttribute('data-child')); if (cd) cd.defaultValue = normalizeDefault(cd, t.value); }
            else if (bind === 'child-min') { var cm = findChild(t.getAttribute('data-child')); if (cm) cm.validate.min = t.value === '' ? undefined : Number(t.value); }
            else if (bind === 'child-max') { var cx = findChild(t.getAttribute('data-child')); if (cx) cx.validate.max = t.value === '' ? undefined : Number(t.value); }
            else if (bind === 'child-date-min') { var cdm = findChild(t.getAttribute('data-child')); if (cdm) cdm.validate.min = t.value || undefined; }
            else if (bind === 'child-date-max') { var cdmax = findChild(t.getAttribute('data-child')); if (cdmax) cdmax.validate.max = t.value || undefined; }
            else if (bind === 'child-minlen') { var cln = findChild(t.getAttribute('data-child')); if (cln) cln.validate.minLength = t.value === '' ? undefined : Number(t.value); }
            else if (bind === 'child-maxlen') { var clx = findChild(t.getAttribute('data-child')); if (clx) clx.validate.maxLength = t.value === '' ? undefined : Number(t.value); }
            else if (bind === 'copt-value' || bind === 'copt-label' || bind === 'copt-label-en') {
                var co = findChild(t.getAttribute('data-child'));
                if (co && co.options) {
                    var ci = Number(t.getAttribute('data-copt'));
                    if (co.options[ci]) co.options[ci][bind === 'copt-value' ? 'value' : (bind === 'copt-label' ? 'label' : 'labelEn')] = t.value;
                }
            }

            lightRefresh(f);
        });

        settingsEl.addEventListener('change', function (e) {
            var t = e.target;
            var bind = t.getAttribute('data-bind');
            if (!bind) return;
            var f = findFieldById(state.selectedId);
            if (!f) return;

            var structural = false;
            if (bind === 'grid') { f.grid = Number(t.value); touchCard(f); }
            else if (bind === 'required') { f.required = t.checked; touchCard(f); }
            else if (bind === 'defval-boolean') { f.defaultValue = t.value === '' ? undefined : (t.value === 'true'); }
            else if (bind === 'opt-default') {
                var oi = Number(t.getAttribute('data-opt'));
                if (t.checked && f.options[oi]) {
                    f.defaultValue = f.options[oi].value;
                } else if (!t.checked) {
                    f.defaultValue = undefined;
                }
                structural = true;
            }
            else if (bind === 'copt-default') {
                var cd = findChild(t.getAttribute('data-child'));
                if (cd && cd.options) {
                    var ci = Number(t.getAttribute('data-copt'));
                    if (t.checked && cd.options[ci]) {
                        cd.defaultValue = cd.options[ci].value;
                    } else if (!t.checked) {
                        cd.defaultValue = undefined;
                    }
                }
                structural = true;
            }
            else if (bind === 'child-type') {
                var c = findChild(t.getAttribute('data-child'));
                if (c) {
                    c.type = t.value;
                    if (c.type === 'select') ensureOptions(c);
                    c.validate = {};
                    structural = true;
                }
            }
            else if (bind === 'child-defval-boolean') { var cb = findChild(t.getAttribute('data-child')); if (cb) cb.defaultValue = t.value === '' ? undefined : (t.value === 'true'); }

            if (structural) { renderSettings(); renderJSON(); schedulePreview(); }
            else { renderJSON(); schedulePreview(); }
        });

        settingsEl.addEventListener('blur', function (e) {
            var t = e.target;
            var bind = t.getAttribute('data-bind');
            if (bind !== 'key' && bind !== 'child-key') return;
            var f = bind === 'key' ? findFieldById(state.selectedId) : findChild(t.getAttribute('data-child'));
            if (!f) return;
            var typed = (t.value || '').trim();
            var used = usedKeys();
            var isDup = !!typed && typed !== f.key && !!used[typed];
            sanitizeKey(f);
            if (bind === 'key') { var fi = settingsEl.querySelector('input[data-bind="key"]'); if (fi) fi.value = f.key; }
            if (bind === 'child-key') { t.value = f.key; }
            if (isDup) toast('Key "' + typed + '" bị trùng — đã tự đổi thành "' + f.key + '"', 'err');
            renderJSON();
            schedulePreview();
        }, true);

        settingsEl.addEventListener('click', function (e) {
            var t = e.target.closest('[data-role]');
            if (!t) return;
            var role = t.getAttribute('data-role');
            var f = findFieldById(state.selectedId);
            if (!f) return;

            var parentId = t.getAttribute('data-parent');

            if (role === 'del-field') {
                if (!state.confirmDel) {
                    state.confirmDel = true;
                    var db = settingsEl.querySelector('.del-field-btn');
                    if (db) {
                        db.classList.add('confirm');
                        db.textContent = 'Xóa? Bấm lại để xác nhận';
                    }
                    return;
                }
                var idx = -1;
                state.config.fields.forEach(function (x, i) { if (x.id === f.id) idx = i; });
                if (idx !== -1) state.config.fields.splice(idx, 1);
                closeSettings();
                refreshAll();
                return;
            }

            if (role === 'req-toggle') {
                f.required = t.getAttribute('data-req') === '1';
                touchCard(f);
                renderSettings();
                renderJSON();
                schedulePreview();
                return;
            }

            if (role === 'grid-toggle') {
                var childId = t.getAttribute('data-child');
                if (childId) {
                    var gc = findChild(childId);
                    if (gc) gc.grid = Number(t.getAttribute('data-grid'));
                } else {
                    f.grid = Number(t.getAttribute('data-grid'));
                }
                touchCard(f);
                renderSettings();
                renderJSON();
                schedulePreview();
                return;
            }

            if (role === 'radio-label-toggle') {
                f.labelHidden = t.getAttribute('data-hidden') === '1';
                touchCard(f);
                renderSettings();
                renderJSON();
                schedulePreview();
                return;
            }

            if (role === 'radio-layout-toggle') {
                f.optionsLayout = t.getAttribute('data-layout') === 'horizontal' ? 'horizontal' : undefined;
                touchCard(f);
                renderSettings();
                renderJSON();
                schedulePreview();
                return;
            }

            if (role === 'add-opt') {
                ensureOptions(f);
                f.options.push({ value: '', label: '', children: null });
                refreshAll();
                return;
            }
            if (role === 'del-opt') {
                var di = Number(t.getAttribute('data-opt'));
                if (f.options[di]) f.options.splice(di, 1);
                if (!f.options.length) f.options = null;
                refreshAll();
                return;
            }
            if (role === 'opt-up' || role === 'opt-down') {
                var oi = Number(t.getAttribute('data-opt'));
                var ni = role === 'opt-up' ? oi - 1 : oi + 1;
                if (ni >= 0 && ni < f.options.length) {
                    var tmp = f.options[oi];
                    f.options[oi] = f.options[ni];
                    f.options[ni] = tmp;
                }
                refreshAll();
                return;
            }
            if (role === 'opt-children-toggle') {
                var oo = Number(t.getAttribute('data-opt'));
                var opt = f.options[oo];
                if (!opt) return;
                if (opt.children) opt.children = null;
                else opt.children = [];
                state.editingChild = null;
                refreshAll();
                return;
            }
            if (role === 'add-child') {
                var oa = Number(t.getAttribute('data-opt'));
                var opta = f.options[oa];
                if (!opta) return;
                if (!opta.children) opta.children = [];
                var child = SC.makeField('text', Object.keys(usedKeys()));
                child.grid = 12;
                opta.children.push(child);
                state.editingChild = child.id;
                refreshAll();
                return;
            }
            if (role === 'del-child') {
                var cid = t.getAttribute('data-child');
                [].concat(f.options || []).forEach(function (opt) {
                    if (!opt.children) return;
                    for (var i = 0; i < opt.children.length; i++) {
                        if (opt.children[i].id === cid) { opt.children.splice(i, 1); break; }
                    }
                });
                state.editingChild = null;
                refreshAll();
                return;
            }
            if (role === 'edit-child') {
                var ce = t.getAttribute('data-child');
                state.editingChild = state.editingChild === ce ? null : ce;
                renderSettings();
                return;
            }
            if (role === 'add-copt') {
                var cc = findChild(t.getAttribute('data-child'));
                if (cc) { ensureOptions(cc); cc.options.push({ value: '', label: '' }); renderSettings(); }
                return;
            }
            if (role === 'del-copt') {
                var cch = findChild(t.getAttribute('data-child'));
                if (cch && cch.options) {
                    var oci = Number(t.getAttribute('data-copt'));
                    cch.options.splice(oci, 1);
                    renderSettings();
                }
                return;
            }
        });

        /* ---- Top-bar ---- */

        $('form-name').addEventListener('input', function (e) { state.config.name = e.target.value; });
        $('form-idprefix').addEventListener('input', function (e) { state.config.idPrefix = e.target.value; schedulePreview(); renderJSON(); });

        $('load-select').addEventListener('change', function () {
            var n = this.value;
            if (!n) return;
            var map = listForms();
            if (!map[n]) return;
            loadConfig(map[n]);
            var lh = dupKeyHint();
            toast('Đã mở form "' + n + '"' + lh, lh ? 'err' : 'ok');
        });

        /* ---- Actions ---- */

        var ACTIONS = {
            save: saveForm,
            delete: function () {
                var n = $('load-select').value;
                if (!n) return;
                var map = listForms();
                if (!map[n]) return;
                if (!confirm('Xóa form đã lưu "' + n + '"?')) return;
                delete map[n];
                localStorage.setItem(STORE_KEY, JSON.stringify(map));
                refreshLoadSelect('');
                toast('Đã xóa form "' + n + '"', 'ok');
            },
            new: function () {
                if (state.config.fields.length && !confirm('Tạo form mới? Dữ liệu hiện tại chưa lưu ở LocalStorage sẽ mất.')) return;
                loadConfig({ name: '', idPrefix: '', fields: [] });
                toast('Form mới');
            },
            import: function () {
                $('import-input').value = '';
                $('modal-mask').classList.remove('hidden');
                setTimeout(function () { $('import-input').focus(); }, 50);
            },
            'import-cancel': function () { $('modal-mask').classList.add('hidden'); },
            'import-ok': function () {
                var raw = $('import-input').value.trim();
                if (!raw) { toast('Chưa có JSON', 'err'); return; }
                try {
                    var doc = JSON.parse(raw);
                    var cfg;
                    if (doc && Array.isArray(doc.fields)) {
                        cfg = doc;
                    } else if (doc && doc.schema) {
                        cfg = SC.importConfig({ schema: doc.schema, uiSchema: doc.uiSchema || {} });
                    } else {
                        cfg = SC.importConfig({ schema: doc, uiSchema: {} });
                    }
                    if (!cfg.fields.length) throw new Error('không tìm thấy field nào');
                    loadConfig(cfg);
                    $('modal-mask').classList.add('hidden');
                    var ih = dupKeyHint();
                    toast('Đã nạp import: ' + cfg.fields.length + ' field' + ih, ih ? 'err' : 'ok');
                } catch (err) {
                    toast('Lỗi import: ' + err.message, 'err');
                }
            },
            export: exportJson,
            copy: copyJson,
            'close-settings': closeSettings,
            'refresh-preview': function () { refreshPreview(); toast('Đã làm mới preview', 'ok'); },
            'submit-preview': function () { previewForm.submitForm(); },
            'set-preview-locale-vi': function () { setPreviewLocale('vi'); },
            'set-preview-locale-en': function () { setPreviewLocale('en'); },
            'edit-locale-vi': function () { setEditLocale('vi'); },
            'edit-locale-en': function () { setEditLocale('en'); },
            'clear-preview-json': function () { $('preview-json').textContent = ''; }
        };

        previewForm.addEventListener('onFormSubmit', function (e) {
            $('preview-json').textContent = JSON.stringify(e.detail, null, 2);
        });

        document.addEventListener('click', function (e) {
            var t = e.target.closest('[data-act]');
            if (!t) return;
            var act = t.getAttribute('data-act');
            if (ACTIONS[act]) ACTIONS[act]();
        });

        /* ---- Tabs ---- */

        var tabBtns = Array.prototype.slice.call(document.querySelectorAll('.tab'));
        tabBtns.forEach(function (btn) {
            btn.addEventListener('click', function () {
                state.tab = btn.getAttribute('data-tab');
                tabBtns.forEach(function (b) { b.classList.toggle('active', b === btn); });
                ['preview', 'json'].forEach(function (name) {
                    $('panel-' + name).classList.toggle('active', state.tab === name);
                });
                if (state.tab === 'json') renderJSON();
            });
        });

        document.addEventListener('keydown', function (e) {
            if (e.key !== 'Escape') return;
            if (!$('settings-modal').classList.contains('hidden')) { closeSettings(); return; }
            var mask = $('modal-mask');
            if (!mask.classList.contains('hidden')) mask.classList.add('hidden');
        });

        $('settings-modal').addEventListener('click', function (e) {
            if (e.target === $('settings-modal')) closeSettings();
        });

        /* ---- Seed demo ---- */

        // Dữ liệu mẫu ban đầu: đúng định dạng JSON export/import ({schema, uiSchema})
        var DEMO_JSON = {
            "schema": {
                "type": "object",
                "properties": {
                    "relation": {
                        "title": { "vi": "Đối tượng liên kết", "en": "Registration relation" },
                        "type": "integer",
                        "oneOf": [
                            {
                                "const": 1,
                                "title": { "vi": "Thành viên", "en": "Member" }
                            },
                            {
                                "const": 2,
                                "title": { "vi": "Khách hàng / đối tác", "en": "Customer / partner" }
                            },
                            {
                                "const": 3,
                                "title": { "vi": "Khác", "en": "Other" }
                            }
                        ],
                        "default": 1
                    },
                    "ma_nhan_vien": {
                        "title": { "vi": "Mã nhân viên", "en": "Employee ID" },
                        "type": "string"
                    },
                    "ten_don_vi_gioi_thieu": {
                        "title": { "vi": "Tên đơn vị giới thiệu", "en": "Introducing unit name" },
                        "type": "string",
                        "oneOf": [
                            {
                                "const": "Đơn vị A",
                                "title": { "vi": "Đơn vị A", "en": "Unit A" }
                            },
                            {
                                "const": "Đơn vị B",
                                "title": { "vi": "Đơn vị B", "en": "Unit B" }
                            },
                            {
                                "const": "Đơn vị C",
                                "title": { "vi": "Đơn vị C", "en": "Unit C" }
                            }
                        ]
                    },
                    "checkbox": {
                        "title": { "vi": "Tôi xác nhận tôi từ đủ 18 tuổi trở lên.", "en": "I confirm that I am at least 18 years old." },
                        "type": "boolean"
                    },
                    "checkbox_2": {
                        "title": { "vi": "Tôi đã đọc, hiểu và đồng ý với Điều Khoản Sử Dụng, Thông Báo Về Quyền Riêng Tư, <a href=\"https://\">Thông Báo Về Cookies</a>", "en": "I have read, understood and agree to the Terms of Use, Privacy Notice, <a href=\"https://\">Cookie Notice</a>" },
                        "type": "boolean"
                    }
                },
                "required": [
                    "relation",
                    "checkbox"
                ],
                "allOf": [
                    {
                        "if": {
                            "properties": {
                                "relation": {
                                    "const": 1
                                }
                            }
                        },
                        "then": {
                            "required": [
                                "ma_nhan_vien"
                            ]
                        }
                    },
                    {
                        "if": {
                            "properties": {
                                "relation": {
                                    "const": 2
                                }
                            }
                        },
                        "then": {
                            "required": [
                                "ten_don_vi_gioi_thieu"
                            ]
                        }
                    }
                ]
            },
            "uiSchema": {
                "idPrefix": "demo",
                "fields": {
                    "relation": {
                        "ui:widget": "radio"
                    },
                    "ma_nhan_vien": {
                        "ui:widget": "text"
                    },
                    "ten_don_vi_gioi_thieu": {
                        "ui:widget": "custom-select"
                    },
                    "checkbox": {
                        "ui:widget": "checkbox"
                    },
                    "checkbox_2": {
                        "ui:widget": "checkbox"
                    }
                },
                "layout": [
                    {
                        "type": "row",
                        "fields": [],
                        "layoutElement": {
                            "type": "heading",
                            "text": "HEADING"
                        }
                    },
                    {
                        "type": "row",
                        "fields": [
                            {
                                "name": "relation",
                                "grid": 12
                            }
                        ]
                    },
                    {
                        "type": "row",
                        "fields": [],
                        "layoutElement": {
                            "type": "divider",
                            "text": "Divider"
                        }
                    },
                    {
                        "type": "row",
                        "fields": [],
                        "layoutElement": {
                            "type": "heading",
                            "text": { "vi": "ĐIỀU KHOẢN", "en": "TERMS" }
                        }
                    },
                    {
                        "type": "row",
                        "fields": [],
                        "layoutElement": {
                            "type": "paragraph",
                            "text": { "vi": "Nếu bạn là thành viên, đối tác,...của công ty vui lòng bổ sung thông tin để ghi nhận thành tích cho công ty. Bỏ qua nếu bạn là runner tự do.", "en": "If you are a member or partner of the company, please provide additional information so we can record your achievement for the company. Skip this if you are an independent runner." }
                        }
                    },
                    {
                        "type": "row",
                        "fields": [
                            {
                                "name": "checkbox",
                                "grid": 12
                            }
                        ]
                    },
                    {
                        "type": "row",
                        "fields": [
                            {
                                "name": "checkbox_2",
                                "grid": 12
                            }
                        ]
                    }
                ]
            }
        };

        if (!state.config.fields.length) {
            var demoCfg = SC.importConfig({ schema: DEMO_JSON.schema, uiSchema: DEMO_JSON.uiSchema });
            demoCfg.name = 'Đăng ký tham gia';
            loadConfig(demoCfg);
        }

        /* ---- Init ---- */

        // Chờ engine đăng ký custom-dynamic-form (dev nạp async qua import()) rồi mới đẩy lại preview
        if (window.customElements && customElements.whenDefined) {
            customElements.whenDefined('custom-dynamic-form').then(function () { refreshPreview(); });
        }

        renderPalette();
        refreshLoadSelect('');
    });

    return (
        <div style={"display: flex"}>
            <aside className="palette-sidebar">
                <div className="palette-head">Thành phần</div>
                <div className="palette-list" id="palette-list"></div>
            </aside>

            <main className="main-area">
                <section className="col canvas-col">
                    <div className="canvas-head">
                        <div id="key-warning" className="key-warning hidden"></div>
                        <div className="form-bar">
                            <input id="form-name" className="input form-input" placeholder="Tên form" spellcheck="false" />
                            <input id="form-idprefix" className="input form-input form-input-sm" placeholder="id prefix" spellcheck="false" />
                            <select id="load-select" className="input form-input form-input-md" title="Mở form đã lưu">
                                <option value="">-- Form đã lưu --</option>
                            </select>
                            <button type="button" className="btn btn-sm" data-act="save">Lưu</button>
                            <button type="button" className="btn btn-sm" data-act="new">Mới</button>
                            <button type="button" className="btn btn-sm" data-act="import">Import</button>
                            <button type="button" className="btn btn-sm" data-act="export">Tải JSON</button>
                            <button type="button" className="btn btn-sm" data-act="copy">Copy</button>
                            <button type="button" className="btn btn-sm btn-danger" data-act="delete" title="Xóa form đã lưu">Xóa</button>
                        </div>
                    </div>
                    <div className="canvas" id="canvas"></div>
                    <div className="canvas-empty-tip" id="canvas-tip">Kéo thả thành phần vào canvas…</div>
                </section>

                <aside className="col right-col">
                    <div className="tabs" id="tabs">
                        <button type="button" className="tab active" data-tab="preview">Xem trước</button>
                        <button type="button" className="tab" data-tab="json">JSON xuất</button>
                    </div>

                    <div className="panel active" id="panel-preview">
                        <div className="preview-bar">
                            <span className="locale-group" title="Ngôn ngữ hiển thị form (chọn theo locales trong title)">
                                <button type="button" className="locale-btn active" data-act="set-preview-locale-vi" data-locale="vi">vi</button>
                                <button type="button" className="locale-btn" data-act="set-preview-locale-en" data-locale="en">en</button>
                            </span>
                            <span id="preview-status"></span>
                            <button type="button" className="btn btn-sm" data-act="refresh-preview">Làm mới</button>
                        </div>
                        <div className="preview-body">
                            <custom-dynamic-form id="preview-form"></custom-dynamic-form>
                            <div className="preview-submit-bar">
                                <button type="button" className="btn btn-sm" data-act="submit-preview">Submit</button>
                                <button type="button" className="btn btn-sm" data-act="clear-preview-json">Xóa JSON</button>
                            </div>
                            <pre id="preview-json" className="preview-json" spellcheck="false"></pre>
                        </div>
                    </div>

                    <div className="panel" id="panel-json">
                        <textarea id="json-out" className="json-out" readOnly spellcheck="false"></textarea>
                        <div className="json-actions">
                            <button type="button" className="btn btn-sm" data-act="copy">Sao chép</button>
                            <button type="button" className="btn btn-sm" data-act="export">Tải về .schema.json</button>
                        </div>
                    </div>
                </aside>
            </main>

            <div className="modal-mask hidden" id="settings-modal">
                <div className="modal settings-dialog">
                    <div className="settings-header">
                        <span className="settings-title" id="settings-title">Thiết lập field</span>
                        <span className="settings-header-right">
                            <span className="modal-locale-group" title="Ngôn ngữ nhập liệu cho nhãn field và nội dung đoạn văn/tiêu đề">
                                <button type="button" className="locale-btn active" data-act="edit-locale-vi">vi</button>
                                <button type="button" className="locale-btn" data-act="edit-locale-en">en</button>
                            </span>
                            <button type="button" className="ibtn" data-act="close-settings" title="Đóng">{'\u00d7'}</button>
                        </span>
                    </div>
                    <div id="settings-body"></div>
                </div>
            </div>

            <div className="modal-mask hidden" id="modal-mask">
                <div className="modal">
                    <h3>Import {`{schema, uiSchema}`} (hoặc FormConfig)</h3>
                    <textarea id="import-input" className="json-out" spellcheck="false"></textarea>
                    <div className="json-actions">
                        <button type="button" className="btn btn-sm" data-act="import-ok">Nạp vào builder</button>
                        <button type="button" className="btn btn-sm btn-ghost" data-act="import-cancel">Hủy</button>
                    </div>
                    <p className="col-hint">Dán JSON có dạng {`{"schema": {...}, "uiSchema": {...}}`} hoặc chính cấu trúc FormConfig {`{"name","fields":[...]}`}.</p>
                </div>
            </div>

            <div className="toast hidden" id="toast"></div>
        </div>
    );
}

render(h(Builder), document.getElementById('app'));