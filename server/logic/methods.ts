export type MethodFn = (...args: string[]) => Promise<string>;

export function methodNotFound(code: number, name: string): never {
  throw new RpcError(code, `Method not found: ${name}`);
}

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
      methodNotFound(404, name);
    }

    return method(...args);
  }
}
