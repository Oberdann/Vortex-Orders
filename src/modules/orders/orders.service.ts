import { Injectable } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { Order, OrderStatus, Prisma } from 'generated/prisma/client';
import { PrismaService } from 'src/database/prisma.service';
import {
  IOrdersService,
  StockReservationOutcome,
} from './contracts/i-orders-service';
import { CreateOrderDto } from './dtos/input/create-order-dto';
import { OrderResponseDto } from './dtos/output/order-response-dto';
import { OrdersListResponseDto } from './dtos/output/orders-list-response-dto';
import { OrdersMapper } from './mapper/orders.mapper';
import { OrderNotFoundException } from './exceptions/order-not-found.exception';
import { OrderCannotBeCancelledException } from './exceptions/order-cannot-be-cancelled.exception';
import { GetProductsUseCase } from './use-cases/get-products.use-case';
import { ProductNotAvailableException } from './exceptions/product-not-available.exception';
import { ProductNotFoundException } from './exceptions/product-not-found.exception';
import { InsufficientStockException } from './exceptions/insufficient-stock.exception';
import {
  STOCK_RESERVATION_CONFIRMED_EVENT,
  STOCK_RESERVATION_REJECTED_EVENT,
  STOCK_RESERVATION_REQUESTED_EVENT,
  PAYMENT_CREATION_REQUESTED_EVENT,
  PAYMENT_READY_EVENT,
  LEGACY_PAYMENT_CREATION_SUCCEEDED_EVENT,
} from 'src/common/messaging/rabbitmq-topology';

