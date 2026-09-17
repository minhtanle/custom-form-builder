// Sanitizer whitelist nhỏ gọn: chỉ cho phép thẻ <a> với các thuộc tính an toàn.
// Mọi tag khác bị bỏ wrapper (giữ text). Không bao giờ emit class/style/on*.

const SAFE_PROTO = new Set(['http:', 'https:', 'mailto:', 'tel:']);
const ALLOW_TAGS = {
    a: { attrs: ['href', 'target', 'title', 'rel'] }
};

function safeHref(href) {
    const h = String(href || '').trim();
    if (!h) return '';
    if (h.startsWith('//')) return h;
    if (h.startsWith('/') || h.startsWith('#')) return h;
    if (/^\.{1,2}\//.test(h)) return h;
    const m = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(h);
    if (m && SAFE_PROTO.has((m[1] + ':').toLowerCase())) return h;
    return '';
}

function parseAttrs(src) {
    const attrs = {};
    const re = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
    let m;
    while ((m = re.exec(src))) {
        const name = m[1].toLowerCase();
        let value = '';
        if (m[2] !== undefined) value = m[2];
        else if (m[3] !== undefined) value = m[3];
        else if (m[4] !== undefined) value = m[4];
        attrs[name] = value;
    }
    return attrs;
}

function escapeAttr(str) {
    return String(str).replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function safeHtml(raw) {
    if (raw === null || raw === undefined) return '';
    const src = String(raw);
    let out = '';
    let text = '';
    let i = 0;
    let openA = 0;

    while (i < src.length) {
        const lt = src.indexOf('<', i);
        if (lt === -1) { text += src.slice(i); break; }
        text += src.slice(i, lt);

        // Quét tới dấu '>' biết tôn trọng dấu nháy (attribute có thể chứa '>')
        let j = lt + 1;
        let quote = '';
        while (j < src.length) {
            const ch = src[j];
            if (quote) {
                if (ch === quote) quote = '';
            } else if (ch === '"' || ch === "'") {
                quote = ch;
            } else if (ch === '>') {
                break;
            } else if (ch === '<') {
                break;
            }
            j++;
        }
        const closed = j < src.length;
        const tagText = closed ? src.slice(lt + 1, j) : src.slice(lt + 1);
        const m = /^(\/)?\s*([a-zA-Z][a-zA-Z0-9]*)/.exec(tagText);

        if (!m) {
            // Không phải tag hợp lệ (vd: "a < b") → coi '<' là text
            text += src[lt];
            i = lt + 1;
            continue;
        }

        const isClose = !!m[1];
        const name = m[2].toLowerCase();
        if (isClose) {
            if (ALLOW_TAGS[name]) {
                if (name === 'a' && openA > 0) { openA--; out += text; text = ''; out += '</' + name + '>'; }
            }
            i = closed ? j + 1 : src.length;
            continue;
        }

        const def = ALLOW_TAGS[name];
        if (def) {
            const attrs = parseAttrs(tagText.slice(m[0].length));
            let html = '<' + name;
            let hasHref = false;
            for (const a of def.attrs) {
                const val = attrs[a];
                if (val === undefined) continue;
                if (a === 'href') {
                    const safe = safeHref(val);
                    if (!safe) continue;
                    hasHref = true;
                    html += ' ' + a + '="' + escapeAttr(safe) + '"';
                } else if (a === 'target') {
                    if (!['_blank', '_self', '_parent', '_top'].includes(val)) continue;
                    html += ' ' + a + '="' + escapeAttr(val) + '"';
                } else {
                    html += ' ' + a + '="' + escapeAttr(val) + '"';
                }
            }
            // Anchor không có href hợp lệ → bỏ cả wrapper (open lẫn close), giữ text
            if (!hasHref) { i = closed ? j + 1 : src.length; continue; }
            if (attrs.target === '_blank' && attrs.rel === undefined) html += ' rel="noopener noreferrer"';
            out += text; text = '';
            out += html + '>';
            openA++;
        }
        i = closed ? j + 1 : src.length;
    }

    out += text;
    return out;
}

export function stripTags(html) {
    return String(html || '').replace(/<[^>]*>/g, '');
}