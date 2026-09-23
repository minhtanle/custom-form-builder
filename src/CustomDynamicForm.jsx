import { render, Fragment } from 'preact';
import { useState, useEffect, useMemo } from 'preact/hooks';
import { Validator } from '@cfworker/json-schema';
import styles from './styles.css?inline';
import { t } from './i18n.js';
import { safeHtml, stripTags } from './sanitize.js';
import { normalizeOptionListsByKey } from './options.js';
import { listConditionalRules, allConditionalFields, resolveConditionalRules } from './conditional.js';

// Regex chặt hơn format mặc định của validator (@cfworker/json-schema nhận cả "aa@aa")
const EMAIL_RE = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;
// SĐT Việt Nam: đầu 0 hoặc +84/84, sau khi bỏ khoảng trắng/dấu chấm/gạch/ngoặc
const PHONE_RE = /^(?:\+?84|0)[1-9]\d{8,9}$/;
const stripPhone = (s) => String(s).replace(/[\s.\-()]/g, '');
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const SECONDS_PER_HOUR = 3600;
const SECONDS_PER_MINUTE = 60;
const SECONDS_PER_DAY = 24 * SECONDS_PER_HOUR;
const SLIDER_STEP_SECONDS = SECONDS_PER_MINUTE;
const TIME_PART_WIDTH = 2;
const DAY_END_LABEL = '24:00';
const PHONE_MAX_LENGTH = 13;
const GRID_FULL_WIDTH = 12;
const GRID_COLUMNS = 2;
const GRID_HALF_STEP = GRID_FULL_WIDTH / GRID_COLUMNS;
const MIN_COL_SPAN = 1;
// Slider thời gian: giây → "H:MM" (VD 5400 → "1:30"). Bỏ qua số âm/không hợp lệ.
const secToHm = (s) => {
    const sec = Math.max(0, Math.round(Number(s) || 0));
    return `${Math.floor(sec / SECONDS_PER_HOUR)}:${String(Math.floor((sec % SECONDS_PER_HOUR) / SECONDS_PER_MINUTE)).padStart(TIME_PART_WIDTH, '0')}`;
};

// Ép giá trị theo kiểu field khi prefill (data) và khi build payload submit.
// - number/integer: chuỗi "1.5" → 1.5 (dấu chấm); number giữ nguyên; chuỗi chỉ khoảng trắng coi như rỗng '';
//   ép hỏng (NaN) → giữ chuỗi gốc + console.warn (lưu ý: số > 2^53 mất chính xác khi dùng Number).
// - boolean: "true"/"1"/"false"/"0" → true/false; '' → false (checkbox bỏ tick); boolean/null giữ nguyên;
//   khác → giữ chuỗi gốc + console.warn.
// - còn lại (text/textarea/date/select/radio/hidden) → giữ nguyên.
function coerceValue(value, fieldSchema, fieldName) {
    var type = fieldSchema && fieldSchema.type;
    if (type === 'number' || type === 'integer') {
        if (value === '' || value == null) return value;
        if (typeof value === 'number') return value;
        if (typeof value === 'string' && value.trim() === '') return '';
        var n = Number(value);
        if (!isNaN(n)) return n;
        warnCoerce('number', value, fieldName);
        return value;
    }
    if (type === 'boolean') {
        if (value === true || value === false || value == null) return value;
        if (value === '') return false;
        if (value === 'true' || value === '1') return true;
        if (value === 'false' || value === '0') return false;
        warnCoerce('boolean', value, fieldName);
        return value;
    }
    return value;
}

function warnCoerce(type, value, fieldName) {
    console.warn('[CustomDynamicForm] Ép ' + type + ' thất bại: "' + value + '"' + (fieldName ? ' (field: ' + fieldName + ')' : '') + ' → giữ nguyên, kiểm tra kiểu field');
}

