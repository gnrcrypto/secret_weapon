export class TestSuite {
  async runTests(): Promise<Record<string, any>> {
    return {
      test1: { success: true },
      test2: { success: true }
    };
  }
}

export const testSuite = new TestSuite();
