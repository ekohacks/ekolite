import { MethodMsg } from '../../shared/protocol.ts';
import { RpcHandleMessageError } from '../../shared/types.ts';
import { WebSocketWrapper } from '../infrastructure/websocket.ts';
import { Methods } from './methods.ts';

export class RpcHandler {
  private methods: Methods;
  private ws: WebSocketWrapper;

  constructor(methods: Methods, ws: WebSocketWrapper) {
    this.methods = methods;
    this.ws = ws;
  }

  async handleMessage(clientId: string, message: MethodMsg): Promise<void> {
    try {
      const result = await this.methods.call(message.name, message.params);

      this.ws.send(clientId, {
        type: 'result',
        id: message.id,
        result,
      });
    } catch (err) {
      this.ws.send(clientId, {
        type: 'error',
        id: message.id,
        error: RpcHandleMessageError(err),
      });
    }
  }
}
