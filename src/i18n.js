/*
 * ============================================================
 * i18n — Văn bản giao diện form (tách khỏi logic, dễ dịch ngôn ngữ)
 * Mỗi key là chuỗi hiển thị; `{name}` là placeholder tham số động.
 * Chọn ngôn ngữ qua `CustomDynamicForm.locale = 'en'` (mặc định 'vi').
 *
 * Xuất:
 *   - i18n      (default): đối tượng đầy đủ { currentLocale, t, setLocale }
 *   - t                 : hàm dịch rút gọn t(key, params?) — dùng cho named import
 *   - currentLocale     : locale hiện tại (string)
 * ============================================================ */

const messages = {
    vi: {
        // --- Widget chung ---
        'loading': 'Đang tải cấu hình...',

        // --- Lỗi / validate (tên field truyền qua {field}) ---
        'error-required': 'Vui lòng kiểm tra lại trường {field}',
        'error-invalid': 'Dữ liệu của trường {field} không hợp lệ',
        'error-email': 'Email của trường {field} không hợp lệ',
        'error-phone': 'Số điện thoại của trường {field} không hợp lệ',
        'error-date': 'Ngày của trường {field} không hợp lệ (định dạng YYYY-MM-DD)',
        'error-date-range': 'Ngày của trường {field} phải trong khoảng {min} – {max}',
        'error-time-range': 'Thời gian của trường {field} phải trong khoảng {min} – {max}',
    },
    en: {
        'loading': 'Loading configuration...',

        'error-required': 'Please check field {field}',
        'error-invalid': 'Data of field {field} is invalid',
        'error-email': 'Email of field {field} is invalid',
        'error-phone': 'Phone number of field {field} is invalid',
        'error-date': 'Date of field {field} is invalid (format YYYY-MM-DD)',
        'error-date-range': 'Date of field {field} must be between {min} and {max}',
        'error-time-range': 'Time of field {field} must be between {min} and {max}',
    },
};

let currentLocale = 'vi';

// Lấy chuỗi theo locale + key, thay placeholder {param}
function t(key, params = {}) {
    const locale = currentLocale in messages ? currentLocale : 'vi';
    let str = (messages[locale] && messages[locale][key]) || (messages.vi && messages.vi[key]) || key;
    Object.entries(params).forEach(([k, v]) => {
        str = str.replaceAll(`{${k}}`, v);
    });
    return str;
}

function setLocale(locale) {
    if (locale in messages) currentLocale = locale;
    return currentLocale;
}

const i18n = { messages, currentLocale, t, setLocale };

export default i18n;
export { t, currentLocale, setLocale };
