import { Module } from '@nestjs/common';
import { DatabaseModule } from 'src/database/prisma.module';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';
import { GetProductsUseCase } from './use-cases/get-products.use-case';

@Module({
  imports: [DatabaseModule],
  controllers: [OrdersController],
  providers: [
    GetProductsUseCase,
    {
      provide: 'IOrdersService',
      useClass: OrdersService,
    },
  ],
})
export class OrdersModule {}
