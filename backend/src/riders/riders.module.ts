import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RidersService } from './riders.service';
import { RidersController } from './riders.controller';
import { RiderEntity } from './entities/rider.entity';

@Module({
  imports: [TypeOrmModule.forFeature([RiderEntity])],
  controllers: [RidersController],
  providers: [RidersService],
  exports: [RidersService],
})
export class RidersModule {}
