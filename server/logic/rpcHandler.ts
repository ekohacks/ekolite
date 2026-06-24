import { MethodMsg } from '../../shared/protocol.ts';
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
    const result = await this.methods.call(message.name, message.params);
    this.ws.send(clientId, {
      type: 'result',
      id: message.id,
      result,
    });
  }
}
