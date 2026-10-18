import { CreateOrderDto } from '../dtos/input/create-order-dto';
import { OrderResponseDto } from '../dtos/output/order-response-dto';
import { OrdersListResponseDto } from '../dtos/output/orders-list-response-dto';

export type StockReservationOutcome = 'CONFIRMED' | 'REJECTED';

export interface IOrdersService {
  getAll(): Promise<OrdersListResponseDto>;
  getById(id: string): Promise<OrderResponseDto>;
  getByUserId(userId: string): Promise<OrdersListResponseDto>;
  create(order: CreateOrderDto): Promise<OrderResponseDto>;
  cancel(id: string): Promise<void>;
  handleStockReservationResult(eventId: string, orderId: string, outcome: StockReservationOutcome): Promise<void>;
  handlePaymentResult(eventId: string, eventType: string, orderId: string, paymentStatus?: string,): Promise<void>;
}