function DynamicFormCore({ schema, uiSchema, onSubmit, onSubmitError, onFieldChange, apiRef, optionsRef, lang, data }) {
    // Khởi tạo từ dữ liệu bản ghi (luồng edit): data chỉ gắn 1 lần khi mở form.
    // Key có trong data (kể cả 0/false) được dùng; key còn lại undefined để effect default lấp nốt.
    const [formData, setFormData] = useState(() => {
        if (!schema || !data) return {};
        const init = {};
        Object.keys(schema.properties || {}).forEach(name => {
            if (data[name] !== undefined) init[name] = coerceValue(data[name], schema.properties[name], name);
        });
        return init;
    });
    const [visibleFields, setVisibleFields] = useState([]);
    const [errors, setErrors] = useState({});
    const [openDropdown, setOpenDropdown] = useState(null);
    // Options nạp từ API (runtime): fieldName → [ { value, label, children? } ].
    // Ưu tiên hơn oneOf tĩnh; chỉ field nằm trong json.optionKeys mới được App setLists.
    const [optionLists, setOptionLists] = useState({});

    const idPrefix = uiSchema?.idPrefix || '';
    const prefix = (name) => (idPrefix ? `${idPrefix}-${name}` : name);
    const renderDesc = (desc) => desc ? <div className="ff-desc">{tr(desc)}</div> : null;

    // Ngôn ngữ hiển thị: attribute `lang` của <custom-dynamic-form> (mặc định 'vi').
    // Chuỗi song ngữ lưu trực tiếp trong JSON dạng { vi, en } → chọn theo locale; string giữ nguyên (back-compat).
    const LANG = lang || 'vi';
    const tr = (v) => {
        if (v == null) return v;
        return (typeof v === 'object') ? (v[LANG] || v.vi || Object.values(v)[0] || '') : v;
    };

    // Chuẩn hoá options của dropdown/radio về [ { value, label } ]:
    // 1. Ưu tiên runtime từ API (el.setList / optionLists) — nếu field đã nạp list.
    // 2. Fallback oneOf (tĩnh), cuối cùng là enum cũ.
    // Field "dữ liệu từ API" không có oneOf trong schema → khi chưa nạp list = [] (rỗng),
    // không suy ra from oneOf.
    const fieldOptions = (fieldName, fieldSchema) => {
        if (fieldName && Array.isArray(optionLists[fieldName]) && optionLists[fieldName].length) {
            return optionLists[fieldName];
        }
        if (!fieldSchema) return [];
        if (Array.isArray(fieldSchema.oneOf) && fieldSchema.oneOf.length) {
            return fieldSchema.oneOf.map(o => ({ value: o.const, label: tr(o.title != null && o.title !== '' ? o.title : o.const) }));
        }
        if (Array.isArray(fieldSchema.enum) && fieldSchema.enum.length) {
            const names = Array.isArray(fieldSchema.enumNames) && fieldSchema.enumNames.length === fieldSchema.enum.length ? fieldSchema.enumNames : null;
            return fieldSchema.enum.map((v, i) => ({ value: v, label: names ? String(names[i]) : v }));
        }
        return [];
    };

    // 0. Khởi tạo default value từ schema (vd: radio mặc định, checkbox đã check)
    useEffect(() => {
        if (!schema) return;
        const defaults = {};
        Object.keys(schema.properties || {}).forEach(name => {
            const prop = schema.properties[name];
            if (prop && prop.default !== undefined) defaults[name] = prop.default;
        });
        if (Object.keys(defaults).length) {
            setFormData(prev => {
                const merged = { ...prev };
                Object.keys(defaults).forEach(k => { if (merged[k] === undefined) merged[k] = coerceValue(defaults[k], schema.properties[k], k); });
                return merged;
            });
        }
    }, [schema]);

    // Đóng dropdown khi click ra ngoài vùng .fsel (Shadow DOM cần dùng composedPath)
    useEffect(() => {
        const handler = (e) => {
            const path = e.composedPath ? e.composedPath() : [];
            const inside = path.some(el => el && el.classList && el.classList.contains('fsel'));
            if (!inside) setOpenDropdown(null);
        };
        document.addEventListener('click', handler);
        return () => document.removeEventListener('click', handler);
    }, []);

    // 1. Tự động tính toán các trường cần hiển thị dựa theo Schema (gồm trường gốc + trường thỏa mãn điều kiện if/then)
    useEffect(() => {
        if (!schema) return;

        const baseFields = Object.keys(schema.properties || {});
        const activeFields = new Set(baseFields);

        // Các trường nằm trong nhánh "then": ẩn trước, chỉ hiện khi thỏa mãn điều kiện
        allConditionalFields(schema).forEach(f => activeFields.delete(f));

        // Trường thỏa mãn if/then → hiện lại
        resolveConditionalRules(schema, formData).forEach(rule => {
            rule.requiredFields.forEach(f => activeFields.add(f));
        });

        setVisibleFields(Array.from(activeFields));
    }, [formData, schema]);

    // Tập hợp field bắt buộc (schema.required + nhánh conditional đang kích hoạt) → hiển thị dấu *.
    // Cache bằng useMemo: resolveConditionalRules chỉ phụ thuộc schema + formData.
    const requiredFields = useMemo(() => {
        const req = new Set(schema.required || []);
        resolveConditionalRules(schema, formData).forEach(rule => {
            rule.requiredFields.forEach(f => req.add(f));
        });
        return req;
    }, [schema, formData]);

    const handleFieldChange = (fieldName, value) => {
        // Dùng chung coerceValue (ép số/boolean) để không lệch luật giữa nhập liệu và lúc submit:
        // NaN giữ chuỗi gốc + warn, '' giữ nguyên (không biến thành undefined).
        const prop = schema?.properties?.[fieldName];
        if (prop) value = coerceValue(value, prop, fieldName);
        setFormData(prev => ({ ...prev, [fieldName]: value }));
        setErrors({});
        setOpenDropdown(null);
        if (typeof onFieldChange === 'function') onFieldChange({ name: fieldName, value });
    };

    // Chiều rộng field: grid (thang 12) trong uiSchema.layout → col-span (lưới 2 cột của HTML): 6→1, 12→2
    const fieldGrid = (fieldName) => {
        let grid = GRID_FULL_WIDTH;
        uiSchema?.layout?.forEach(row => {
            const f = row?.fields?.find(x => x && x.name === fieldName);
            if (f && f.grid) grid = f.grid;
        });
        const ui = uiSchema?.fields?.[fieldName];
        if (ui && ui['ui:grid']) grid = ui['ui:grid'];
        return grid;
    };
    const colSpan = (fieldName) => Math.max(MIN_COL_SPAN, Math.round(fieldGrid(fieldName) / GRID_HALF_STEP));

    // 2. Hàm sinh Widget động dựa trên thông số cấu hình của uiSchema và schema
    const widgetClass = (cs, hasError, prefix = 'ff field') => `${prefix} ${cs}${hasError ? ' has-error' : ''}`;

    const renderRadioWidget = ({ fieldName, fieldSchema, fieldUi, opts, title, isRequired, fieldError, cs, fieldId }) => {
        const radioOpts = fieldUi['ui:options'] || {};
        const showRadioLabel = radioOpts.hideLabel !== true;
        const radioLayout = radioOpts.optionsLayout === 'horizontal' ? 'horizontal' : 'vertical';
        // Field con theo từng option: precompute 1 lần (Map giữ so khớp strict giống cũ, tránh duyệt lại rule trong mỗi option)
        const childrenByOption = new Map();
        listConditionalRules(schema).forEach(rule => {
            if (rule.hasIf && rule.triggerField === fieldName) {
                const existing = childrenByOption.get(rule.constValue) || [];
                childrenByOption.set(rule.constValue, existing.concat(rule.requiredFields));
            }
        });
        return (
            <div key={fieldName} className={`f-rows ${cs}${radioLayout === 'horizontal' ? ' radio-h' : ''}${fieldError ? ' has-error' : ''}`}>
                {showRadioLabel && (
                    <label className="form-label" style={{ display: 'block', marginBottom: '5px' }}>
                        {title}{isRequired && <span className="require cdf-text-error"> *</span>}
                    </label>
                )}
                {opts.map(opt => {
                    const isChecked = formData[fieldName] === opt.value;
                    const optionId = `${fieldId}-ck-${opt.value}`;
                    const children = childrenByOption.get(opt.value) || [];
                    // Children luôn được render (không unmount), chỉ ẩn/hiện qua class "open"
                    const open = isChecked && children.length > 0;

                    return (
                        <Fragment key={opt.value}>
                            <div className="row-input btn_collapse">
                                <label htmlFor={optionId} className="flex cursor-pointer items-center">
                                    <input
                                        type="radio"
                                        name={fieldName}
                                        id={optionId}
                                        className="peer sr-only"
                                        checked={isChecked}
                                        onChange={() => handleFieldChange(fieldName, opt.value)}
                                    />
                                    <span className="check-mark"></span>
                                    <span className="text-base cdf-text">{opt.label}</span>
                                </label>
                            </div>
                            <div className={`row-input row_collapse${open ? ' open' : ''}${children.length > 1 ? ' grid grid-cols-2 gap-x-6 gap-y-3' : ''}`}>
                                {children.map(child => renderWidget(child, true))}
                            </div>
                        </Fragment>
                    );
                })}
                {renderDesc(fieldSchema.description)}
            </div>
        );
    };

    const renderCustomSelectWidget = ({ fieldName, fieldSchema, fieldUi, opts, title, isRequired, fieldError, cs }) => {
        const isOpen = openDropdown === fieldName;
        const isDisabled = fieldUi.disabled === true || fieldSchema.readOnly === true;
        const selectedIdx = formData[fieldName] !== undefined ? opts.findIndex(o => o.value === formData[fieldName]) : -1;
        const selectedLabel = selectedIdx >= 0 ? opts[selectedIdx].label : (formData[fieldName] || '');
        return (
            <div className={widgetClass(cs, fieldError, 'fsel ff field')}>
                <div className="relative">
                    <input
                        type="text"
                        className={`input ${fieldName} peer ff-input pr-9${fieldError ? ' is-invalid' : ''}`}
                        placeholder={title}
                        data-id={selectedIdx >= 0 ? selectedIdx + 1 : ''}
                        autoComplete="off"
                        readOnly
                        disabled={isDisabled}
                        value={selectedLabel}
                        onClick={() => { if (!isDisabled) setOpenDropdown(isOpen ? null : fieldName); }}
                    />
                    <label className="text-label ff-label">{title}{isRequired && <span className="require cdf-text-error"> *</span>}</label>
                    <svg className="chev" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" /></svg>
                </div>
                <div className="fdrop" style={{ display: isOpen ? 'block' : 'none' }}>
                    {opts.map((o, i) => (
                        <span
                            key={String(o.value)}
                            className={`item-select fdrop-item${formData[fieldName] === o.value ? ' cdf-active' : ''}`}
                            data-id={i + 1}
                            onClick={() => handleFieldChange(fieldName, o.value)}
                        >{o.label}</span>
                    ))}
                </div>
                {renderDesc(fieldSchema.description)}
            </div>
        );
    };

    const renderSelectWidget = ({ fieldName, fieldSchema, opts, title, isRequired, fieldError, cs }) => {
        return (
            <div className={widgetClass(cs, fieldError)}>
                <label className="form-label" style={{ fontWeight: 'bold', display: 'block', marginBottom: '5px' }}>
                    {title}{isRequired && <span className="require cdf-text-error"> *</span>}
                </label>
                <select
                    className={`my-select-box${fieldError ? ' is-invalid' : ''}`}
                    style={{ width: '100%', padding: '6px' }}
                    value={formData[fieldName] || ''}
                    onChange={(e) => handleFieldChange(fieldName, e.target.value)}
                >
                    <option value="">-- Chọn --</option>
                    {opts.map(o => <option key={String(o.value)} value={o.value}>{o.label}</option>)}
                </select>
                {renderDesc(fieldSchema.description)}
            </div>
        );
    };

    const renderCheckboxWidget = ({ fieldName, fieldSchema, title, isRequired, fieldError, cs, fieldId }) => {
        const isChecked = formData[fieldName] === true;
        return (
            <div className={widgetClass(cs, fieldError)}>
                <label htmlFor={fieldId} className={`flex cursor-pointer items-start`}>
                    <input
                        type="checkbox"
                        id={fieldId}
                        className="peer sr-only"
                        checked={isChecked}
                        onChange={(e) => handleFieldChange(fieldName, e.target.checked)}
                    />
                    <span className="check-mark cdf-checkbox-offset"></span>
                    <span className="text-base cdf-text" dangerouslySetInnerHTML={{ __html: safeHtml(title) }} />
                    {isRequired && <span className="require cdf-text-error"> *</span>}
                </label>
                {renderDesc(fieldSchema.description)}
            </div>
        );
    };

    const renderTimeSliderWidget = ({ fieldName, fieldSchema, title, isRequired, fieldError, cs }) => {
        const maxSec = fieldSchema.maximum && fieldSchema.maximum > 0 ? fieldSchema.maximum : SECONDS_PER_DAY;
        const minSec = fieldSchema.minimum || 0;
        const rawSec = formData[fieldName] ?? fieldSchema.default ?? 0;
        const curSec = isNaN(Number(rawSec)) ? 0 : Math.max(minSec, Math.min(maxSec, Number(rawSec)));
        return (
            <div className={widgetClass(cs, fieldError)}>
                <div className="ff-time">
                    <label className="form-label" style={{ display: 'block', marginBottom: '5px' }}>
                        {title}{isRequired && <span className="require cdf-text-error"> *</span>}
                    </label>
                    <div className="ff-time-row">
                        <input
                            type="range"
                            className={`ff-time-slider${fieldError ? ' is-invalid' : ''}`}
                            min={minSec}
                            max={maxSec}
                            step={SLIDER_STEP_SECONDS}
                            value={curSec}
                            onInput={(e) => handleFieldChange(fieldName, Number(e.target.value))}
                        />
                        <span className="ff-time-value">{secToHm(curSec)}</span>
                    </div>
                    {renderDesc(fieldSchema.description)}
                </div>
            </div>
        );
    };

    const renderTextFieldWidget = ({ fieldName, fieldSchema, title, isRequired, fieldError, cs, fieldId }) => {
        const isDateInput = fieldSchema.format === 'date';
        const isNumericType = fieldSchema.type === 'number' || fieldSchema.type === 'integer';
        const inputType = isNumericType ? 'number'
            : isDateInput ? 'date'
                : fieldSchema.format === 'phone' || fieldSchema.format === 'tel' ? 'tel'
                    : 'text';
        const inputMode = fieldSchema.format === 'email' ? 'email'
            : fieldSchema.format === 'phone' || fieldSchema.format === 'tel' ? 'tel'
                : isNumericType ? 'decimal' : undefined;
        const isPhoneInput = inputType === 'tel';
        return (
            <div className={widgetClass(cs, fieldError)}>
                <div className="relative">
                    <input
                        type={inputType}
                        inputMode={inputMode}
                        step={isNumericType ? 'any' : undefined}
                        min={isDateInput ? fieldSchema.formatMinimum : undefined}
                        max={isDateInput ? fieldSchema.formatMaximum : undefined}
                        id={fieldId}
                        className={`input ${fieldName} peer ff-input${fieldError ? ' is-invalid' : ''}`}
                        placeholder={title}
                        value={formData[fieldName] ?? ''}
                        autoComplete={isPhoneInput ? 'tel' : 'off'}
                        maxLength={isPhoneInput ? PHONE_MAX_LENGTH : undefined}
                        onInput={(e) => {
                            let v = e.target.value;
                            // SĐT: chặn nhập ký tự chữ, chỉ giữ số / + / khoảng trắng / . - ( ), tối đa 13 ký tự
                            if (isPhoneInput) {
                                v = v.replace(/[^0-9+\s.\-()]/g, '').slice(0, PHONE_MAX_LENGTH);
                                if (v !== e.target.value) e.target.value = v;
                            }
                            handleFieldChange(fieldName, v);
                        }}
                    />
                    <label className="text-label ff-label" htmlFor={fieldId}>{title}{isRequired && <span className="require cdf-text-error"> *</span>}</label>
                </div>
                {renderDesc(fieldSchema.description)}
            </div>
        );
    };

    const renderWidget = (fieldName, force = false) => {
        if (!force && !visibleFields.includes(fieldName)) return null;

        const fieldSchema = schema.properties[fieldName];
        if (!fieldSchema) return null;
        const fieldUi = uiSchema?.fields?.[fieldName] || {};
        const widgetType = fieldUi['ui:widget'] || 'text';
        const ctx = {
            fieldName,
            fieldSchema,
            fieldUi,
            opts: fieldOptions(fieldName, fieldSchema),
            title: tr(fieldSchema.title) || fieldName,
            isRequired: requiredFields.has(fieldName),
            fieldError: errors[fieldName],
            cs: `col-span-${colSpan(fieldName)}`,
            fieldId: prefix(fieldName),
        };

        if (widgetType === 'radio' && ctx.opts.length) return renderRadioWidget(ctx);
        // Select/custom-select luôn render (kể cả chưa có options — hiện "-- Chọn --"); avoid rơi xuống text field
        if (widgetType === 'custom-select') return renderCustomSelectWidget(ctx);
        if (widgetType === 'select') return renderSelectWidget(ctx);
        if (widgetType === 'checkbox') return renderCheckboxWidget(ctx);
        if (widgetType === 'time-slider') return renderTimeSliderWidget(ctx);
        return renderTextFieldWidget(ctx);
    };

    // 3. Validation: lỗi required tự tính chính xác từng field; lỗi khác map từ validator về field thật trong schema
    const validateForm = (data) => {
        const fieldErrors = {};

        // 3a. Trường bắt buộc còn trống → map đúng tên field (không phụ thuộc message/format của validator)
        requiredFields.forEach(f => {
            const val = data[f];
            // Checkbox required: giá trị false (đã tích rồi bỏ tích) cũng coi như chưa thoả
            const isBoolean = schema.properties[f]?.type === 'boolean';
            if (val === undefined || val === null || val === '' || (isBoolean && val === false)) {
                const fieldTitle = stripTags(tr(schema.properties[f]?.title) || f);
                fieldErrors[f] = t('error-invalid', { field: `[${fieldTitle}]` });
            }
        });

        // Mỗi hàm validate nhận (prop, val, fieldTitle) → trả về { key, params } nếu lỗi, null nếu hợp lệ.
        const FORMAT_VALIDATORS = {
            email: (prop, val, fieldTitle) => {
                return EMAIL_RE.test(String(val)) ? null : { key: 'error-email', params: { field: `[${fieldTitle}]` } };
            },
            phone: (prop, val, fieldTitle) => {
                return PHONE_RE.test(stripPhone(val)) ? null : { key: 'error-phone', params: { field: `[${fieldTitle}]` } };
            },
            tel: (prop, val, fieldTitle) => FORMAT_VALIDATORS.phone(prop, val, fieldTitle),
            date: (prop, val, fieldTitle) => {
                const ds = String(val);
                if (!DATE_RE.test(ds)) return { key: 'error-date', params: { field: `[${fieldTitle}]` } };
                if ((prop.formatMinimum && ds < prop.formatMinimum) || (prop.formatMaximum && ds > prop.formatMaximum)) {
                    return {
                        key: 'error-date-range',
                        params: { field: `[${fieldTitle}]`, min: prop.formatMinimum || '…', max: prop.formatMaximum || '…' }
                    };
                }
                return null;
            }
        };

        // Validate riêng cho widget time-slider (không phải theo `format`, mà theo `ui:widget`)
        function validateTimeSlider(prop, val, fieldTitle) {
            const secs = Number(val);
            if (isNaN(secs)) return { key: 'error-invalid', params: { field: `[${fieldTitle}]` } };
            if ((prop.minimum !== undefined && secs < prop.minimum) || (prop.maximum !== undefined && secs > prop.maximum)) {
                return {
                    key: 'error-time-range',
                    params: { field: `[${fieldTitle}]`, min: secToHm(prop.minimum || 0), max: prop.maximum ? secToHm(prop.maximum) : DAY_END_LABEL }
                };
            }
            return null;
        }

        Object.keys(schema.properties || {}).forEach(name => {
            if (name in fieldErrors) return;
            const prop = schema.properties[name];
            const val = data[name];
            if (val === undefined || val === null || val === '') return;
            const fieldTitle = stripTags(tr(prop.title) || name);

            const isTimeSlider = prop.type === 'number' && uiSchema?.fields?.[name]?.['ui:widget'] === 'time-slider';
            const result = isTimeSlider
                ? validateTimeSlider(prop, val, fieldTitle)
                : FORMAT_VALIDATORS[prop.format]?.(prop, val, fieldTitle);

            if (result) fieldErrors[name] = t(result.key, result.params);
        });

        // 3b. Lỗi còn lại (type/format/enum...) → chỉ nhận segment khớp với properties thật
        const validator = new Validator(schema);
        const result = validator.validate(data);
        if (!result.valid) {
            const knownFields = new Set(Object.keys(schema.properties || {}));
            result.errors.forEach(err => {
                let fieldName = null;
                const searches = [
                    ...((err.keywordLocation || '').split('/').filter(Boolean)),
                    ...((err.instanceLocation || '').split('/').filter(Boolean)),
                ];
                for (let i = searches.length - 1; i >= 0; i--) {
                    if (knownFields.has(searches[i])) { fieldName = searches[i]; break; }
                }
                if (fieldName && !(fieldName in fieldErrors)) {
                    const fieldTitle = stripTags(tr(schema.properties[fieldName]?.title) || fieldName);
                    fieldErrors[fieldName] = t('error-required', { field: `[${fieldTitle}]` });
                }
            });
        }
        return fieldErrors;
    };

    const handleFormSubmit = (e) => {
        if (e && e.preventDefault) e.preventDefault();
        // Chỉ lấy dữ liệu của các field đang hiển thị: bỏ field thuộc nhánh conditional đã ẩn
        // (vd: đổi radio sang nhánh khác → value cũ của field con không được submit)
        const payload = {};
        visibleFields.forEach(name => {
            if (name in formData) payload[name] = coerceValue(formData[name], schema.properties[name], name);
        });
        const fieldErrors = validateForm(payload);
        if (Object.keys(fieldErrors).length === 0) {
            setErrors({});
            onSubmit(payload);
        } else {
            setErrors(fieldErrors);
            if (typeof onSubmitError === 'function') onSubmitError(fieldErrors);
        }
    };

    // API bên ngoài gọi submit trực tiếp (thay cho nút submit bên trong form)
    if (apiRef) {
        apiRef.submit = () => handleFormSubmit();
        // Gán/reset 1 field từ ngoài (vd: reset xã khi đổi tỉnh) — không remount toàn bộ form.
        apiRef.setValue = (fieldName, value) => {
            const prop = schema?.properties?.[fieldName];
            if (prop) value = coerceValue(value, prop, fieldName);
            setFormData(prev => ({ ...prev, [fieldName]: value }));
            setErrors(prev => {
                if (!(fieldName in prev)) return prev;
                const next = { ...prev };
                delete next[fieldName];
                return next;
            });
        };
    }

    if (optionsRef) {
        optionsRef.setLists = (byField) => {
            setOptionLists(prev => {
                const next = { ...prev };
                Object.keys(byField || {}).forEach(fieldName => {
                    if (byField[fieldName] === undefined) return;
                    next[fieldName] = normalizeOptionListsByKey(byField[fieldName]);
                });
                return next;
            });
        };
    }

    if (!schema || !uiSchema) return <div className="form-loading">{t('loading')}</div>;

    // Fallback layout: nếu uiSchema không khai báo "layout" thì tự sinh theo thứ tự fields
    const layoutRows = Array.isArray(uiSchema.layout) && uiSchema.layout.length
        ? uiSchema.layout
        : [{ type: 'row', fields: Object.keys(schema.properties).map(name => ({ name, grid: GRID_FULL_WIDTH })) }];

    // Field thuộc nhánh conditional (then.required): không render độc lập trong layout lưới
    // (radio render lồng trong khối collapse của từng option, select handle riêng)
    const conditionalFields = allConditionalFields(schema);

    return (
        <form onSubmit={handleFormSubmit} className="mt-3 grid grid-cols-2 gap-x-6 gap-y-3 items-end rounded-lg cdf-surface p-4">

            {/* DUYỆT UI-SCHEMA LAYOUT: nhưng render thẳng vào lưới grid-cols-2 (mỗi field là 1 ô col-span) */}
            {layoutRows.map((row, rowIndex) => (
                <Fragment key={rowIndex}>
                    {row.layoutElement ? (
                        row.layoutElement.type === 'divider'
                            ? <hr className="ff-divider col-span-2" />
                            : row.layoutElement.type === 'heading'
                                ? <h3 className={"ff-heading col-span-2" + (row.layoutElement.fontSize === 'normal' ? ' ff-heading-normal' : '')}>{tr(row.layoutElement.text)}</h3>
                                : <p className="ff-paragraph col-span-2" dangerouslySetInnerHTML={{ __html: safeHtml(tr(row.layoutElement.text)) }} />
                    ) : (row.fields || []).map(field => {
                        const fieldName = field.name;
                        // Bỏ qua nếu trường đang bị ẩn do logic conditional
                        if (!visibleFields.includes(fieldName)) return null;
                        // Trường con đã được lồng tự động bên trong khối radio collapse → skip tránh lặp 2 lần
                        const isChildField = conditionalFields.has(fieldName);
                        if (isChildField) return null;
                        return renderWidget(fieldName);
                    })}
                </Fragment>
            ))}
        </form>
    );
}

