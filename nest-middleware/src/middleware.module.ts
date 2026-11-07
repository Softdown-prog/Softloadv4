import 'reflect-metadata';
import {Module} from '@nestjs/common';
import {SessionGuard,SuperAdminGuard,WorkerGuard} from './guards.js';
// The container only registers providers. It exposes NO commercial endpoints.
@Module({
  providers:[SessionGuard,SuperAdminGuard,WorkerGuard],
  exports:[SessionGuard,SuperAdminGuard,WorkerGuard]
})
export class MiddlewareModule {}
