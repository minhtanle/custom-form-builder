import assert from 'assert';
import { safeHtml, stripTags } from '../src/sanitize.js';

let pass = 0;
function t(name, actual, expected) {
    assert.strictEqual(actual, expected, name);
    pass++;
    console.log('  ok -', name);
}

console.log('safeHtml:');
t('keeps plain text', safeHtml('abc xyz'), 'abc xyz');
t('keeps allowed anchor', safeHtml('<a href="https://x.vn" target="_blank" title="X">Điều Khoản</a>'),
    '<a href="https://x.vn" target="_blank" title="X" rel="noopener noreferrer">Điều Khoản</a>');
t('strips class/style', safeHtml('<a class="color-link txt-underline" style="color:red" href="https://x.vn">A</a>'),
    '<a href="https://x.vn">A</a>');
t('drops javascript: href (anchor becomes text)', safeHtml('<a href="javascript:alert(1)">x</a>'), 'x');
t('drops data:/vbscript: href', safeHtml('<a href="data:text/html;base64,abcd">x</a>'), 'x');
t('keeps http/mailto/tel', safeHtml('<a href="http://a.vn">A</a><a href="mailto:a@b.vn">M</a><a href="tel:+84123">T</a>'),
    '<a href="http://a.vn">A</a><a href="mailto:a@b.vn">M</a><a href="tel:+84123">T</a>');
t('keeps relative + anchor + protocol-relative', safeHtml('<a href="/path">P</a><a href="#sec">S</a><a href="//cdn.x">C</a>'),
    '<a href="/path">P</a><a href="#sec">S</a><a href="//cdn.x">C</a>');
t('strips on* handlers', safeHtml('<a href="https://x.vn" onclick="x()" onmouseover="y()">A</a>'),
    '<a href="https://x.vn">A</a>');
t('strips script tag + content kept as text', safeHtml('hi<script>alert(1)</script>'), 'hialert(1)');
t('strips img tag + handler', safeHtml('<img src=x onerror="alert(1)">ok'), 'ok');
t('strips unsafe target values', safeHtml('<a href="https://x.vn" target="foo">A</a>'), '<a href="https://x.vn">A</a>');
t('strips non-whitelisted tags keeping text', safeHtml('<div><b>B</b><i>I</i></div>'), 'BI');
t('does not escape entities in href', safeHtml('<a href="https://x.vn?a=1&amp;b=2">A</a>'), '<a href="https://x.vn?a=1&amp;b=2">A</a>');
t('handles < followed by digit in text', safeHtml('x < 5 is fine'), 'x < 5 is fine');
t('letter <...> parsed as tag and stripped', safeHtml('a < b > c'), 'a  c');
t('closed anchors ok', safeHtml('x</a>y'), 'xy');
t('unclosed tag at end', safeHtml('<a href="https://x.vn">A'), '<a href="https://x.vn">A');
t('null/undefined -> empty', safeHtml(null), '');

console.log('stripTags:');
t('removes tags', stripTags('Điều <a href="#">Khoản</a> &amp; text'), 'Điều Khoản &amp; text');

console.log(`\nALL ${pass} SANITIZE TESTS PASSED`);