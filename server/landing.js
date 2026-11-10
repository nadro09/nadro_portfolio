'use strict';

// Advertising landing pages are authored by the admin (raw HTML/CSS/JS).
// A page may be a complete document; when it is only a fragment it is wrapped
// in an AUDIOLEF branded shell so the logo and brand colours are always there.

const LOGO_FALLBACK = '/assets/audiolef-logo.png';

// Tokens the admin can use inside the page code.
function applyTokens(html, { logo }) {
  const year = String(new Date().getFullYear());
  return String(html || '')
    .replace(/\{\{\s*logo\s*\}\}/gi, logo)
    .replace(/\{\{\s*booking\s*\}\}/gi, '/booking')
    .replace(/\{\{\s*home\s*\}\}/gi, '/')
    .replace(/\{\{\s*year\s*\}\}/gi, year);
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function isFullDocument(html) {
  return /<html[\s>]/i.test(String(html || ''));
}

function renderLandingPage(page, { logo, brand }) {
  const logoUrl = logo || LOGO_FALLBACK;
  const html = applyTokens(page.html, { logo: logoUrl });
  if (isFullDocument(html)) return html;

  const title = escapeHtml(page.title_ar || page.title_fr || 'AUDIOLEF');
  const primary = (brand && brand.primary) || '#054937';
  const secondary = (brand && brand.secondary) || '#16a34a';
  const ink = (brand && brand.ink) || '#1f2937';
  const logoMark = `<img src="${logoUrl}" alt="AUDIOLEF">`;

  return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title} — AUDIOLEF</title>
<link rel="icon" href="/assets/favicon.svg" type="image/svg+xml">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;800&display=swap" rel="stylesheet">
<style>
  :root { --brand:${primary}; --brand-2:${secondary}; --ink:${ink}; }
  * { box-sizing: border-box; }
  body { margin:0; font-family:'Cairo','Tajawal',system-ui,-apple-system,sans-serif; color:var(--ink); line-height:1.75; background:#fff; }
  a { color:var(--brand); }
  img { max-width:100%; }
  .lp-bar { padding:14px 20px; border-bottom:1px solid #e2ece7; background:#fff; }
  .lp-bar a { display:inline-flex; }
  .lp-bar img { height:44px; width:auto; display:block; }
  .lp-main { max-width:960px; margin:0 auto; padding:28px 20px 48px; }
  .lp-foot { border-top:1px solid #e2ece7; padding:20px; text-align:center; font-size:.82rem; color:#546e7a; }
  .lp-foot strong { color:var(--brand); letter-spacing:.12em; }
</style>
</head>
<body>
<header class="lp-bar"><a href="/">${logoMark}</a></header>
<main class="lp-main">
${html}
</main>
<footer class="lp-foot"><strong>AUDIOLEF</strong> — سمع أفضل .. لحياة أفضل · ${new Date().getFullYear()}</footer>
</body>
</html>`;
}

// Starter content offered when the admin creates a new page. The buttons use
// the same tokens so the booking link stays valid on any deployment.
const STARTER_HTML = `<section style="text-align:center;padding:24px 0 8px">
  <h1 style="font-size:2rem;margin:0 0 12px;color:#054937">اسمع الحياة بوضوح</h1>
  <p style="font-size:1.05rem;color:#40514c;max-width:620px;margin:0 auto 24px">
    فحص سمع متخصص وأجهزة سمعية مناسبة لاحتياجاتك، مع مرافقة كاملة في أقرب مركز AUDIOLEF.
  </p>
  <a href="{{booking}}" style="display:inline-block;background:#054937;color:#fff;text-decoration:none;font-weight:700;padding:14px 26px;border-radius:12px">
    احجز فحص السمع
  </a>
</section>`;

module.exports = { renderLandingPage, applyTokens, STARTER_HTML, LOGO_FALLBACK };
