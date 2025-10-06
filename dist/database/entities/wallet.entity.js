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
exports.WalletEntity = void 0;
const typeorm_1 = require("typeorm");
let WalletEntity = class WalletEntity {
    id;
    address;
    totalProfitUsd;
    totalLossUsd;
    totalTrades;
    successfulTrades;
    tokenBalances;
    createdAt;
    updatedAt;
};
exports.WalletEntity = WalletEntity;
__decorate([
    (0, typeorm_1.PrimaryGeneratedColumn)('uuid'),
    __metadata("design:type", String)
], WalletEntity.prototype, "id", void 0);
__decorate([
    (0, typeorm_1.Index)({ unique: true }),
    (0, typeorm_1.Column)('varchar'),
    __metadata("design:type", String)
], WalletEntity.prototype, "address", void 0);
__decorate([
    (0, typeorm_1.Column)('decimal', { precision: 20, scale: 10, default: 0 }),
    __metadata("design:type", Number)
], WalletEntity.prototype, "totalProfitUsd", void 0);
__decorate([
    (0, typeorm_1.Column)('decimal', { precision: 20, scale: 10, default: 0 }),
    __metadata("design:type", Number)
], WalletEntity.prototype, "totalLossUsd", void 0);
__decorate([
    (0, typeorm_1.Column)('int', { default: 0 }),
    __metadata("design:type", Number)
], WalletEntity.prototype, "totalTrades", void 0);
__decorate([
    (0, typeorm_1.Column)('int', { default: 0 }),
    __metadata("design:type", Number)
], WalletEntity.prototype, "successfulTrades", void 0);
__decorate([
    (0, typeorm_1.Column)('jsonb', { nullable: true }),
    __metadata("design:type", Object)
], WalletEntity.prototype, "tokenBalances", void 0);
__decorate([
    (0, typeorm_1.CreateDateColumn)(),
    __metadata("design:type", Date)
], WalletEntity.prototype, "createdAt", void 0);
__decorate([
    (0, typeorm_1.UpdateDateColumn)(),
    __metadata("design:type", Date)
], WalletEntity.prototype, "updatedAt", void 0);
exports.WalletEntity = WalletEntity = __decorate([
    (0, typeorm_1.Entity)('wallets')
], WalletEntity);
//# sourceMappingURL=wallet.entity.js.map