class CustomDynamicForm extends HTMLElement {
    constructor() {
        super();
        this._schema = null;
        this._uiSchema = null;
        this._data = null;
        this._dataKey = 0;
        this._api = {};
        this._options = {}; // bridge cho setList/setLists (options nạp từ API)

        // Shadow DOM: cô lập CSS + markup, không ảnh hưởng host page
        this.attachShadow({ mode: 'open' });

        const styleEl = document.createElement('style');
        styleEl.setAttribute('data-custom-dynamic-form', '');
        styleEl.textContent = styles;
        this.shadowRoot.appendChild(styleEl);

        // Tạo div container bên trong shadow root — Preact cần DOM element (không phải DocumentFragment) để render
        this._container = document.createElement('div');
        this.shadowRoot.appendChild(this._container);
    }

    // `lang` là attribute chuẩn của HTMLElement (default '') → đổi ngôn ngữ = set el.lang = 'en'
    static get observedAttributes() { return ['lang']; }

    attributeChangedCallback(name, oldValue, newValue) {
        if (name === 'lang') this.renderComponent();
    }

    set schema(val) { this._schema = val; this.renderComponent(); }
    set uiSchema(val) { this._uiSchema = val; this.renderComponent(); }
    // Dữ liệu bản ghi cho luồng edit: gắn 1 lần khi mở form. Bump `_dataKey` để remount
    // core mới (state formData khởi tạo đúng từ data — không lệ thuộc thứ tự gán schema/data)
    set data(val) { this._data = val; this._dataKey++; this.renderComponent(); }

