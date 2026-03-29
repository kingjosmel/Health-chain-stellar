import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { DeliveryProofEntity } from './entities/delivery-proof.entity';
import { DeliveryProofService } from './delivery-proof.service';
import { DeliveryProofController } from './delivery-proof.controller';

import { ConfigModule } from '@nestjs/config';
import { SorobanModule } from '../soroban/soroban.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([DeliveryProofEntity]),
    ConfigModule,
    SorobanModule,
  ],
  controllers: [DeliveryProofController],
  providers: [DeliveryProofService],
  exports: [DeliveryProofService],
})
export class DeliveryProofModule {}

