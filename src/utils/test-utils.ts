/* eslint-disable @typescript-eslint/explicit-module-boundary-types */
function evaluateCondition(condition): any {
  return typeof condition === 'function' ? condition() : !!condition;
}

// Skip the tests if condition is not met. If the tests are skipped it
// adds a new (green-baring test) to make it explicit why the tests
// are skipped (unfortunately Jest doesn't allow to specify a message
// why a test is skipped).
export function describeIf(name: string, condition: any, tests: any): void {
  if (evaluateCondition(condition)) {
    describe(name, tests);
  } else {
    describe(name, () => {
      it(`skipped '${name}' because condition doesn't apply`, () => { /* empty */ });
    });
    describe.skip('', tests);
  }
}

// Skip this test if the condition is not met
export function itIf(name: string, condition: any, test: any): void {
  if (evaluateCondition(condition)) {
    return it(name, test);
  } else {
    return it.skip(name, test);
  }
}
