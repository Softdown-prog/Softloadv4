export type RequestState<T> =
  | { status: 'idle'; requestId: 0 }
  | { status: 'loading'; requestId: number }
  | { status: 'success'; requestId: number; data: T }
  | { status: 'error'; requestId: number; message: string };

export type RequestEvent<T> =
  | { type: 'start'; requestId: number }
  | { type: 'resolve'; requestId: number; data: T }
  | { type: 'reject'; requestId: number; message: string }
  | { type: 'reset' };

export function requestReducer<T>(state: RequestState<T>, event: RequestEvent<T>): RequestState<T> {
  if (event.type === 'reset') return { status: 'idle', requestId: 0 };
  if (!Number.isSafeInteger(event.requestId) || event.requestId <= 0) return state;
  if (event.type === 'start') {
    return event.requestId > state.requestId ? { status: 'loading', requestId: event.requestId } : state;
  }
  if (state.status !== 'loading' || state.requestId !== event.requestId) return state;
  if (event.type === 'resolve') return { status: 'success', requestId: event.requestId, data: event.data };
  return { status: 'error', requestId: event.requestId, message: event.message };
}
