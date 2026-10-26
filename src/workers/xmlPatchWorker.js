"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.OPS = void 0;
exports.findTagOpen = findTagOpen;
exports.findBlock = findBlock;
exports.aplicarPatch = aplicarPatch;
const fs = require("node:fs");
const path = require("node:path");
'use strict';
// ============================================================
// xmlPatchWorker.js — aplica edições estruturais num arquivo XML de
// tema Blogger a partir de um PATCH JSON compacto, em vez de reescrever
// o arquivo inteiro a cada ajuste. Existe pra baratear o refinamento
// manual de exemplos/*.xml: só o FRAGMENTO que muda entra no patch —
// nunca o arquivo inteiro — e o worker faz a cirurgia no arquivo real
// em disco.
//
// Não é um parser XML genérico (mesma filosofia de
// src/lib/bloggerTemplateTree.js) — localiza blocos <b:widget id='X'>
// e <b:section id='X'> por índice de string, aproveitando uma garantia
// real do formato Blogger: nem b:widget nem b:section aninham dentro
// de si mesmos (widget nunca dentro de widget, section nunca dentro de
// section) — então o primeiro `</TAG>` depois da tag de abertura
// SEMPRE fecha o bloco certo, sem precisar de contagem de profundidade.
//
// Uso (via CLI, patch por stdin — evita problema de escaping de shell
// com XML multilinha em --patch):
//   cat patch.json | node src/workers/xmlPatchWorker.js
//   node src/workers/xmlPatchWorker.js --file=exemplos/x.xml --patch='{"ops":[...]}'
//   ... --dry-run   (valida e mostra o resultado sem escrever no disco)
//
// Formato do patch:
//   { "file": "exemplos/theme-123.xml", "continueOnError": false, "ops": [
//     { "op": "replaceWidget",  "id": "Blog1", "xml": "<b:widget ...>...</b:widget>" },
//     { "op": "replaceSection", "id": "sidebar", "xml": "<b:section ...>...</b:section>" },
//     { "op": "removeWidget",   "id": "HTML5" },
//     { "op": "removeSection",  "id": "sidebar" },
//     { "op": "insertIntoSection", "sectionId": "sidebar", "position": "append|prepend", "xml": "<b:widget ...>" },
//     { "op": "insertRelativeToWidget", "anchorId": "Blog1", "position": "before|after", "xml": "<b:widget ...>" },
//     { "op": "findReplace", "find": "...", "replace": "...", "regex": false,
//       "scopeWidgetId": "Blog1", "scopeSectionId": null, "count": null },
//     { "op": "replaceLines", "start": 10, "end": 20, "xml": "..." }
//   ]}
//
// Cada op reporta sucesso/erro individualmente — um erro não derruba o
// patch inteiro a menos que "continueOnError" seja false (default:
// para no primeiro erro, deixando o arquivo NUNCA escrito parcialmente
// — ou tudo aplica com sucesso, ou nada é gravado).
// ============================================================
function findTagOpen(xml, tag, id, fromIndex = 0) {
    const openRe = new RegExp(`<${tag}\\b`, 'g');
    openRe.lastIndex = fromIndex;
    let m;
    while ((m = openRe.exec(xml))) {
        const tagEnd = xml.indexOf('>', m.index);
        if (tagEnd === -1)
            break;
        const tagText = xml.slice(m.index, tagEnd + 1);
        const idMatch = tagText.match(/\bid=['"]([^'"]+)['"]/);
        if (idMatch && idMatch[1] === id) {
            return { start: m.index, tagEnd, selfClosing: tagText.endsWith('/>') };
        }
        openRe.lastIndex = tagEnd + 1;
    }
    return null;
}
function findBlock(xml, tag, id) {
    const open = findTagOpen(xml, tag, id);
    if (!open)
        return null;
    if (open.selfClosing) {
        return { start: open.start, end: open.tagEnd + 1, bodyStart: open.tagEnd + 1, bodyEnd: open.tagEnd + 1, selfClosing: true };
    }
    const closeTag = `</${tag}>`;
    const closeIdx = xml.indexOf(closeTag, open.tagEnd + 1);
    if (closeIdx === -1)
        return null;
    return { start: open.start, end: closeIdx + closeTag.length, bodyStart: open.tagEnd + 1, bodyEnd: closeIdx, selfClosing: false };
}
function op_replaceWidget(xml, { id, xml: novoXml }) {
    const block = findBlock(xml, 'b:widget', id);
    if (!block)
        throw new Error(`b:widget id='${id}' não encontrado`);
    return xml.slice(0, block.start) + novoXml + xml.slice(block.end);
}
function op_replaceSection(xml, { id, xml: novoXml }) {
    const block = findBlock(xml, 'b:section', id);
    if (!block)
        throw new Error(`b:section id='${id}' não encontrado`);
    return xml.slice(0, block.start) + novoXml + xml.slice(block.end);
}
function op_removeWidget(xml, { id }) {
    const block = findBlock(xml, 'b:widget', id);
    if (!block)
        throw new Error(`b:widget id='${id}' não encontrado`);
    return xml.slice(0, block.start) + xml.slice(block.end);
}
function op_removeSection(xml, { id }) {
    const block = findBlock(xml, 'b:section', id);
    if (!block)
        throw new Error(`b:section id='${id}' não encontrado`);
    return xml.slice(0, block.start) + xml.slice(block.end);
}
function op_insertIntoSection(xml, { sectionId, position = 'append', xml: novoXml }) {
    const block = findBlock(xml, 'b:section', sectionId);
    if (!block)
        throw new Error(`b:section id='${sectionId}' não encontrado`);
    if (block.selfClosing) {
        // <b:section .../> vazia — precisa virar tag aberta/fechada pra caber conteúdo.
        const tagText = xml.slice(block.start, block.end);
        const openTag = tagText.replace(/\s*\/>$/, '>');
        const rebuilt = `${openTag}\n${novoXml}\n</b:section>`;
        return xml.slice(0, block.start) + rebuilt + xml.slice(block.end);
    }
    if (position === 'append')
        return xml.slice(0, block.bodyEnd) + '\n' + novoXml + '\n' + xml.slice(block.bodyEnd);
    if (position === 'prepend')
        return xml.slice(0, block.bodyStart) + '\n' + novoXml + '\n' + xml.slice(block.bodyStart);
    throw new Error(`position inválida: "${position}" (use "append" ou "prepend")`);
}
function op_insertRelativeToWidget(xml, { anchorId, position, xml: novoXml }) {
    const block = findBlock(xml, 'b:widget', anchorId);
    if (!block)
        throw new Error(`b:widget id='${anchorId}' não encontrado`);
    if (position === 'before')
        return xml.slice(0, block.start) + novoXml + '\n' + xml.slice(block.start);
    if (position === 'after')
        return xml.slice(0, block.end) + '\n' + novoXml + xml.slice(block.end);
    throw new Error(`position inválida: "${position}" (use "before" ou "after")`);
}
function op_findReplace(xml, { find, replace, regex = false, flags = 'g', scopeWidgetId, scopeSectionId, count }) {
    let scopeStart = 0, scopeEnd = xml.length;
    if (scopeWidgetId) {
        const block = findBlock(xml, 'b:widget', scopeWidgetId);
        if (!block)
            throw new Error(`b:widget id='${scopeWidgetId}' não encontrado (escopo de findReplace)`);
        scopeStart = block.start;
        scopeEnd = block.end;
    }
    else if (scopeSectionId) {
        const block = findBlock(xml, 'b:section', scopeSectionId);
        if (!block)
            throw new Error(`b:section id='${scopeSectionId}' não encontrado (escopo de findReplace)`);
        scopeStart = block.start;
        scopeEnd = block.end;
    }
    const before = xml.slice(0, scopeStart);
    let scoped = xml.slice(scopeStart, scopeEnd);
    const after = xml.slice(scopeEnd);
    let matches = 0;
    if (regex) {
        const re = new RegExp(find, flags.includes('g') ? flags : flags + 'g');
        scoped = scoped.replace(re, () => { matches++; return replace; });
    }
    else {
        let idx = 0, out = '';
        for (;;) {
            const found = scoped.indexOf(find, idx);
            if (found === -1 || (count && matches >= count)) {
                out += scoped.slice(idx);
                break;
            }
            out += scoped.slice(idx, found) + replace;
            idx = found + find.length;
            matches++;
        }
        scoped = out;
    }
    if (matches === 0) {
        const escopoTxt = scopeWidgetId ? ` dentro de b:widget id='${scopeWidgetId}'` : scopeSectionId ? ` dentro de b:section id='${scopeSectionId}'` : '';
        throw new Error(`findReplace: nenhuma ocorrência de "${find}"${escopoTxt}`);
    }
    return before + scoped + after;
}
function op_replaceLines(xml, { start, end, xml: novoXml }) {
    const lines = xml.split('\n');
    if (start < 1 || end > lines.length || start > end) {
        throw new Error(`replaceLines: intervalo inválido ${start}-${end} (arquivo tem ${lines.length} linhas)`);
    }
    const before = lines.slice(0, start - 1);
    const after = lines.slice(end);
    return [...before, novoXml, ...after].join('\n');
}
exports.OPS = {
    replaceWidget: op_replaceWidget,
    replaceSection: op_replaceSection,
    removeWidget: op_removeWidget,
    removeSection: op_removeSection,
    insertIntoSection: op_insertIntoSection,
    insertRelativeToWidget: op_insertRelativeToWidget,
    findReplace: op_findReplace,
    replaceLines: op_replaceLines,
};
// aplicarPatch — nunca lança; cada op reporta { ok, erro } individualmente.
// continueOnError=false (default): para no primeiro erro (xml resultante é
// só o que foi aplicado ATÉ ali — o caller decide se grava ou não; o CLI
// abaixo só grava se TODAS as ops tiverem sucesso).
function aplicarPatch(xmlOriginal, patch) {
    let xml = xmlOriginal;
    const resultados = [];
    for (const [i, opDef] of (patch.ops || []).entries()) {
        const fn = Object.prototype.hasOwnProperty.call(exports.OPS, opDef.op) && exports.OPS[opDef.op];
        if (!fn) {
            resultados.push({ i, op: opDef.op, ok: false, erro: `operação desconhecida: ${opDef.op}` });
            if (!patch.continueOnError)
                break;
            continue;
        }
        try {
            const antes = xml.length;
            // Dispatch by the discriminant keeps each handler's payload specific.
            switch (opDef.op) {
                case 'replaceWidget':
                    xml = exports.OPS.replaceWidget(xml, opDef);
                    break;
                case 'replaceSection':
                    xml = exports.OPS.replaceSection(xml, opDef);
                    break;
                case 'removeWidget':
                    xml = exports.OPS.removeWidget(xml, opDef);
                    break;
                case 'removeSection':
                    xml = exports.OPS.removeSection(xml, opDef);
                    break;
                case 'insertIntoSection':
                    xml = exports.OPS.insertIntoSection(xml, opDef);
                    break;
                case 'insertRelativeToWidget':
                    xml = exports.OPS.insertRelativeToWidget(xml, opDef);
                    break;
                case 'findReplace':
                    xml = exports.OPS.findReplace(xml, opDef);
                    break;
                case 'replaceLines':
                    xml = exports.OPS.replaceLines(xml, opDef);
                    break;
            }
            resultados.push({ i, op: opDef.op, id: opDef.id || opDef.sectionId || opDef.anchorId || null, ok: true, deltaBytes: xml.length - antes });
        }
        catch (e) {
            resultados.push({ i, op: opDef.op, id: opDef.id || opDef.sectionId || opDef.anchorId || null, ok: false, erro: e.message });
            if (!patch.continueOnError)
                break;
        }
    }
    return { xml, resultados };
}
function main() {
    const args = process.argv.slice(2);
    const getFlag = (name) => { const i = args.findIndex(a => a === `--${name}` || a.startsWith(`--${name}=`)); if (i === -1)
        return null; const eq = args[i].indexOf('='); return eq !== -1 ? args[i].slice(eq + 1) : args[i + 1]; };
    const dryRun = args.includes('--dry-run');
    let patchRaw = getFlag('patch');
    if (!patchRaw && !process.stdin.isTTY)
        patchRaw = fs.readFileSync(0, 'utf8');
    if (!patchRaw) {
        console.error('Uso: cat patch.json | node src/workers/xmlPatchWorker.js [--dry-run]');
        console.error('  ou: node src/workers/xmlPatchWorker.js --patch=\'{"file":"...","ops":[...]}\' [--dry-run]');
        process.exit(1);
    }
    let patch;
    try {
        patch = JSON.parse(patchRaw);
    }
    catch (e) {
        console.error(JSON.stringify({ ok: false, erro: `JSON inválido: ${e.message}` }));
        process.exit(1);
    }
    const filePath = getFlag('file') || patch.file;
    if (!filePath) {
        console.error(JSON.stringify({ ok: false, erro: 'Nenhum "file" informado (nem no JSON nem via --file).' }));
        process.exit(1);
    }
    const absPath = path.resolve(process.cwd(), filePath);
    if (!fs.existsSync(absPath)) {
        console.error(JSON.stringify({ ok: false, erro: `Arquivo não encontrado: ${absPath}` }));
        process.exit(1);
    }
    const original = fs.readFileSync(absPath, 'utf8');
    const { xml: novoXml, resultados } = aplicarPatch(original, patch);
    const sucesso = resultados.length > 0 && resultados.every(r => r.ok);
    if (sucesso && !dryRun)
        fs.writeFileSync(absPath, novoXml, 'utf8');
    console.log(JSON.stringify({
        ok: sucesso,
        arquivo: filePath,
        dryRun,
        escrito: sucesso && !dryRun,
        bytesAntes: original.length,
        bytesDepois: novoXml.length,
        linhasAntes: original.split('\n').length,
        linhasDepois: novoXml.split('\n').length,
        operacoes: resultados,
    }, null, 2));
    process.exit(sucesso ? 0 : 1);
}
if (require.main === module)
    main();
