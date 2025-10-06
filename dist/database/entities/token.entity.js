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
exports.TokenEntity = void 0;
const typeorm_1 = require("typeorm");
let TokenEntity = class TokenEntity {
    id;
    address;
    symbol;
    name;
    decimals;
    priceUsd;
    totalTradeVolume;
    totalProfitGenerated;
    createdAt;
    updatedAt;
};
exports.TokenEntity = TokenEntity;
__decorate([
    (0, typeorm_1.PrimaryGeneratedColumn)('uuid'),
    __metadata("design:type", String)
], TokenEntity.prototype, "id", void 0);
__decorate([
    (0, typeorm_1.Index)({ unique: true }),
    (0, typeorm_1.Column)('varchar'),
    __metadata("design:type", String)
], TokenEntity.prototype, "address", void 0);
__decorate([
    (0, typeorm_1.Column)('varchar'),
    __metadata("design:type", String)
], TokenEntity.prototype, "symbol", void 0);
__decorate([
    (0, typeorm_1.Column)('varchar'),
    __metadata("design:type", String)
], TokenEntity.prototype, "name", void 0);
__decorate([
    (0, typeorm_1.Column)('int'),
    __metadata("design:type", Number)
], TokenEntity.prototype, "decimals", void 0);
__decorate([
    (0, typeorm_1.Column)('decimal', { precision: 20, scale: 10, nullable: true }),
    __metadata("design:type", Number)
], TokenEntity.prototype, "priceUsd", void 0);
__decorate([
    (0, typeorm_1.Column)('decimal', { precision: 20, scale: 10, default: 0 }),
    __metadata("design:type", Number)
], TokenEntity.prototype, "totalTradeVolume", void 0);
__decorate([
    (0, typeorm_1.Column)('decimal', { precision: 20, scale: 10, default: 0 }),
    __metadata("design:type", Number)
], TokenEntity.prototype, "totalProfitGenerated", void 0);
__decorate([
    (0, typeorm_1.CreateDateColumn)(),
    __metadata("design:type", Date)
], TokenEntity.prototype, "createdAt", void 0);
__decorate([
    (0, typeorm_1.UpdateDateColumn)(),
    __metadata("design:type", Date)
], TokenEntity.prototype, "updatedAt", void 0);
exports.TokenEntity = TokenEntity = __decorate([
    (0, typeorm_1.Entity)('tokens')
], TokenEntity);
//# sourceMappingURL=token.entity.js.map