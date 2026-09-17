import { h, render, Fragment } from 'preact';
import { useState, useEffect } from 'preact/hooks';
import { Validator } from '@cfworker/json-schema';
import styles from './styles.css?inline';
import { t } from './i18n.js';
import { safeHtml, stripTags } from './sanitize.js';

// Regex chặt hơn format mặc định của validator (@cfworker/json-schema nhận cả "aa@aa")
const EMAIL_RE = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;
// SĐT Việt Nam: đầu 0 hoặc +84/84, sau khi bỏ khoảng trắng/dấu chấm/gạch/ngoặc
const PHONE_RE = /^(?:\+?84|0)[1-9]\d{8,9}$/;
const stripPhone = (s) => String(s).replace(/[\s.\-()]/g, '');

function DynamicFormCore({ schema, uiSchema, onSubmit, apiRef }) {
    const [formData, setFormData] = useState({});
    const [visibleFields, setVisibleFields] = useState([]);
    const [errors, setErrors] = useState({});
    const [openDropdown, setOpenDropdown] = useState(null); // Quản lý đóng mở dropdown theo tên trường

    const idPrefix = uiSchema?.idPrefix || '';
    const prefix = (name) => (idPrefix ? `${idPrefix}-${name}` : name);
    const renderDesc = (desc) => desc ? <div className="ff-desc">{desc}</div> : null;

    // Chuẩn hoá options của dropdown/radio về [ { value, label } ]: ưu tiên oneOf, fallback enum cũ
    const fieldOptions = (fieldSchema) => {
        if (!fieldSchema) return [];
        if (Array.isArray(fieldSchema.oneOf) && fieldSchema.oneOf.length) {
            return fieldSchema.oneOf.map(o => ({ value: o.const, label: o.title != null && o.title !== '' ? o.title : o.const }));
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
                Object.keys(defaults).forEach(k => { if (merged[k] === undefined) merged[k] = defaults[k]; });
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
        const conditionalFields = new Set();
        if (schema.allOf) {
            schema.allOf.forEach(rule => {
                if (rule.then && rule.then.required) {
                    rule.then.required.forEach(f => conditionalFields.add(f));
                }
            });
        }
        conditionalFields.forEach(f => activeFields.delete(f));

        // Kiểm tra dữ liệu hiện tại có kích hoạt if/then không
        if (schema.allOf) {
            schema.allOf.forEach(rule => {
                if (rule.if && rule.if.properties) {
                    const triggerField = Object.keys(rule.if.properties)[0];
                    const expectedValue = rule.if.properties[triggerField].const;
                    if (formData[triggerField] === expectedValue && rule.then && rule.then.required) {
                        rule.then.required.forEach(f => activeFields.add(f));
                    }
                }
            });
        }

        setVisibleFields(Array.from(activeFields));
    }, [formData, schema]);

    // Tập hợp field bắt buộc (schema.required + nhánh conditional đang kích hoạt) → hiển thị dấu *
    const getRequiredFields = () => {
        const req = new Set(schema.required || []);
        if (schema.allOf) {
            schema.allOf.forEach(rule => {
                if (rule.if && rule.if.properties && rule.then && rule.then.required) {
                    const triggerField = Object.keys(rule.if.properties)[0];
                    const expectedValue = rule.if.properties[triggerField].const;
                    if (formData[triggerField] === expectedValue) {
                        rule.then.required.forEach(f => req.add(f));
                    }
                }
            });
        }
        return req;
    };

    const handleFieldChange = (fieldName, value) => {
        const prop = schema?.properties?.[fieldName];
        if (prop?.type === 'number') {
            if (value === '') value = undefined;
            else {
                value = Number(value);
                if (Number.isNaN(value)) value = undefined;
            }
        }
        setFormData(prev => ({ ...prev, [fieldName]: value }));
        setErrors({});
        setOpenDropdown(null);
    };

    // Chiều rộng field: grid (thang 12) trong uiSchema.layout → col-span (lưới 2 cột của HTML): 6→1, 12→2
    const fieldGrid = (fieldName) => {
        let grid = 12;
        uiSchema?.layout?.forEach(row => {
            const f = row?.fields?.find(x => x && x.name === fieldName);
            if (f && f.grid) grid = f.grid;
        });
        const ui = uiSchema?.fields?.[fieldName];
        if (ui && ui['ui:grid']) grid = ui['ui:grid'];
        return grid;
    };
    const colSpan = (fieldName) => Math.max(1, Math.round(fieldGrid(fieldName) / 6));

    // 2. Hàm sinh Widget động dựa trên thông số cấu hình của uiSchema và schema
    const renderWidget = (fieldName, force = false) => {
        if (!force && !visibleFields.includes(fieldName)) return null;

        const fieldSchema = schema.properties[fieldName];
        if (!fieldSchema) return null;
        const fieldUi = uiSchema?.fields?.[fieldName] || {};
        const widgetType = fieldUi['ui:widget'] || 'text';
        const opts = fieldOptions(fieldSchema);
        const title = fieldSchema.title || fieldName;
        const isRequired = getRequiredFields().has(fieldName);
        const fieldError = errors[fieldName];
        const cs = `col-span-${colSpan(fieldName)}`;
        const fieldId = prefix(fieldName);

        // WIDGET DẠNG RADIO COLLAPSE: 1 group duy nhất, mọi option + children cùng cấp
        if (widgetType === 'radio' && fieldSchema.oneOf) {
            return (
                <div key={fieldName} className={`f-rows ${cs}`}>
                    {fieldSchema.oneOf.map(opt => {
                        const isChecked = formData[fieldName] === opt.const;
                        const optionId = `${fieldId}-ck-${opt.const}`;
                        const children = [];
                        if (schema.allOf) {
                            schema.allOf.forEach(rule => {
                                if (rule.if && rule.if.properties?.[fieldName]?.const === opt.const && rule.then?.required) {
                                    rule.then.required.forEach(f => children.push(f));
                                }
                            });
                        }
                        // Children luôn được render (không unmount), chỉ ẩn/hiện qua class "open"
                        const open = isChecked && children.length > 0;

                        return (
                            <Fragment key={opt.const}>
                                <div className="row-input btn_collapse">
                                    <label htmlFor={optionId} className="flex cursor-pointer items-center">
                                        <input
                                            type="radio"
                                            name={fieldName}
                                            id={optionId}
                                            className="peer sr-only"
                                            checked={isChecked}
                                            onChange={() => handleFieldChange(fieldName, opt.const)}
                                        />
                                        <span className="check-mark"></span>
                                        <span className="text-base cdf-text">{opt.title}</span>
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
        }

        // WIDGET DẠNG DROPDOWN CUSTOM (F-SEL: input readonly + chevron + panel fdrop)
        if (widgetType === 'custom-select' && opts.length) {
            const isOpen = openDropdown === fieldName;
            const isDisabled = fieldUi.disabled === true || fieldSchema.readOnly === true;
            const selectedIdx = formData[fieldName] !== undefined ? opts.findIndex(o => o.value === formData[fieldName]) : -1;
            const selectedLabel = selectedIdx >= 0 ? opts[selectedIdx].label : (formData[fieldName] || '');
            return (
                <div className={`fsel ff field ${cs}${fieldError ? ' has-error' : ''}`}>
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
        }

        // WIDGET DẠNG SELECT THUẦN (Thẻ HTML select - fallback)
        if (widgetType === 'select' && opts.length) {
            return (
                <div className={`ff field ${cs}${fieldError ? ' has-error' : ''}`}>
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
        }

        // WIDGET DẠNG CHECKBOX
        if (widgetType === 'checkbox') {
            const isChecked = formData[fieldName] === true;
            return (
                <div className={`ff field ${cs}${fieldError ? ' has-error' : ''}`}>
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
        }

        // WIDGET DẠNG TEXT INPUT MẶC ĐỊNH (float-label ff-input)
        const inputType = fieldSchema.type === 'number' ? 'number'
            : fieldSchema.format === 'phone' || fieldSchema.format === 'tel' ? 'tel'
            : 'text';
        const inputMode = fieldSchema.format === 'email' ? 'email'
            : fieldSchema.format === 'phone' || fieldSchema.format === 'tel' ? 'tel'
            : fieldSchema.type === 'number' ? 'decimal' : undefined;
        const isPhoneInput = inputType === 'tel';
        return (
            <div className={`ff field ${cs}${fieldError ? ' has-error' : ''}`}>
                <div className="relative">
                    <input
                        type={inputType}
                        inputMode={inputMode}
                        step={fieldSchema.type === 'number' ? 'any' : undefined}
                        id={fieldId}
                        className={`input ${fieldName} peer ff-input${fieldError ? ' is-invalid' : ''}`}
                        placeholder={title}
                        value={formData[fieldName] ?? ''}
                        autoComplete={isPhoneInput ? 'tel' : 'off'}
                        maxLength={isPhoneInput ? 13 : undefined}
                        onInput={(e) => {
                            let v = e.target.value;
                            // SĐT: chặn nhập ký tự chữ, chỉ giữ số / + / khoảng trắng / . - ( ), tối đa 13 ký tự
                            if (isPhoneInput) {
                                v = v.replace(/[^0-9+\s.\-()]/g, '').slice(0, 13);
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

    // 3. Validation: lỗi required tự tính chính xác từng field; lỗi khác map từ validator về field thật trong schema
    const validateForm = (data) => {
        const fieldErrors = {};

        // 3a. Trường bắt buộc còn trống → map đúng tên field (không phụ thuộc message/format của validator)
        getRequiredFields().forEach(f => {
            const val = data[f];
            // Checkbox required: giá trị false (đã tích rồi bỏ tích) cũng coi như chưa thoả
            const isBoolean = schema.properties[f]?.type === 'boolean';
            if (val === undefined || val === null || val === '' || (isBoolean && val === false)) {
                const fieldTitle = stripTags(schema.properties[f]?.title || f);
                fieldErrors[f] = t('error-invalid', { field: `[${fieldTitle}]` });
            }
        });

        // 3a-2. Format email / phone bằng regex chặt hơn format mặc định của validator
        Object.keys(schema.properties || {}).forEach(name => {
            if (name in fieldErrors) return;
            const prop = schema.properties[name];
            const val = data[name];
            if (val === undefined || val === null || val === '') return;
            const fieldTitle = stripTags(prop.title || name);
            if (prop.format === 'email' && !EMAIL_RE.test(String(val))) {
                fieldErrors[name] = t('error-email', { field: `[${fieldTitle}]` });
            } else if ((prop.format === 'phone' || prop.format === 'tel') && !PHONE_RE.test(stripPhone(val))) {
                fieldErrors[name] = t('error-phone', { field: `[${fieldTitle}]` });
            }
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
                    const fieldTitle = stripTags(schema.properties[fieldName]?.title || fieldName);
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
            if (name in formData) payload[name] = formData[name];
        });
        const fieldErrors = validateForm(payload);
        if (Object.keys(fieldErrors).length === 0) {
            setErrors({});
            onSubmit(payload);
        } else {
            setErrors(fieldErrors);
        }
    };

    // API bên ngoài gọi submit trực tiếp (thay cho nút submit bên trong form)
    if (apiRef) apiRef.submit = () => handleFormSubmit();

    if (!schema || !uiSchema) return <div className="form-loading">{t('loading')}</div>;

    // Fallback layout: nếu uiSchema không khai báo "layout" thì tự sinh theo thứ tự fields
    const layoutRows = Array.isArray(uiSchema.layout) && uiSchema.layout.length
        ? uiSchema.layout
        : [{ type: 'row', fields: Object.keys(schema.properties).map(name => ({ name, grid: 12 })) }];

    return (
        <form onSubmit={handleFormSubmit} className="mt-3 grid grid-cols-2 gap-x-6 gap-y-3 items-end rounded-lg cdf-surface p-4">
            {schema.description && <div className="col-span-2 mb-3 color-secondary">{schema.description}</div>}

            {/* DUYỆT UI-SCHEMA LAYOUT: nhưng render thẳng vào lưới grid-cols-2 (mỗi field là 1 ô col-span) */}
            {layoutRows.map((row, rowIndex) => (
                <Fragment key={rowIndex}>
                    {row.layoutElement ? (
                        row.layoutElement.type === 'divider'
                            ? <hr className="ff-divider col-span-2" />
                            : <p className="ff-paragraph col-span-2" dangerouslySetInnerHTML={{ __html: safeHtml(row.layoutElement.text) }} />
                    ) : (row.fields || []).map(field => {
                        const fieldName = field.name;
                        // Bỏ qua nếu trường đang bị ẩn do logic conditional
                        if (!visibleFields.includes(fieldName)) return null;
                        // Trường con đã được lồng tự động bên trong khối radio collapse → skip tránh lặp 2 lần
                        const isChildField = schema.allOf?.some(rule => rule.then?.required?.includes(fieldName));
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
        this._api = {};

        // Shadow DOM: cô lập CSS + markup, không ảnh hưởng host page
        this.attachShadow({ mode: 'open' });

        // Inject CSS built-in vào shadow root
        const styleEl = document.createElement('style');
        styleEl.setAttribute('data-custom-dynamic-form', '');
        styleEl.textContent = styles;
        this.shadowRoot.appendChild(styleEl);

        // Tạo div container bên trong shadow root — Preact cần DOM element (không phải DocumentFragment) để render
        this._container = document.createElement('div');
        this.shadowRoot.appendChild(this._container);
    }

    set schema(val) { this._schema = val; this.renderComponent(); }
    set uiSchema(val) { this._uiSchema = val; this.renderComponent(); }

    // Phương thức public: gọi từ ngoài để submit form (validation + emit onFormSubmit)
    submitForm() {
        if (typeof this._api.submit === 'function') this._api.submit();
    }

    renderComponent() {
        if (this._schema && this._uiSchema) {
            try {
                render(<DynamicFormCore schema={this._schema} uiSchema={this._uiSchema} apiRef={this._api} onSubmit={(data) => this.dispatchEvent(new CustomEvent('onFormSubmit', { detail: data }))} />, this._container);
            } catch (err) {
                console.error('[custom-dynamic-form] render error:', err);
                this._container.innerHTML = '<div style="color:red;padding:16px;font-family:monospace">Render error: ' + (err && err.message ? err.message : err) + '</div>';
            }
        }
    }
}
customElements.define('custom-dynamic-form', CustomDynamicForm);