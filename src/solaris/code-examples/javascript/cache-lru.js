'use strict';

class LruCache {
  constructor(capacity = 100) {
    if (!Number.isInteger(capacity) || capacity < 1 || capacity > 10000) throw new RangeError('capacity inválida');
    this.capacity = capacity;
    this.data = new Map();
  }
  get(key) {
    if (!this.data.has(key)) return undefined;
    const value = this.data.get(key);
    this.data.delete(key);
    this.data.set(key, value);
    return value;
  }
  set(key, value) {
    this.data.delete(key);
    this.data.set(key, value);
    if (this.data.size > this.capacity) {
      this.data.delete(this.data.keys().next().value);
    }
    return this;
  }
  has(key) { return this.data.has(key); }
  get size() { return this.data.size; }
}
module.exports = { LruCache };
