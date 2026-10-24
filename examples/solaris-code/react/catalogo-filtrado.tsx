import React from 'react';

export interface CatalogItem { id: string; name: string; description: string }
export interface CatalogProps { items: ReadonlyArray<CatalogItem>; query: string }

const normalize = (value: string): string =>
  value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR');

export function CatalogList({ items, query }: CatalogProps): React.ReactElement {
  const term = normalize(query.trim());
  const results = items.filter(item => normalize(item.name + ' ' + item.description).includes(term));
  return (
    <section aria-label="Resultados do catálogo">
      <p role="status">{results.length} resultado(s)</p>
      {results.length === 0
        ? <p>Nenhum item encontrado.</p>
        : <ul>{results.map(item => <li key={item.id}><strong>{item.name}</strong><span> — {item.description}</span></li>)}</ul>}
    </section>
  );
}
