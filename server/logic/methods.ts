export class Methods {
  private methods = new Map<string, (arg: string) => Promise<string>>();

  define(name: string, fn: (arg: string) => Promise<string>): void {
    this.methods.set(name, fn);
  }

  async call(name: string, args: string[]): Promise<string> {
    const method = this.methods.get(name);
    if (!method) {
      throw new Error(`Method not found: ${name}`);
    }
    return method(args[0]);
  }
}
