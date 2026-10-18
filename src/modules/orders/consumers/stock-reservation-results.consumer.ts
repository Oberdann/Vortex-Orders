import {
  Inject,
  Injectable,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import * as amqp from 'amqplib';
import { ConfirmChannel, ConsumeMessage } from 'amqplib';
import { PinoLogger } from 'nestjs-pino';
import {
  MAX_PROCESSING_RETRIES,
  ORDERS_STOCK_RESERVATION_CONFIRMED_RETRY_QUEUE,
  ORDERS_STOCK_RESERVATION_REJECTED_RETRY_QUEUE,
  ORDERS_STOCK_RESERVATION_RESULTS_DLQ,
  ORDERS_STOCK_RESERVATION_RESULTS_FAILED_ROUTE,
  ORDERS_STOCK_RESERVATION_RESULTS_QUEUE,
  RABBITMQ_EVENTS_EXCHANGE,
  RETRY_DELAY_MS,
  STOCK_RESERVATION_CONFIRMED_EVENT,
  STOCK_RESERVATION_REJECTED_EVENT,
} from 'src/common/messaging/rabbitmq-topology';
import { IOrdersService } from '../contracts/i-orders-service';

interface StockReservationResultEvent {
  eventId: string;
  eventType:
    | typeof STOCK_RESERVATION_CONFIRMED_EVENT
    | typeof STOCK_RESERVATION_REJECTED_EVENT;
  data: {
    orderId: string;
    items?: Array<{ productId: string; quantity: number }>;
    reason?: string;
  };
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const RECONNECT_DELAY_MS = 5000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isStockReservationResultEvent(
  value: unknown,
): value is StockReservationResultEvent {
  if (!isRecord(value) || !isRecord(value.data)) {
    return false;
  }

  if (
    typeof value.eventId !== 'string' ||
    !UUID_PATTERN.test(value.eventId) ||
    (value.eventType !== STOCK_RESERVATION_CONFIRMED_EVENT &&
      value.eventType !== STOCK_RESERVATION_REJECTED_EVENT) ||
    typeof value.data.orderId !== 'string' ||
    !UUID_PATTERN.test(value.data.orderId)
  ) {
    return false;
  }

  if (value.eventType === STOCK_RESERVATION_CONFIRMED_EVENT) {
    return (
      Array.isArray(value.data.items) &&
      value.data.items.length > 0 &&
      value.data.items.every(
        (item: unknown) =>
          isRecord(item) &&
          typeof item.productId === 'string' &&
          UUID_PATTERN.test(item.productId) &&
          typeof item.quantity === 'number' &&
          Number.isInteger(item.quantity) &&
          item.quantity > 0,
      )
    );
  }

  return typeof value.data.reason === 'string';
}

@Injectable()
export class StockReservationResultsConsumer
  implements OnModuleInit, OnModuleDestroy
{
  private connection?: amqp.ChannelModel;
  private channel?: ConfirmChannel;
  private consumerTag?: string;
  private reconnectTimer?: NodeJS.Timeout;
  private shuttingDown = false;

  constructor(
    @Inject('IOrdersService') private readonly ordersService: IOrdersService,
    private readonly logger: PinoLogger,
  ) {}

  onModuleInit() {
    void this.connectAndConsume();
  }

  async onModuleDestroy() {
    this.shuttingDown = true;

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
    }

    if (this.consumerTag) {
      await this.channel?.cancel(this.consumerTag).catch(() => undefined);
    }

    await this.connection?.close().catch(() => undefined);
  }

  private async connectAndConsume() {
    if (this.shuttingDown || this.connection) {
      return;
    }

    const rabbitMqUrl = process.env.RABBITMQ_URL;
    if (!rabbitMqUrl) {
      this.logger.error('RABBITMQ_URL não foi configurada no Orders Service.');
      this.scheduleReconnect();
      return;
    }

    try {
      const connection = await amqp.connect(rabbitMqUrl);
      this.connection = connection;
      connection.on('error', () => undefined);
      connection.on('close', () => this.handleDisconnect());

      const channel = await connection.createConfirmChannel();
      this.channel = channel;
      channel.on('error', () => undefined);

      await this.declareTopology(channel);
      await channel.prefetch(10);

      const consumer = await channel.consume(
        ORDERS_STOCK_RESERVATION_RESULTS_QUEUE,
        (message) => {
          if (message) {
            void this.handleMessage(channel, message);
          }
        },
        { noAck: false },
      );

      this.consumerTag = consumer.consumerTag;

      this.logger.info(
        { queue: ORDERS_STOCK_RESERVATION_RESULTS_QUEUE },
        'Consumidor de resultados de reserva conectado.',
      );
    } catch (error) {
      this.logger.error(
        { errorType: error instanceof Error ? error.name : 'UnknownError' },
        'Falha ao conectar o consumidor de resultados de reserva.',
      );
      await this.closeConnection();
      this.scheduleReconnect();
    }
  }

  private async declareTopology(channel: ConfirmChannel) {
    await channel.assertExchange(RABBITMQ_EVENTS_EXCHANGE, 'topic', {
      durable: true,
    });

    await channel.assertExchange('vortex.events.dlx', 'topic', {
      durable: true,
    });

    await channel.assertQueue(ORDERS_STOCK_RESERVATION_RESULTS_DLQ, {
      durable: true,
    });

    await channel.bindQueue(
      ORDERS_STOCK_RESERVATION_RESULTS_DLQ,
      'vortex.events.dlx',
      ORDERS_STOCK_RESERVATION_RESULTS_FAILED_ROUTE,
    );

    await this.assertRetryQueue(
      channel,
      ORDERS_STOCK_RESERVATION_CONFIRMED_RETRY_QUEUE,
      STOCK_RESERVATION_CONFIRMED_EVENT,
    );

    await this.assertRetryQueue(
      channel,
      ORDERS_STOCK_RESERVATION_REJECTED_RETRY_QUEUE,
      STOCK_RESERVATION_REJECTED_EVENT,
    );

    await channel.assertQueue(ORDERS_STOCK_RESERVATION_RESULTS_QUEUE, {
      durable: true,
      arguments: {
        'x-dead-letter-exchange': 'vortex.events.dlx',
        'x-dead-letter-routing-key':
          ORDERS_STOCK_RESERVATION_RESULTS_FAILED_ROUTE,
      },
    });

    await channel.bindQueue(
      ORDERS_STOCK_RESERVATION_RESULTS_QUEUE,
      RABBITMQ_EVENTS_EXCHANGE,
      STOCK_RESERVATION_CONFIRMED_EVENT,
    );

    await channel.bindQueue(
      ORDERS_STOCK_RESERVATION_RESULTS_QUEUE,
      RABBITMQ_EVENTS_EXCHANGE,
      STOCK_RESERVATION_REJECTED_EVENT,
    );
  }

  private async assertRetryQueue(
    channel: ConfirmChannel,
    queue: string,
    routingKey: string,
  ) {
    await channel.assertQueue(queue, {
      durable: true,
      arguments: {
        'x-message-ttl': RETRY_DELAY_MS,
        'x-dead-letter-exchange': RABBITMQ_EVENTS_EXCHANGE,
        'x-dead-letter-routing-key': routingKey,
      },
    });
  }

  private async handleMessage(
    channel: ConfirmChannel,
    message: ConsumeMessage,
  ) {
    const event = this.parseEvent(message);

    if (!event) {
      this.logger.warn(
        { messageId: message.properties.messageId },
        'Resultado de reserva inválido enviado para a DLQ.',
      );

      channel.nack(message, false, false);
      return;
    }

    try {
      await this.ordersService.handleStockReservationResult(
        event.eventId,
        event.data.orderId,
        event.eventType === STOCK_RESERVATION_CONFIRMED_EVENT
          ? 'CONFIRMED'
          : 'REJECTED',
      );

      channel.ack(message);
    } catch (error) {
      if (this.isUniqueConstraintError(error)) {
        channel.ack(message);
        return;
      }

      await this.retryOrDeadLetter(channel, message, event.eventType, error);
    }
  }

  private parseEvent(
    message: ConsumeMessage,
  ): StockReservationResultEvent | undefined {
    try {
      const event: unknown = JSON.parse(message.content.toString());

      if (!isStockReservationResultEvent(event)) {
        return undefined;
      }

      return event;
    } catch {
      return undefined;
    }
  }

  private async retryOrDeadLetter(
    channel: ConfirmChannel,
    message: ConsumeMessage,
    eventType: StockReservationResultEvent['eventType'],
    error: unknown,
  ) {
    const retryHeader = message.properties.headers?.retryCount;
    const retries =
      typeof retryHeader === 'number' && Number.isInteger(retryHeader)
        ? retryHeader
        : 0;

    if (retries >= MAX_PROCESSING_RETRIES) {
      this.logger.error(
        { messageId: message.properties.messageId, retries },
        'Resultado de reserva excedeu as tentativas e foi enviado para a DLQ.',
      );
      channel.nack(message, false, false);
      return;
    }

    try {
      const retryQueue =
        eventType === STOCK_RESERVATION_CONFIRMED_EVENT
          ? ORDERS_STOCK_RESERVATION_CONFIRMED_RETRY_QUEUE
          : ORDERS_STOCK_RESERVATION_REJECTED_RETRY_QUEUE;

      channel.sendToQueue(retryQueue, message.content, {
        persistent: true,
        contentType: message.properties.contentType,
        messageId: message.properties.messageId,
        headers: { ...message.properties.headers, retryCount: retries + 1 },
      });

      await channel.waitForConfirms();
      channel.ack(message);
    } catch (publishError) {
      this.logger.error(
        {
          messageId: message.properties.messageId,
          errorType:
            publishError instanceof Error ? publishError.name : 'UnknownError',
        },
        'Falha ao agendar retry; resultado enviado para a DLQ.',
      );
      channel.nack(message, false, false);
      return;
    }

    if (error instanceof Error) {
      this.logger.warn(
        { messageId: message.properties.messageId, errorType: error.name },
        'Falha ao processar resultado de reserva; nova tentativa agendada.',
      );
    }
  }

  private isUniqueConstraintError(error: unknown) {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === 'P2002'
    );
  }

  private handleDisconnect() {
    this.connection = undefined;
    this.channel = undefined;
    this.consumerTag = undefined;

    if (!this.shuttingDown) {
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect() {
    if (this.shuttingDown || this.reconnectTimer) {
      return;
    }

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      void this.connectAndConsume();
    }, RECONNECT_DELAY_MS);

    this.reconnectTimer.unref();
  }

  private async closeConnection() {
    const connection = this.connection;
    this.connection = undefined;
    this.channel = undefined;
    this.consumerTag = undefined;

    await connection?.close().catch(() => undefined);
  }
}