    submitForm() {
        if (typeof this._api.submit === 'function') this._api.submit();
    }

    setValue(name, value) {
        if (typeof this._api.setValue === 'function') this._api.setValue(name, value);
    }

    setLists(byField) {
        if (typeof this._options.setLists === 'function') this._options.setLists(byField);
    }

    renderComponent() {
        if (this._schema && this._uiSchema) {
            try {
                render(<DynamicFormCore
                    key={this._dataKey}
                    schema={this._schema}
                    uiSchema={this._uiSchema}
                    lang={this.lang}
                    data={this._data}
                    apiRef={this._api}
                    optionsRef={this._options}
                    onSubmit={(data) => this.dispatchEvent(new CustomEvent('onFormSubmit', { detail: data }))}
                    onSubmitError={(errors) => this.dispatchEvent(new CustomEvent('onFormSubmit', { detail: { ok: false, errors } }))}
                    onFieldChange={(payload) => this.dispatchEvent(new CustomEvent('onFieldChange', { detail: payload }))}
                />, this._container);
            } catch (err) {
                console.error('[custom-dynamic-form] render error:', err);
                this._container.innerHTML = '<div style="color:red;padding:16px;font-family:monospace">Render error: ' + (err && err.message ? err.message : err) + '</div>';
            }
        }
    }
}
customElements.define('custom-dynamic-form', CustomDynamicForm);