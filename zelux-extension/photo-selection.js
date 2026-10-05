(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ZeluxPhotoSelection = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  function validate(value, count) {
    if (!value || !Number.isInteger(value.total) || value.total < 1 || value.total > 200
      || !Array.isArray(value.positions) || value.positions.length !== count || !count
      || value.positions.some(n => !Number.isInteger(n) || n < 1 || n > value.total)
      || value.positions.some((n, i, a) => i > 0 && n <= a[i - 1])) {
      throw new Error('รายการรูปที่เลือกไม่ถูกต้อง กรุณาเปิด Extension แล้วเลือกใหม่');
    }
    return { total: value.total, positions: [...value.positions] };
  }
  function create(total) {
    if (!Number.isInteger(total) || total < 1 || total > 200) throw new Error('Invalid photo count');
    return {
      total, page: 0, pageSize: 9, selected: new Set(Array.from({ length: total }, (_, i) => i + 1)),
      get pages() { return Math.ceil(this.total / this.pageSize); },
      get positions() { return [...this.selected].sort((a, b) => a - b); },
      toggle(n) { if (!Number.isInteger(n) || n < 1 || n > this.total) return; this.selected.has(n) ? this.selected.delete(n) : this.selected.add(n); },
      all() { this.selected = new Set(Array.from({ length: this.total }, (_, i) => i + 1)); },
      clear() { this.selected.clear(); },
      turn(delta) { this.page = Math.min(this.pages - 1, Math.max(0, this.page + delta)); },
      visible() { return Array.from({ length: Math.min(this.pageSize, this.total - this.page * this.pageSize) }, (_, i) => this.page * this.pageSize + i + 1); },
      payload() { return validate({ total: this.total, positions: this.positions }, this.selected.size); },
    };
  }
  return { create, validate };
});
