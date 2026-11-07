import 'reflect-metadata';
import {Module} from '@nestjs/common';
import {SessionGuard,SuperAdminGuard,WorkerGuard} from './guards.mjs';
// These providers may later be reused by Nest controllers. The module itself
// declares no HTTP endpoints and cannot expose private routes accidentally.
export class MiddlewareModule {}
Module({
  providers:[SessionGuard,SuperAdminGuard,WorkerGuard],
  exports:[SessionGuard,SuperAdminGuard,WorkerGuard]
})(MiddlewareModule);
