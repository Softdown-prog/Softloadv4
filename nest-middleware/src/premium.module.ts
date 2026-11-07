import {Module} from '@nestjs/common';
import type {DynamicModule} from '@nestjs/common';
import {PREMIUM_STATUS_READER,PremiumGuard} from './premium.js';
import type {PremiumStatusReader} from './premium.js';

// No implicit Firestore connection or fallback credential. A Nest caller must
// explicitly provide its production adapter; no adapter means no module.
@Module({})
export class PremiumAccessModule {
  static register(reader:PremiumStatusReader):DynamicModule {
    if(!reader||typeof reader.findByEmail!=='function')
      throw new TypeError('PremiumAccessModule requires a PremiumStatusReader');
    return {
      module:PremiumAccessModule,
      providers:[{provide:PREMIUM_STATUS_READER,useValue:reader},PremiumGuard],
      exports:[PremiumGuard],
    };
  }
}
