export type MethodFn = (...args: string[]) => Promise<string>;

class RpcError extends Error {
  constructor(
    public readonly code: number,
    message: string,
  ) {
    super(message);
    this.name = 'RpcError';
  }
}

export class Methods {
  private methods = new Map<string, MethodFn>();

  define(name: string, fn: MethodFn): void {
    this.methods.set(name, fn);
  }

  async call(name: string, args: string[]): Promise<string> {
    const method = this.methods.get(name);
    if (!method) {
      throw new RpcError(404, `Method not found: ${name}`);
    }
    return method(...args);
  }
}
