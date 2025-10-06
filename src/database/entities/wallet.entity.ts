import { 
  Entity, 
  PrimaryGeneratedColumn, 
  Column, 
  CreateDateColumn, 
  UpdateDateColumn,
  Index 
} from 'typeorm';

@Entity('wallets')
export class WalletEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index({ unique: true })
  @Column('varchar')
  address!: string;

  @Column('decimal', { precision: 20, scale: 10, default: 0 })
  totalProfitUsd!: number;

  @Column('decimal', { precision: 20, scale: 10, default: 0 })
  totalLossUsd!: number;

  @Column('int', { default: 0 })
  totalTrades!: number;

  @Column('int', { default: 0 })
  successfulTrades!: number;

  @Column('jsonb', { nullable: true })
  tokenBalances!: Record<string, string>;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
