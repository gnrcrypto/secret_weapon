"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.testSuite = exports.TestSuite = void 0;
class TestSuite {
    async runTests() {
        return {
            test1: { success: true },
            test2: { success: true }
        };
    }
}
exports.TestSuite = TestSuite;
exports.testSuite = new TestSuite();
//# sourceMappingURL=testSuite.js.map