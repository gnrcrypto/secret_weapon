"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.TradeEntity = void 0;
const typeorm_1 = require("typeorm");
let TradeEntity = class TradeEntity {
    id;
    // Path information
    pathType; // Added 'flash-arb'
    tokens;
    dexes;
    inputAmount;
    outputAmount;
    netProfitUsd;
    priceImpact;
    slippage;
    confidence;
    isSuccessful;
    // Transaction details
    transactionHash;
    blockNumber;
    gasUsed;
    gasPrice;
    createdAt;
    updatedAt;
};
exports.TradeEntity = TradeEntity;
__decorate([
    (0, typeorm_1.PrimaryGeneratedColumn)('uuid'),
    __metadata("design:type", String)
], TradeEntity.prototype, "id", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', length: 20 }),
    __metadata("design:type", String)
], TradeEntity.prototype, "pathType", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'simple-array' }),
    __metadata("design:type", Array)
], TradeEntity.prototype, "tokens", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'simple-array' }),
    __metadata("design:type", Array)
], TradeEntity.prototype, "dexes", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'decimal', precision: 36, scale: 18 }),
    __metadata("design:type", String)
], TradeEntity.prototype, "inputAmount", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'decimal', precision: 36, scale: 18 }),
    __metadata("design:type", String)
], TradeEntity.prototype, "outputAmount", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'decimal', precision: 10, scale: 2 }),
    __metadata("design:type", Number)
], TradeEntity.prototype, "netProfitUsd", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'decimal', precision: 5, scale: 2 }),
    __metadata("design:type", Number)
], TradeEntity.prototype, "priceImpact", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'decimal', precision: 5, scale: 2 }),
    __metadata("design:type", Number)
], TradeEntity.prototype, "slippage", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'decimal', precision: 5, scale: 2 }),
    __metadata("design:type", Number)
], TradeEntity.prototype, "confidence", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'boolean', default: false }),
    __metadata("design:type", Boolean)
], TradeEntity.prototype, "isSuccessful", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', length: 66, nullable: true }),
    __metadata("design:type", String)
], TradeEntity.prototype, "transactionHash", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'bigint', nullable: true }),
    __metadata("design:type", String)
], TradeEntity.prototype, "blockNumber", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'decimal', precision: 36, scale: 18, nullable: true }),
    __metadata("design:type", String)
], TradeEntity.prototype, "gasUsed", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'decimal', precision: 36, scale: 18, nullable: true }),
    __metadata("design:type", String)
], TradeEntity.prototype, "gasPrice", void 0);
__decorate([
    (0, typeorm_1.CreateDateColumn)(),
    __metadata("design:type", Date)
], TradeEntity.prototype, "createdAt", void 0);
__decorate([
    (0, typeorm_1.UpdateDateColumn)(),
    __metadata("design:type", Date)
], TradeEntity.prototype, "updatedAt", void 0);
exports.TradeEntity = TradeEntity = __decorate([
    (0, typeorm_1.Entity)('trades'),
    (0, typeorm_1.Index)(['createdAt', 'isSuccessful']),
    (0, typeorm_1.Index)(['pathType', 'createdAt']),
    (0, typeorm_1.Index)(['netProfitUsd'])
], TradeEntity);
//# sourceMappingURL=trade.entity.js.map