import { Module } from '@nestjs/common';
import { ProviderRegistryService } from './provider-registry.service.js';

@Module({
  providers: [ProviderRegistryService],
  exports: [ProviderRegistryService],
})
export class ProvidersModule {}
