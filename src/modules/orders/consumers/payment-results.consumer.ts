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
  LEGACY_PAYMENT_CREATION_SUCCEEDED_EVENT,
  ORDERS_PAYMENT_RESULTS_DLQ,
  ORDERS_PAYMENT_RESULTS_FAILED_ROUTE,
  ORDERS_PAYMENT_RESULTS_QUEUE,
  ORDERS_PAYMENT_RESULTS_RETRY_QUEUE,
  ORDERS_PAYMENT_STATUS_RESULTS_RETRY_QUEUE,
  PAYMENT_READY_EVENT,
  PAYMENT_STATUS_CHANGED_EVENT,
  RABBITMQ_EVENTS_EXCHANGE,
  RETRY_DELAY_MS,
} from 'src/common/messaging/rabbitmq-topology';
import { IOrdersService } from '../contracts/i-orders-service';

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const DLX = 'vortex.events.dlx';

interface PaymentResultEvent {
  eventId: string;
  eventType:
    | typeof PAYMENT_READY_EVENT
    | typeof LEGACY_PAYMENT_CREATION_SUCCEEDED_EVENT
    | typeof PAYMENT_STATUS_CHANGED_EVENT;
  data: {
    orderId: string;
    status?: unknown;
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isPaymentResultEvent(value: unknown): value is PaymentResultEvent {
  if (!isRecord(value) || !isRecord(value.data)) {
    return false;
  }

  if (
    typeof value.eventId !== 'string' ||
    !UUID.test(value.eventId) ||
    typeof value.data.orderId !== 'string' ||
    !UUID.test(value.data.orderId) ||
    (value.eventType !== PAYMENT_READY_EVENT &&
      value.eventType !== LEGACY_PAYMENT_CREATION_SUCCEEDED_EVENT &&
      value.eventType !== PAYMENT_STATUS_CHANGED_EVENT)
  ) {
    return false;
  }

  if (value.eventType === PAYMENT_STATUS_CHANGED_EVENT) {
    return typeof value.data.status === 'string';
  }

  return true;
}

@Injectable()
export class PaymentResultsConsumer implements OnModuleInit, OnModuleDestroy {
  private connection?: amqp.ChannelModel;
  private channel?: ConfirmChannel;
  private consumerTag?: string;
  private reconnectTimer?: NodeJS.Timeout;
  private stopping = false;

  constructor(
    @Inject('IOrdersService') private readonly orders: IOrdersService,
    private readonly logger: PinoLogger,
  ) {}

  onModuleInit() {
    void this.connect();
  }

  async onModuleDestroy() {
    this.stopping = true;

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
    }

    if (this.consumerTag) {
      await this.channel?.cancel(this.consumerTag).catch(() => undefined);
    }

    await this.connection?.close().catch(() => undefined);
  }

  private async connect() {
    if (this.stopping || this.connection) {
      return;
    }

    const rabbitMqUrl = process.env.RABBITMQ_URL;

    if (!rabbitMqUrl) {
      this.logger.error('RABBITMQ_URL não foi configurada no Orders Service.');
      this.reconnect();
      return;
    }

    try {
      this.connection = await amqp.connect(rabbitMqUrl);
      this.connection.on('error', () => undefined);
      this.connection.on('close', () => {
        this.connection = undefined;
        this.channel = undefined;
        this.consumerTag = undefined;

        this.reconnect();
      });

      this.channel = await this.connection.createConfirmChannel();
      this.channel.on('error', () => undefined);

      await this.declareTopology(this.channel);
      await this.channel.prefetch(10);

      const channel = this.channel;
      const result = await channel.consume(
        ORDERS_PAYMENT_RESULTS_QUEUE,
        (message) => {
          if (message) {
            void this.handle(channel, message);
          }
        },
        { noAck: false },
      );

      this.consumerTag = result.consumerTag;
    } catch (error) {
      this.logger.error(
        { errorType: error instanceof Error ? error.name : 'UnknownError' },
        'Falha ao conectar consumidor de resultados de pagamento.',
      );
      await this.connection?.close().catch(() => undefined);

      this.connection = undefined;
      this.channel = undefined;
      this.reconnect();
    }
  }

  private async declareTopology(channel: ConfirmChannel) {
    await channel.assertExchange(RABBITMQ_EVENTS_EXCHANGE, 'topic', {
      durable: true,
    });

    await channel.assertExchange(DLX, 'topic', { durable: true });

    await channel.assertQueue(ORDERS_PAYMENT_RESULTS_DLQ, { durable: true });

    await channel.bindQueue(
      ORDERS_PAYMENT_RESULTS_DLQ,
      DLX,
      ORDERS_PAYMENT_RESULTS_FAILED_ROUTE,
    );

    await channel.assertQueue(ORDERS_PAYMENT_RESULTS_RETRY_QUEUE, {
      durable: true,
      arguments: {
        'x-message-ttl': RETRY_DELAY_MS,
        'x-dead-letter-exchange': RABBITMQ_EVENTS_EXCHANGE,
        'x-dead-letter-routing-key': LEGACY_PAYMENT_CREATION_SUCCEEDED_EVENT,
      },
    });

    await channel.assertQueue(ORDERS_PAYMENT_STATUS_RESULTS_RETRY_QUEUE, {
      durable: true,
      arguments: {
        'x-message-ttl': RETRY_DELAY_MS,
        'x-dead-letter-exchange': RABBITMQ_EVENTS_EXCHANGE,
        'x-dead-letter-routing-key': PAYMENT_STATUS_CHANGED_EVENT,
      },
    });

    await channel.assertQueue(ORDERS_PAYMENT_RESULTS_QUEUE, {
      durable: true,
      arguments: {
        'x-dead-letter-exchange': DLX,
        'x-dead-letter-routing-key': ORDERS_PAYMENT_RESULTS_FAILED_ROUTE,
      },
    });

    await channel.bindQueue(
      ORDERS_PAYMENT_RESULTS_QUEUE,
      RABBITMQ_EVENTS_EXCHANGE,
      PAYMENT_READY_EVENT,
    );

    await channel.bindQueue(
      ORDERS_PAYMENT_RESULTS_QUEUE,
      RABBITMQ_EVENTS_EXCHANGE,
      LEGACY_PAYMENT_CREATION_SUCCEEDED_EVENT,
    );

    await channel.bindQueue(
      ORDERS_PAYMENT_RESULTS_QUEUE,
      RABBITMQ_EVENTS_EXCHANGE,
      PAYMENT_STATUS_CHANGED_EVENT,
    );
  }

  private async handle(channel: ConfirmChannel, message: ConsumeMessage) {
    let event: unknown;

    try {
      event = JSON.parse(message.content.toString());
    } catch {
      channel.nack(message, false, false);
      return;
    }

    if (!isPaymentResultEvent(event)) {
      channel.nack(message, false, false);
      return;
    }

    try {
      await this.orders.handlePaymentResult(
        event.eventId,
        event.eventType,
        event.data.orderId,
        typeof event.data.status === 'string' ? event.data.status : undefined,
      );

      channel.ack(message);
    } catch (error) {
      if ((error as { code?: string })?.code === 'P2002') {
        channel.ack(message);
        return;
      }

      const retryHeader = message.properties.headers?.retryCount;
      const parsedRetries = Number(retryHeader ?? 0);
      const retries = Number.isFinite(parsedRetries) ? parsedRetries : 0;

      if (retries >= MAX_PROCESSING_RETRIES) {
        channel.nack(message, false, false);
        return;
      }

      try {
        const retryQueue =
          event.eventType === PAYMENT_STATUS_CHANGED_EVENT
            ? ORDERS_PAYMENT_STATUS_RESULTS_RETRY_QUEUE
            : ORDERS_PAYMENT_RESULTS_RETRY_QUEUE;

        channel.sendToQueue(retryQueue, message.content, {
          persistent: true,
          contentType: message.properties.contentType,
          messageId: message.properties.messageId,
          headers: { ...message.properties.headers, retryCount: retries + 1 },
        });

        await channel.waitForConfirms();
        channel.ack(message);
      } catch {
        channel.nack(message, false, false);
        return;
      }

      this.logger.warn(
        { errorType: error instanceof Error ? error.name : 'UnknownError' },
        'Falha ao processar resultado de pagamento; retry agendado.',
      );
    }
  }

  private reconnect() {
    if (this.stopping || this.reconnectTimer) {
      return;
    }

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      void this.connect();
    }, 5000);

    this.reconnectTimer.unref();
  }
}
