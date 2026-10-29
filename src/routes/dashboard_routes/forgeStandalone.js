"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.download = exports.show = void 0;
const runtime = require('./forgeStandalone.cjs');
const show = (req, res) => runtime.show(req, res);
exports.show = show;
const download = (req, res) => runtime.download(req, res);
exports.download = download;
