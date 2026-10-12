import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
} from '@nestjs/common';
import { Ok } from 'src/common/utils/response-util';
import { IOrdersService } from './contracts/i-orders-service';
import { CreateOrderDto } from './dtos/input/create-order-dto';

@Controller('orders')
export class OrdersController {
  constructor(
    @Inject('IOrdersService')
    private readonly ordersService: IOrdersService,
  ) {}

  @HttpCode(200)
  @Get()
  async getAll() {
    const response = await this.ordersService.getAll();

    const message = !response?.orders.length
      ? 'Nenhum pedido encontrado.'
      : 'Pedidos encontrados com sucesso.';

    return Ok(message, response);
  }

  @HttpCode(200)
  @Get('user/:userId')
  async getByUserId(@Param('userId') userId: string) {
    const response = await this.ordersService.getByUserId(userId);

    return Ok('Pedidos do usuário consultados com sucesso.', response);
  }

  @HttpCode(200)
  @Get(':id')
  async getById(@Param('id') id: string) {
    const response = await this.ordersService.getById(id);

    return Ok('Pedido encontrado com sucesso.', response);
  }

  @HttpCode(201)
  @Post()
  async create(@Body() order: CreateOrderDto) {
    const response = await this.ordersService.create(order);

    return Ok('Pedido criado com sucesso.', response);
  }

  @HttpCode(200)
  @Post(':id/cancel')
  async cancel(@Param('id') id: string) {
    await this.ordersService.cancel(id);

    return Ok('Pedido cancelado com sucesso.');
  }
}
