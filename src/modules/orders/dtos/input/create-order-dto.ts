import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsUUID, ValidateNested } from 'class-validator';
import { CreateOrderItemDto } from './create-order-item-dto';

export class CreateOrderDto {
  @ApiProperty({ example: 'b7e2f3a1-9876-4c2d-9f0a-abcdef123456' })
  @IsUUID('4', { message: 'O campo [userId] precisa ser um UUID válido.' })
  userId: string;

  @ApiProperty({ type: [CreateOrderItemDto] })
  @IsArray({ message: 'O campo [items] precisa ser um array.' })
  @ArrayMinSize(1, { message: 'O pedido precisa ter pelo menos um item.' })
  @ValidateNested({ each: true })
  @Type(() => CreateOrderItemDto)
  items: CreateOrderItemDto[];
}
