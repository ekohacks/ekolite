import { MethodFn } from '../../shared/types.ts';

export class Methods {
  private methods = new Map<string, MethodFn>();

  define(name: string, fn: MethodFn): void {
    if (this.methods.has(name)) {
      throw new Error(`Method already defined: ${name}`);
    }
    this.methods.set(name, fn);
  }

  async call(name: string, args: unknown[]): Promise<unknown> {
    const method = this.methods.get(name);
    if (!method) {
      throw new Error(`Method not found: ${name}`);
    }
    return method(...args);
  }
}
