interface ClientSocketInterface {
  connect(): Promise<void>;
  close(): Promise<void>;
  send(message: unknown): void;
  get isConnected(): boolean;
}

export class ClientSocket {
  private client: ClientSocketInterface;

  private constructor(client: ClientSocketInterface) {
    this.client = client;
  }

  //   static create(url: string): ClientSocket {
  //     return new ClientSocket(new RealClientSocket(url));
  //   }

  static createNull(): ClientSocket {
    // Implementation for null socket
    return new ClientSocket(new StubbedClientSocket());
  }

  async connect(): Promise<void> {
    await this.client.connect();
  }

  async close(): Promise<void> {
    await this.client.close();
  }

  get isConnected(): boolean {
    return this.client.isConnected;
  }
}

export class StubbedClientSocket implements ClientSocketInterface {
  private _isConnected = false;

  connect(): Promise<void> {
    this._isConnected = true;
    return Promise.resolve();
  }

  close(): Promise<void> {
    this._isConnected = false;
    return Promise.resolve();
  }

  send(): void {}

  get isConnected(): boolean {
    return this._isConnected;
  }
}
