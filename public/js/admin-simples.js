/* Admin Blogger: consulta read-only; nenhum endpoint mutável é chamado nesta tela. */
(function () {
  'use strict';
  const root = document.querySelector('[data-admin-section]');
  if (!root) return;
  const section = root.getAttribute('data-admin-section');
  const status = document.getElementById('admin-status');

  function say(message) {
    if (status) status.textContent = message;
  }
  async function getJson(endpoint) {
    const response = await fetch(endpoint, {
      method: 'GET', credentials: 'same-origin', cache: 'no-store',
      headers: { Accept: 'application/json' }
    });
    if (!response.ok || !(response.headers.get('content-type') || '').includes('application/json')) {
      throw new Error('Consulta indisponível');
    }
    const result = await response.json();
    if (result.erro) throw new Error('Consulta indisponível');
    return result;
  }
  function number(value) {
    const n = Number(value);
    return Number.isFinite(n) ? new Intl.NumberFormat('pt-BR').format(n) : '—';
  }
  function renderTable(id, rows, colspan, empty) {
    const body = document.getElementById(id);
    if (!body) return;
    body.replaceChildren();
    if (!rows.length) {
      const tr = document.createElement('tr');
      const td = document.createElement('td');
      td.colSpan = colspan;
      td.textContent = empty;
      tr.appendChild(td);
      body.appendChild(tr);
      return;
    }
    for (const values of rows) {
      const tr = document.createElement('tr');
      for (const value of values) {
        const td = document.createElement('td');
        // textContent, nunca innerHTML: campos vindos do Firestore não são HTML.
        td.textContent = String(value ?? '—');
        tr.appendChild(td);
      }
      body.appendChild(tr);
    }
  }
  async function load() {
    try {
      if (section === 'inicio') {
        const info = await getJson('/eu/api/kpis');
        for (const element of root.querySelectorAll('[data-kpi]')) {
          const key = element.getAttribute('data-kpi');
          element.textContent = key === 'storageTotal' ? String(info[key] ?? '—') : number(info[key]);
        }
        say('Dados atualizados. Indicadores históricos; não representam faturamento.');
      } else if (section === 'usuarios') {
        const data = await getJson('/eu/api/usuarios?limit=50');
        const items = Array.isArray(data.usuarios) ? data.usuarios : [];
        renderTable('admin-usuarios', items.map(user => [
          user.email, user.nome, user.plano,
          user.is_active ? 'Ativa' : 'Não ativa',
          number(user.tentativas_compilacao), user.storage_usado_mb
        ]), 6, 'Nenhuma conta encontrada.');
        say(items.length + ' conta(s) exibida(s). Consulta somente leitura.');
      } else if (section === 'analytics') {
        const data = await getJson('/eu/api/analytics/creditos?dias=30');
        const groups = Object.entries(data.por_plano || {});
        renderTable('admin-analytics', groups.map(([plan, info]) => [
          plan, number(info.usuarios_ativos), number(info.total_interacoes),
          number(info.total_creditos_debitados), number(info.total_tokens)
        ]), 5, 'Nenhum consumo de IA registrado neste período.');
        say(data.semIndice
          ? 'Dados indisponíveis: falta índice de consulta do histórico.'
          : 'Últimos 30 dias. Histórico legado de uso de IA, sem movimentações financeiras.');
      }
    } catch (_) {
      say('Não foi possível carregar os dados agora. Atualize a página para tentar novamente.');
      if (section === 'usuarios') renderTable('admin-usuarios', [], 6, 'Consulta temporariamente indisponível.');
      if (section === 'analytics') renderTable('admin-analytics', [], 5, 'Consulta temporariamente indisponível.');
    }
  }
  void load();
})();
