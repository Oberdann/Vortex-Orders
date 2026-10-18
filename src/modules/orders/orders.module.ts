import { Module } from '@nestjs/common';
import { DatabaseModule } from 'src/database/prisma.module';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';
import { GetProductsUseCase } from './use-cases/get-products.use-case';
import { StockReservationResultsConsumer } from './consumers/stock-reservation-results.consumer';
import { OutboxPublisherService } from './producers/outbox-publisher.service';
import { PaymentResultsConsumer } from './consumers/payment-results.consumer';

@Module({
  imports: [DatabaseModule],
  controllers: [OrdersController],
  providers: [
    GetProductsUseCase,
    StockReservationResultsConsumer,
    PaymentResultsConsumer,
    OutboxPublisherService,
    {
      provide: 'IOrdersService',
      useClass: OrdersService,
    },
  ],
})
export class OrdersModule {}
