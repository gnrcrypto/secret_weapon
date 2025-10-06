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
exports.DexEntity = void 0;
const typeorm_1 = require("typeorm");
let DexEntity = class DexEntity {
    id;
    name;
    protocol;
    totalTradeVolume;
    totalProfitGenerated;
    totalTrades;
    averagePriceImpact;
    liquidityPools;
    createdAt;
    updatedAt;
};
exports.DexEntity = DexEntity;
__decorate([
    (0, typeorm_1.PrimaryGeneratedColumn)('uuid'),
    __metadata("design:type", String)
], DexEntity.prototype, "id", void 0);
__decorate([
    (0, typeorm_1.Index)({ unique: true }),
    (0, typeorm_1.Column)('varchar'),
    __metadata("design:type", String)
], DexEntity.prototype, "name", void 0);
__decorate([
    (0, typeorm_1.Column)('varchar'),
    __metadata("design:type", String)
], DexEntity.prototype, "protocol", void 0);
__decorate([
    (0, typeorm_1.Column)('decimal', { precision: 20, scale: 10, default: 0 }),
    __metadata("design:type", Number)
], DexEntity.prototype, "totalTradeVolume", void 0);
__decorate([
    (0, typeorm_1.Column)('decimal', { precision: 20, scale: 10, default: 0 }),
    __metadata("design:type", Number)
], DexEntity.prototype, "totalProfitGenerated", void 0);
__decorate([
    (0, typeorm_1.Column)('int', { default: 0 }),
    __metadata("design:type", Number)
], DexEntity.prototype, "totalTrades", void 0);
__decorate([
    (0, typeorm_1.Column)('decimal', { precision: 10, scale: 4, default: 0 }),
    __metadata("design:type", Number)
], DexEntity.prototype, "averagePriceImpact", void 0);
__decorate([
    (0, typeorm_1.Column)('jsonb', { nullable: true }),
    __metadata("design:type", Array)
], DexEntity.prototype, "liquidityPools", void 0);
__decorate([
    (0, typeorm_1.CreateDateColumn)(),
    __metadata("design:type", Date)
], DexEntity.prototype, "createdAt", void 0);
__decorate([
    (0, typeorm_1.UpdateDateColumn)(),
    __metadata("design:type", Date)
], DexEntity.prototype, "updatedAt", void 0);
exports.DexEntity = DexEntity = __decorate([
    (0, typeorm_1.Entity)('dexes')
], DexEntity);
//# sourceMappingURL=dex.entity.js.map