import { OrderStatus } from 'generated/prisma/enums';
import { OrderItemResponseDto } from './order-item-response-dto';

export class OrderResponseDto {
  id: string;
  userId: string;
  status: OrderStatus;
  total: number;
  items: OrderItemResponseDto[];
  createdAt: Date;
  updatedAt: Date;
}
