import { MethodContext, MethodFn, methodNotFound, SERVER_CALL } from '../../shared/types.ts';

export class Methods {
  private methods = new Map<string, MethodFn>();

  define(name: string, fn: MethodFn): void {
    if (this.methods.has(name)) {
      throw new Error(`Method already defined: ${name}`);
    }
    this.methods.set(name, fn);
  }

  async call(
    name: string,
    args: unknown[],
    context: MethodContext = SERVER_CALL,
  ): Promise<unknown> {
    const method = this.methods.get(name);
    if (!method) {
      throw methodNotFound(name);
    }

    return method.apply(context, args);
  }
}