@Injectable()
export class OrdersService implements IOrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly logger: PinoLogger,
    private readonly getProductsUseCase: GetProductsUseCase,
  ) {}

  async getAll(): Promise<OrdersListResponseDto> {
    const orders = await this.prisma.order.findMany({
      include: { items: true },
      orderBy: { createdAt: 'desc' },
    });

    const response = OrdersMapper.toListResponseDto(orders);

    return response;
  }

  async getById(id: string): Promise<OrderResponseDto> {
    const order = await this.prisma.order.findUnique({
      where: { id },
      include: { items: true },
    });

    if (!order) {
      this.logger.warn({ orderId: id }, 'Pedido não encontrado.');

      throw new OrderNotFoundException(id);
    }

    const response = OrdersMapper.toResponseDto(order);

    return response;
  }

  async getByUserId(userId: string): Promise<OrdersListResponseDto> {
    const orders = await this.prisma.order.findMany({
      where: { userId },
      include: { items: true },
      orderBy: { createdAt: 'desc' },
    });

    const response = OrdersMapper.toListResponseDto(orders);

    return response;
  }

  async create(createOrderDto: CreateOrderDto): Promise<OrderResponseDto> {
    const productIds = createOrderDto.items.map((item) => item.productId);

    const products = await this.getProductsUseCase.execute(productIds);

    const items = createOrderDto.items.map((item) => {
      const product = products.find((product) => product.id === item.productId);

      if (!product) {
        throw new ProductNotFoundException(item.productId);
      }

      if (!product.isActive) {
        throw new ProductNotAvailableException(item.productId);
      }

      if (product.stock.available < item.quantity) {
        throw new InsufficientStockException(
          item.productId,
          item.quantity,
          product.stock.available,
        );
      }

      return {
        productId: item.productId,
        quantity: item.quantity,
        unitPrice: product.price,
      };
    });

    const total = items.reduce(
      (orderTotal, item) =>
        orderTotal.add(new Prisma.Decimal(item.unitPrice).mul(item.quantity)),
      new Prisma.Decimal(0),
    );

    const order = await this.prisma.$transaction(async (transaction) => {
      const created = await transaction.order.create({
        data: {
          userId: createOrderDto.userId,
          status: OrderStatus.PENDING,
          total,
          items: {
            create: items,
          },
        },
        include: { items: true },
      });

      await transaction.outboxEvent.create({
        data: {
          aggregateId: created.id,
          eventType: STOCK_RESERVATION_REQUESTED_EVENT,
          payload: {
            orderId: created.id,
            items: created.items.map((item) => ({
              productId: item.productId,
              quantity: item.quantity,
            })),
          },
        },
      });

      return created;
    });

    this.logger.info(
      { orderId: order.id, userId: order.userId },
      'Pedido criado com sucesso.',
    );

    return OrdersMapper.toResponseDto(order);
  }

  async handleStockReservationResult(
    eventId: string,
    orderId: string,
    outcome: StockReservationOutcome,
  ): Promise<void> {
    const eventType =
      outcome === 'CONFIRMED'
        ? STOCK_RESERVATION_CONFIRMED_EVENT
        : STOCK_RESERVATION_REJECTED_EVENT;

    const nextStatus =
      outcome === 'CONFIRMED'
        ? OrderStatus.RESERVED
        : OrderStatus.STOCK_REJECTED;

    await this.prisma.$transaction(async (transaction) => {
      const processedEvent = await transaction.inboxEvent.findUnique({
        where: { eventId },
      });

      if (processedEvent) {
        return;
      }

      const updated = await transaction.order.updateMany({
        where: { id: orderId, status: OrderStatus.PENDING },
        data: { status: nextStatus },
      });

      if (updated.count === 0) {
        const order = await transaction.order.findUnique({
          where: { id: orderId },
          select: { status: true },
        });

        if (!order) {
          throw new OrderNotFoundException(orderId);
        }

        if (order.status !== nextStatus) {
          this.logger.warn(
            {
              orderId,
              currentStatus: order.status,
              receivedEventType: eventType,
            },
            'Resultado de reserva ignorado porque o pedido já avançou de estado.',
          );
        }
      }

      if (outcome === 'CONFIRMED' && updated.count > 0) {
        const order = await transaction.order.findUniqueOrThrow({
          where: { id: orderId },
          select: { total: true },
        });

        await transaction.outboxEvent.create({
          data: {
            aggregateId: orderId,
            eventType: PAYMENT_CREATION_REQUESTED_EVENT,
            payload: {
              orderId,
              amount: order.total.toString(),
            },
          },
        });
      }

      await transaction.inboxEvent.create({
        data: { eventId, eventType, aggregateId: orderId },
      });
    });
  }

  async handlePaymentResult(
    eventId: string,
    eventType: string,
    orderId: string,
    paymentStatus?: string,
  ): Promise<void> {
    await this.prisma.$transaction(async (transaction) => {
      const processedEvent = await transaction.inboxEvent.findUnique({
        where: { eventId },
      });

      if (processedEvent) {
        return;
      }

      const order = await transaction.order.findUnique({
        where: { id: orderId },
        select: { status: true },
      });

      if (!order) {
        throw new OrderNotFoundException(orderId);
      }

      const nextStatus = this.getOrderStatusFromPaymentEvent(
        eventType,
        paymentStatus,
      );

      const canRetryPayment =
        order.status === OrderStatus.PAYMENT_FAILED &&
        paymentStatus === 'PENDING';

      const canUpdateStatus =
        order.status === OrderStatus.RESERVED ||
        order.status === OrderStatus.PAYMENT_PENDING ||
        canRetryPayment;

      if (nextStatus && canUpdateStatus) {
        await transaction.order.update({
          where: { id: orderId },
          data: { status: nextStatus },
        });
      }

      await transaction.inboxEvent.create({
        data: { eventId, eventType, aggregateId: orderId },
      });
    });
  }

  async cancel(id: string): Promise<void> {
    const order = await this.findOrderOrFail(id);

    if (order.status === OrderStatus.CANCELLED) {
      return;
    }

    if (order.status !== OrderStatus.PENDING) {
      throw new OrderCannotBeCancelledException();
    }

    const result = await this.prisma.order.updateMany({
      where: { id, status: OrderStatus.PENDING },
      data: { status: OrderStatus.CANCELLED },
    });

    if (result.count === 0) {
      const currentOrder = await this.findOrderOrFail(id);

      if (currentOrder.status === OrderStatus.CANCELLED) {
        return;
      }

      throw new OrderCannotBeCancelledException();
    }

    this.logger.info({ orderId: id }, 'Pedido cancelado com sucesso.');
  }

  private async findOrderOrFail(id: string): Promise<Order> {
    const order = await this.prisma.order.findUnique({
      where: { id },
    });

    if (!order) {
      this.logger.warn({ orderId: id }, 'Pedido não encontrado.');

      throw new OrderNotFoundException(id);
    }

    return order;
  }

  private getOrderStatusFromPaymentEvent(
    eventType: string,
    paymentStatus?: string,
  ): OrderStatus | undefined {
    if (
      eventType === PAYMENT_READY_EVENT ||
      eventType === LEGACY_PAYMENT_CREATION_SUCCEEDED_EVENT
    ) {
      return OrderStatus.PAYMENT_PENDING;
    }

    if (paymentStatus === 'APPROVED') {
      return OrderStatus.PAID;
    }

    if (paymentStatus === 'REJECTED' || paymentStatus === 'CANCELLED') {
      return OrderStatus.PAYMENT_FAILED;
    }

    if (paymentStatus === 'PENDING') {
      return OrderStatus.PAYMENT_PENDING;
    }

    return undefined;
  }
}
