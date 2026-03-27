import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';

import { CompensationModule } from '../common/compensation/compensation.module';

import { BlockchainController } from './controllers/blockchain.controller';
import { AdminGuard } from './guards/admin.guard';
import { SorobanDlqProcessor } from './processors/soroban-dlq.processor';
import { SorobanTxProcessor } from './processors/soroban-tx.processor';
import { IdempotencyService } from './services/idempotency.service';
import { QueueMetricsService } from './services/queue-metrics.service';
import { SorobanService } from './services/soroban.service';
import { JobDeduplicationPlugin } from './plugins/job-deduplication.plugin';

@Module({
  imports: [
    CompensationModule,
    BullModule.registerQueueAsync([
      {
        name: 'soroban-tx-queue',
        imports: [ConfigModule],
        inject: [ConfigService],
        useFactory: (configService: ConfigService) => ({
          connection: {
            host: configService.get<string>('REDIS_HOST', 'localhost'),
            port: configService.get<number>('REDIS_PORT', 6379),
          },
          defaultJobOptions: {
            attempts: 5,
            backoff: {
              type: 'exponential',
              delay: 1000,
            },
            removeOnComplete: true,
            removeOnFail: false,
          },
        }),
      },
      {
        name: 'soroban-dlq',
        imports: [ConfigModule],
        inject: [ConfigService],
        useFactory: (configService: ConfigService) => ({
          connection: {
            host: configService.get<string>('REDIS_HOST', 'localhost'),
            port: configService.get<number>('REDIS_PORT', 6379),
          },
        }),
      },
    ]),
  ],
  providers: [
    SorobanService,
    IdempotencyService,
    JobDeduplicationPlugin,
    SorobanTxProcessor,
    SorobanDlqProcessor,
    AdminGuard,
  ],
  controllers: [BlockchainController],
  exports: [SorobanService],
})
export class BlockchainModule {}
