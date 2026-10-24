import React from 'react';

export type RemoteState<T> =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'success'; data: T };

interface Props<T> {
  state: RemoteState<T>;
  renderData: (data: T) => React.ReactNode;
  onRetry: () => void;
}

export function RemoteStatus<T>({ state, renderData, onRetry }: Props<T>): React.ReactElement {
  switch (state.status) {
    case 'idle': return <p>Aguardando consulta.</p>;
    case 'loading': return <p role="status" aria-live="polite">Carregando...</p>;
    case 'error': return <div role="alert"><p>{state.message}</p><button type="button" onClick={onRetry}>Tentar novamente</button></div>;
    case 'success': return <section aria-label="Dados carregados">{renderData(state.data)}</section>;
  }
}
