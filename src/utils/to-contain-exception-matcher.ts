import { HttpException } from '@nestjs/common';

// ensure this is parsed as a module.
export {};

// https://stackoverflow.com/questions/43667085/extending-third-party-module-that-is-globally-exposed

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace jest {
    interface Matchers<R> {
      toContainException: (expected: R | any) => { return: any; };
    }
  }
}

function getStatus(obj: any): number {
  if (obj.getStatus) {
    return obj.getStatus();
  }
  return null;
}

// this will extend the expect with a custom matcher
expect.extend({
  toContainException<T extends HttpException>(received: T, expected: T) {
    const success =
      this.equals(received.message, expected.message) &&
      this.equals(getStatus(received), getStatus(expected));

    const not = success ? ' not' : '';
    return {
      message: (): string =>
        `expected Exception ${received.name}${not} to be ${expected.name}` +
        '\n\n' +
        `Expected: ${this.utils.printExpected(expected.message)}, ` +
        `status: ${this.utils.printExpected(getStatus(expected))} \n` +
        `Received: ${this.utils.printReceived(received.message)}, ` +
        `status: ${this.utils.printReceived(getStatus(received))}`,
      pass: success,
    };
  },
});
