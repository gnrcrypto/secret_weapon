import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';

@Entity('trades')
@Index(['createdAt', 'isSuccessful'])
@Index(['pathType', 'createdAt'])
@Index(['netProfitUsd'])
export class TradeEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // Path information
  @Column({ type: 'varchar', length: 20 })
  pathType: 'triangular' | 'cross-dex';

  @Column({ type: 'simple-array' })
  tokens: string[];

  @Column({ type: 'simple-array' })
  dexes: string[];

  @Column({ type: 'decimal', precision: 36, scale: 18 })
  inputAmount: string;

  @Column({ type: 'decimal', precision: 36, scale: 18 })
  outputAmount: string;

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  netProfitUsd: number;

  @Column({ type: 'decimal', precision: 5, scale: 2 })
  priceImpact: number;

  @Column({ type: 'decimal', precision: 5, scale: 2 })
  slippage: number;

  @Column({ type: 'decimal', precision: 5, scale: 2 })
  confidence: number;

  @Column({ type: 'boolean', default: false })
  isSuccessful: boolean;

  // Transaction details
  @Column({ type: 'varchar', length: 66, nullable: true })
  transactionHash: string;

  @Column({ type: 'bigint', nullable: true })
  blockNumber: string;

  @Column({ type: 'decimal', precision: 36, scale: 18, nullable: true })
  gasUsed: string;

  @Column({ type: 'decimal', precision: 36, scale: 18, nullable: true })
  gasPrice: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
