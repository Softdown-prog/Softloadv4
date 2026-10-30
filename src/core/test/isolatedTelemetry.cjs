'use strict';
// The real compiler and XML validators run; only external telemetry I/O is isolated.
const id = require.resolve('../telemetria');
require.cache[id] = { id, filename: id, loaded: true, exports: { registrarCompilacao() {} } };
