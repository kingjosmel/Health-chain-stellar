import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { OutboxConsumer } from './outbox-consumer';
import { OutboxEventEntity } from './outbox-event.entity';
import { OutboxProducer } from './outbox-producer';
import { OutboxService } from './outbox.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([OutboxEventEntity]),
    BullModule.registerQueue({
      name: 'outbox-events',
    }),
  ],
  providers: [OutboxService, OutboxProducer, OutboxConsumer],
  exports: [OutboxService],
})
export class EventsModule {}
