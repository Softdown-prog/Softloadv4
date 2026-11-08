import 'reflect-metadata';
import {Controller,Get,Module,Redirect} from '@nestjs/common';

// The only real legacy GET delegated in the isolated one-listener proof.
// It is PUBLIC in Express 4, so adding a guard would change the contract.
// No controller in this module is registered in the commercial server.
@Controller('dashboard')
export class LegacyRedirectController {
  @Get('blogger-ai')
  @Redirect('/dashboard/gerador-blogger',301)
  redirect():void {}
}
@Module({controllers:[LegacyRedirectController]})
export class LegacyRedirectModule {}
