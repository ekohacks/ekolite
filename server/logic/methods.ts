export type MethodFn = (...args: string[]) => Promise<string>;

export class Methods {
  private methods = new Map<string, MethodFn>();

  define(name: string, fn: MethodFn): void {
    this.methods.set(name, fn);
  }

  async call(name: string, args: string[]): Promise<string> {
    const method = this.methods.get(name);
    if (!method) {
      throw new Error(`Method not found: ${name}`);
    }
    return method(...args);
  }
}
