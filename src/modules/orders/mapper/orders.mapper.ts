import { Prisma } from 'generated/prisma/client';
import { OrderResponseDto } from '../dtos/output/order-response-dto';

type OrderWithItems = Prisma.OrderGetPayload<{
  include: { items: true };
}>;

export class OrdersMapper {
  static toResponseDto(order: OrderWithItems): OrderResponseDto {
    return {
      id: order.id,
      userId: order.userId,
      status: order.status,
      total: Number(order.total),
      items: order.items.map((item) => ({
        id: item.id,
        productId: item.productId,
        quantity: item.quantity,
        unitPrice: Number(item.unitPrice),
      })),
      createdAt: order.createdAt,
      updatedAt: order.updatedAt,
    };
  }

  static toListResponseDto(orders: OrderWithItems[]) {
    return {
      orders: orders.map(OrdersMapper.toResponseDto),
    };
  }
}
