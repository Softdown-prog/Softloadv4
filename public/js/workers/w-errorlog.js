'use strict';
(function () {
    var _ = window._w;
    var _busy = false;
    var _logs = [];
    var _filter = null;
    var AI_SOURCES = ['GEMINI', 'CHAT-IA', 'BLOGGER-AI'];
    function isAiSource(src) {
        return AI_SOURCES.some(function (s) { return src.indexOf(s) !== -1; });
    }
    function levelCls(lvl) {
        if (lvl === 'error')
            return 'el-level-error';
        if (lvl === 'warn')
            return 'el-level-warn';
        if (lvl === 'uncaughtException' || lvl === 'unhandledRejection')
            return 'el-level-uncaught';
        return 'el-level-other';
    }
    function renderElEntries() {
        var entriesEl = _.el('errorLogEntries');
        if (!entriesEl)
            return;
        var all = _logs.slice().reverse();
        var logs = _filter
            ? all.filter(function (e) { return e.source === _filter; }).slice(0, 100)
            : all.slice(0, 100);
        var filtroInfo = _filter ? ' · [' + _filter + ']' : '';
        _.setText('elEntriesCount', '(' + logs.length + ' de ' + _logs.length + ')' + filtroInfo);
        if (!logs.length) {
            entriesEl.innerHTML = _filter
                ? '<span style="color:#94a3b8">Nenhuma entrada de [' + _.esc(_filter) + '] nas últimas 24h</span>'
                : '<span style="color:#4ade80">✓ Nenhum erro nas últimas 24h</span>';
            return;
        }
        entriesEl.innerHTML = logs.map(function (e) {
            var stackHtml = e.stack ? '<div class="el-stack">' + _.esc(e.stack).substring(0, 400) + '</div>' : '';
            var time = e.ts ? e.ts.replace('T', ' ').substring(0, 19) : '';
            var shortLevel = e.level.replace('uncaughtException', 'uncaught').replace('unhandledRejection', 'rejection');
            return '<div class="el-line">' +
                '<span class="el-level ' + levelCls(e.level) + '">' + _.esc(shortLevel) + '</span>' +
                '<span class="el-source">[' + _.esc(e.source) + ']</span>' +
                '<div style="flex:1;min-width:0"><div class="d-flex justify-content-between gap-2">' +
                '<span class="el-msg">' + _.esc(e.message) + '</span>' +
                '<span class="el-ts">' + _.esc(time) + '</span>' +
                '</div>' + stackHtml + '</div></div>';
        }).join('');
        entriesEl.scrollTop = 0;
    }
    async function loadErrorLog() {
        if (_busy)
            return;
        _busy = true;
        var entriesEl = _.el('errorLogEntries');
        if (entriesEl)
            entriesEl.innerHTML = '<span style="color:var(--sl-text-500)">Carregando...</span>';
        try {
            var res = await fetch('/workers/api/errors');
            if (!res.ok)
                throw new Error('HTTP ' + res.status);
            var data = await res.json();
            _logs = data.logs || [];
            var stats = data.stats || {};
            _.setText('elTotal', stats.total || 0);
            _.setText('elErrors', (stats.byLevel && stats.byLevel.error) || 0);
            _.setText('elWarns', (stats.byLevel && stats.byLevel.warn) || 0);
            _.setText('elUncaught', stats.byLevel
                ? ((stats.byLevel.uncaughtException || 0) + (stats.byLevel.unhandledRejection || 0))
                : 0);
            var badge = _.el('errorLogBadge');
            if (badge) {
                var tot = stats.total || 0;
                if (tot === 0) {
                    badge.style.display = 'none';
                }
                else {
                    badge.style.display = '';
                    badge.textContent = tot + ' entrada' + (tot !== 1 ? 's' : '');
                    badge.className = tot > 50 ? 'status-badge status-critical'
                        : tot > 10 ? 'status-badge status-warning' : 'status-badge status-healthy';
                }
            }
            var sourcesWrap = _.el('errorLogSources');
            var sourceList = _.el('errorLogSourceList');
            if (sourcesWrap && sourceList) {
                if (stats.bySource && Object.keys(stats.bySource).length) {
                    sourcesWrap.style.display = '';
                    var sorted = Object.entries(stats.bySource)
                        .sort(function (a, b) { return b[1] - a[1]; })
                        .slice(0, 10);
                    sourceList.innerHTML = sorted.map(function (s) {
                        var aiCls = isAiSource(s[0]) ? ' source-chip--ai' : '';
                        var actCls = _filter === s[0] ? ' active' : '';
                        return '<button class="source-chip' + aiCls + actCls + '" ' +
                            'onclick="elToggleFilter(' + JSON.stringify(s[0]) + ')" ' +
                            'title="Clique para filtrar · clique novamente para limpar">' +
                            _.esc(s[0]) + ' <strong>' + s[1] + '</strong></button>';
                    }).join('');
                }
                else {
                    sourcesWrap.style.display = 'none';
                }
            }
            renderElEntries();
        }
        catch (err) {
            if (entriesEl)
                entriesEl.innerHTML = '<span style="color:#f87171">Erro ao carregar: ' + _.esc(err.message) + '</span>';
        }
        finally {
            _busy = false;
        }
    }
    window.loadErrorLog = loadErrorLog;
    window.elToggleFilter = function (src) {
        _filter = (_filter === src) ? null : src;
        document.querySelectorAll('.source-chip').forEach(function (btn) {
            var btnSrc = btn.textContent.trim().split(' ')[0];
            btn.classList.toggle('active', _filter !== null && btnSrc === _filter);
        });
        renderElEntries();
    };
    window.downloadErrorLog = function (format) {
        var url = '/workers/api/errors/download?format=' + encodeURIComponent(format || 'zip');
        var a = document.createElement('a');
        a.href = url;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
    };
}());
