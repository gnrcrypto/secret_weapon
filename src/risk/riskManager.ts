// Bridge re-export so imports from "../risk/riskManager" work across the repo.
// The canonical implementation is in ./Manager.ts which exports RiskManager and getRiskManager.
// Re-export both so older import paths continue to function.

export { RiskManager, getRiskManager } from './Manager';
export default getRiskManager;
