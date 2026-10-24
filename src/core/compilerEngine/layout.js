"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.gerarLayoutCss = gerarLayoutCss;
exports.resolverLayoutClasses = resolverLayoutClasses;
exports.gerarFooterNewsletter = gerarFooterNewsletter;
/** CSS condicionado às classes do body, sem reestruturar o Chassis Blogger. */
function gerarLayoutCss({ footerStyle, sidebarPosition }) {
    let css = '';
    if (sidebarPosition === 'none') {
        css += `
    body.sl-sidebar-none aside[class*='col-lg-4'] { display:none !important; }
    body.sl-sidebar-none .col-lg-8 { flex:0 0 100% !important; max-width:100% !important; }`;
    }
    else if (sidebarPosition === 'left') {
        css += `
    body.sl-sidebar-left aside[class*='col-lg-4'] { order:-1; }`;
    }
    if (footerStyle === 'simple-copyright') {
        css += `
    body.sl-footer-simple .sl-footer [class*='col-md-4'] { display:none !important; }
    body.sl-footer-simple .sl-footer .sl-footer-divider { display:none !important; }`;
    }
    if (!css)
        return '';
    return '\n    /* === LAYOUT (footer / sidebar escolhidos) === */' + css;
}
/** Resolve o mesmo conjunto e ordem de classes de body do compilador legado. */
function resolverLayoutClasses({ footerStyle, sidebarPosition }) {
    const classes = [];
    if (sidebarPosition === 'none')
        classes.push('sl-sidebar-none');
    else if (sidebarPosition === 'left')
        classes.push('sl-sidebar-left');
    if (footerStyle === 'simple-copyright')
        classes.push('sl-footer-simple');
    else if (footerStyle === 'newsletter-integrated')
        classes.push('sl-footer-newsletter');
    return classes.join(' ');
}
/** HTML Bootstrap 5 estático e void elements XML self-closed para Blogger. */
function gerarFooterNewsletter() {
    return `<div class='sl-footer-newsletter-band py-4 mb-4 border-bottom border-secondary border-opacity-25'>
    <div class='container'>
      <div class='row align-items-center g-3'>
        <div class='col-lg-6'>
          <h4 class='h5 fw-bold mb-1'>Assine a nossa newsletter</h4>
          <p class='small mb-0 opacity-75'>Receba os novos conteúdos diretamente no seu e-mail.</p>
        </div>
        <div class='col-lg-6'>
          <form class='d-flex gap-2' onsubmit='return false;'>
            <input class='form-control' placeholder='O seu melhor e-mail' type='email'/>
            <button class='btn btn-primary' type='submit'>Inscrever</button>
          </form>
        </div>
      </div>
    </div>
  </div>`;
}
