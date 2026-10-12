import { CreateOrderDto } from '../dtos/input/create-order-dto';
import { OrderResponseDto } from '../dtos/output/order-response-dto';
import { OrdersListResponseDto } from '../dtos/output/orders-list-response-dto';

export interface IOrdersService {
  getAll(): Promise<OrdersListResponseDto>;
  getById(id: string): Promise<OrderResponseDto>;
  getByUserId(userId: string): Promise<OrdersListResponseDto>;
  create(order: CreateOrderDto): Promise<OrderResponseDto>;
  cancel(id: string): Promise<void>;
}
