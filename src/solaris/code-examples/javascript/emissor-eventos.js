'use strict';

function createEventBus() {
  const listeners = new Map();
  function on(event, listener) {
    if (typeof event !== 'string' || !event || typeof listener !== 'function') throw new TypeError('evento ou listener inválido');
    if (!listeners.has(event)) listeners.set(event, new Set());
    listeners.get(event).add(listener);
    return () => {
      const group = listeners.get(event);
      if (!group) return;
      group.delete(listener);
      if (!group.size) listeners.delete(event);
    };
  }
  function emit(event, payload) {
    for (const listener of [...(listeners.get(event) || [])]) listener(payload);
  }
  return { on, emit };
}
module.exports = { createEventBus };
