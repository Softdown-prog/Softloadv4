"use strict";
'use strict';
// ══════════════════════════════════════════════════════════════
// W-SENTINEL — Sentinel health check, métricas, gráficos e
//              painel de memória do Workers dashboard.
//
// Requisições com deduplicação: se workerRefresh() for chamado
// enquanto outra request já está em voo, a nova chamada é ignorada.
// Isso evita empilhamento de requests ao clicar "Atualizar" rápido
// ou quando o setInterval dispara antes do anterior terminar.
// ══════════════════════════════════════════════════════════════
(function () {
    var _ = window._w; // utilitários compartilhados
    var charts = {};
    var _busySentinel = false; // flag de deduplicação
    var _busyHistory = false;
    // ── HELPERS DE FEEDBACK VISUAL ───────────────────────────
    function setBusy(busy) {
        var btn = _.el('btnAtualizar');
        var icon = _.el('iconAtualizar');
        var btn2 = _.el('btnAnalisar');
        if (btn)
            btn.disabled = busy;
        if (btn2)
            btn2.disabled = busy;
        if (icon) {
            if (busy)
                icon.style.animation = 'spin .7s linear infinite';
            else
                icon.style.animation = '';
        }
    }
    // ── SENTINEL STATUS ──────────────────────────────────────
    async function workerRefresh() {
        if (_busySentinel)
            return;
        _busySentinel = true;
        setBusy(true);
        try {
            var res = await fetch('/workers/api/status');
            if (!res.ok)
                throw new Error('HTTP ' + res.status);
            renderStatus(await res.json());
        }
        catch (e) {
            var grid = _.el('testsGrid');
            if (grid)
                grid.innerHTML =
                    '<p class="mb-0 text-center text-danger" style="grid-column:1/-1;font-size:.8rem">Erro ao carregar status</p>';
        }
        finally {
            _busySentinel = false;
            setBusy(false);
        }
    }
    function renderStatus(data) {
        var score = data.healthScore !== undefined ? data.healthScore : 0;
        _.setText('healthScore', data.healthScore !== undefined ? data.healthScore : '—');
        var bar = _.el('healthScoreBar');
        if (bar) {
            bar.style.width = score + '%';
            bar.style.background = score >= 90 ? '#22c55e' : score >= 70 ? '#a855f7' : score >= 50 ? '#eab308' : '#ef4444';
        }
        var badge = _.el('healthStatus');
        if (badge) {
            if (score >= 90) {
                badge.textContent = 'Saudável';
                badge.className = 'status-badge status-healthy';
            }
            else if (score >= 70) {
                badge.textContent = 'Aviso';
                badge.className = 'status-badge status-warning';
            }
            else {
                badge.textContent = 'Crítico';
                badge.className = 'status-badge status-critical';
            }
        }
        if (data.uptime !== undefined)
            _.setText('uptimeScore', data.uptime);
        if (data.trend) {
            var tMap = {
                melhorando: { l: '↑ Melhorando', c: 'trend-melhorando' },
                degradando: { l: '↓ Degradando', c: 'trend-degradando' },
                estavel: { l: '→ Estável', c: 'trend-estavel' }
            };
            var t = tMap[data.trend] || tMap.estavel;
            var tc = _.el('trendChip');
            if (tc) {
                tc.textContent = t.l;
                tc.className = 'trend-chip ' + t.c;
            }
        }
        if (data.lastCheck) {
            _.setText('lastTestTime', new Date(data.lastCheck).toLocaleTimeString('pt-BR', {
                hour: '2-digit', minute: '2-digit', second: '2-digit'
            }));
        }
        var mem = data.tests && data.tests['Memory Usage'];
        if (mem && mem.usagePercent !== undefined) {
            _.setText('heapUsage', mem.usagePercent);
            var hb = _.el('heapBar');
            if (hb) {
                hb.style.width = mem.usagePercent + '%';
                hb.style.background = mem.usagePercent >= 90 ? '#ef4444' : mem.usagePercent >= 75 ? '#eab308' : '#a855f7';
            }
            if (mem.heapUsedMb !== undefined) {
                _.setText('memHeapUsed', mem.heapUsedMb);
                _.setText('memHeapTotal', mem.heapLimitMb || mem.heapTotalMb || '—');
                _.setText('memRss', mem.rssMb || '—');
                _.setText('memExternal', mem.externalMb !== undefined ? mem.externalMb : '—');
                var mhb = _.el('memHeapBar');
                if (mhb) {
                    mhb.style.width = mem.usagePercent + '%';
                    mhb.style.background = mem.usagePercent >= 90 ? '#ef4444' : mem.usagePercent >= 75 ? '#eab308' : '#a855f7';
                }
                var alertBadge = _.el('memAlertBadge');
                if (alertBadge) {
                    if (mem.usagePercent >= 80) {
                        alertBadge.style.display = '';
                        alertBadge.textContent = mem.usagePercent >= 95 ? 'Crítico' : 'Atenção';
                        alertBadge.className = mem.usagePercent >= 95 ? 'status-badge status-critical' : 'status-badge status-warning';
                    }
                    else {
                        alertBadge.style.display = 'none';
                    }
                }
            }
        }
        if (data.avgResponseTime !== undefined)
            _.setText('avgResponseTime', Math.round(data.avgResponseTime));
        renderTests(data.tests, data.consecutiveFailures || {});
        renderRecs(data.recommendations || []);
        renderAnomalies(data.anomalies || []);
        updateStatusChart(data.tests);
    }
    function renderTests(tests, consec) {
        var grid = _.el('testsGrid');
        if (!grid)
            return;
        if (!tests || !Object.keys(tests).length) {
            grid.innerHTML = '<p class="mb-0 text-center" style="color:var(--sl-text-500);font-size:.8rem;grid-column:1/-1">Nenhum teste</p>';
            return;
        }
        var pass = 0;
        grid.innerHTML = Object.entries(tests).map(function (e) {
            var name = e[0], r = e[1];
            if (r.status === 'PASS')
                pass++;
            var icon = r.status === 'PASS' ? '✅' : r.status === 'WARN' ? '⚠️' : '❌';
            var color = r.status === 'PASS' ? '#22c55e' : r.status === 'WARN' ? '#eab308' : '#ef4444';
            var msg = (r.message || r.error || 'Desconhecido').substring(0, 90);
            var rt = r.responseTime ? ' (' + r.responseTime + 'ms)' : '';
            var cf = consec[name] || 0;
            var cfHtml = cf >= 2 ? '<span class="consec-badge ms-1">' + cf + '× falha</span>' : '';
            return '<div class="test-item" style="border-left-color:' + color + '">' +
                '<span style="font-size:1.2rem;flex-shrink:0;line-height:1.4">' + icon + '</span>' +
                '<div style="flex:1;min-width:0">' +
                '<div class="d-flex align-items-center gap-1 flex-wrap mb-1">' +
                '<span class="test-name">' + _.esc(name) + '</span>' + cfHtml + '</div>' +
                '<p class="test-msg mb-0">' + _.esc(msg) + rt + '</p>' +
                '</div></div>';
        }).join('');
        _.setText('passCount', pass);
        _.setText('totalTests', Object.keys(tests).length);
    }
    function renderRecs(recs) {
        var wrap = _.el('recommendationsWrap'), list = _.el('recommendationsList');
        if (!wrap)
            return;
        if (!recs.length) {
            wrap.style.display = 'none';
            return;
        }
        wrap.style.display = 'block';
        list.innerHTML = recs.map(function (r) {
            var ub = r.urgent ? '<span style="font-size:8px;font-weight:900;padding:1px 6px;border-radius:999px;background:rgba(239,68,68,.2);color:#f87171;margin-left:6px">Crítico</span>' : '';
            var cls = r.urgent ? 'rec-urgent' : r.status === 'FAIL' ? 'rec-fail' : 'rec-warn';
            var ic = r.urgent ? '#ef4444' : r.status === 'FAIL' ? '#f59e0b' : '#eab308';
            return '<div class="rec-item ' + cls + '">' +
                '<i class="bi bi-lightbulb-fill mt-1 flex-shrink:0" style="font-size:.75rem;color:' + ic + '"></i>' +
                '<div style="flex:1;min-width:0"><p class="mb-1" style="font-size:.78rem;font-weight:600;color:#fff">' +
                _.esc(r.test) + ub + '</p>' +
                '<p class="mb-0" style="font-size:.74rem;color:var(--sl-text-400)">' + _.esc(r.recommendation) + '</p></div></div>';
        }).join('');
    }
    function renderAnomalies(anom) {
        var wrap = _.el('anomaliesWrap'), list = _.el('anomaliesList');
        if (!wrap)
            return;
        if (!anom.length) {
            wrap.style.display = 'none';
            return;
        }
        wrap.style.display = 'block';
        list.innerHTML = anom.map(function (a) {
            return '<div class="anomaly-item">' +
                '<p class="mb-1" style="font-size:.79rem;font-weight:600;color:#fff">' + _.esc(a.test) + '</p>' +
                '<p class="mb-0" style="font-size:.74rem;color:var(--sl-text-400)">Atual: <span style="color:#eab308;font-weight:700">' +
                a.responseTime + 'ms</span> · Média: ' + a.avgResponseTime +
                'ms · <span style="color:#f87171">×' + (a.spike || 0).toFixed(1) + '</span></p>' +
                '</div>';
        }).join('');
    }
    // ── CHARTS ──────────────────────────────────────────────
    async function loadHistory() {
        if (_busyHistory)
            return;
        _busyHistory = true;
        try {
            var res = await fetch('/workers/api/scores?limit=20');
            if (!res.ok)
                return;
            var scores = await res.json();
            var labels = scores.map(function (s) {
                return new Date((s.timestamp || s.ts)).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
            });
            var vals = scores.map(function (s) { return s.score || 0; });
            if (charts.history) {
                charts.history.data.labels = labels;
                charts.history.data.datasets[0].data = vals;
                charts.history.update();
                return;
            }
            var ctx = _.el('chartHistory');
            if (!ctx)
                return;
            charts.history = new Chart(ctx, {
                type: 'line',
                data: {
                    labels: labels,
                    datasets: [{
                            label: 'Health Score (%)', data: vals,
                            borderColor: '#a855f7', backgroundColor: 'rgba(168,85,247,0.1)',
                            borderWidth: 2, fill: true, tension: .4,
                            pointRadius: 3, pointBackgroundColor: '#a855f7',
                            pointBorderColor: 'rgba(15,23,42,1)', pointBorderWidth: 2
                        }]
                },
                options: {
                    responsive: true, maintainAspectRatio: false,
                    plugins: { legend: { display: false } },
                    scales: {
                        y: { beginAtZero: true, max: 100, grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: 'var(--sl-text-500)', font: { size: 10 }, maxTicksLimit: 6 } },
                        x: { grid: { display: false }, ticks: { color: 'var(--sl-text-500)', font: { size: 10 }, maxRotation: 30, maxTicksLimit: 8 } }
                    }
                }
            });
        }
        catch (_) { }
        finally {
            _busyHistory = false;
        }
    }
    function updateStatusChart(tests) {
        var pass = 0, warn = 0, fail = 0;
        if (tests)
            Object.values(tests).forEach(function (t) {
                if (t.status === 'PASS')
                    pass++;
                else if (t.status === 'WARN')
                    warn++;
                else
                    fail++;
            });
        if (charts.status) {
            charts.status.data.datasets[0].data = [pass, warn, fail];
            charts.status.update();
            return;
        }
        var canvas = _.el('chartStatus');
        if (!canvas)
            return;
        charts.status = new Chart(canvas, {
            type: 'doughnut',
            data: {
                labels: ['Passando', 'Aviso', 'Falha'],
                datasets: [{ data: [pass, warn, fail], backgroundColor: ['#22c55e', '#eab308', '#ef4444'], borderColor: 'rgba(15,23,42,1)', borderWidth: 2 }]
            },
            options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom', labels: { color: 'var(--sl-text-400)', boxWidth: 10, font: { size: 11 }, padding: 12 } } } }
        });
    }
    // Exposição pública
    window.workerRefresh = workerRefresh;
    window._workerLoadHistory = loadHistory;
    window._workerStatusChart = updateStatusChart;
    window.solicitarAnaliseMemoria = function () { workerRefresh(); };
}());
