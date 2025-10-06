"use strict";
// Bridge re-export so imports from "../risk/riskManager" work across the repo.
// The canonical implementation is in ./Manager.ts which exports RiskManager and getRiskManager.
// Re-export both so older import paths continue to function.
Object.defineProperty(exports, "__esModule", { value: true });
exports.getRiskManager = exports.RiskManager = void 0;
var Manager_1 = require("./Manager");
Object.defineProperty(exports, "RiskManager", { enumerable: true, get: function () { return Manager_1.RiskManager; } });
Object.defineProperty(exports, "getRiskManager", { enumerable: true, get: function () { return Manager_1.getRiskManager; } });
exports.default = getRiskManager;
//# sourceMappingURL=riskManager.js.map