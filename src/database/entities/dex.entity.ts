import { 
  Entity, 
  PrimaryGeneratedColumn, 
  Column, 
  CreateDateColumn, 
  UpdateDateColumn,
  Index 
} from 'typeorm';

@Entity('dexes')
export class DexEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index({ unique: true })
  @Column('varchar')
  name!: string;

  @Column('varchar')
  protocol!: string;

  @Column('decimal', { precision: 20, scale: 10, default: 0 })
  totalTradeVolume!: number;

  @Column('decimal', { precision: 20, scale: 10, default: 0 })
  totalProfitGenerated!: number;

  @Column('int', { default: 0 })
  totalTrades!: number;

  @Column('decimal', { precision: 10, scale: 4, default: 0 })
  averagePriceImpact!: number;

  @Column('jsonb', { nullable: true })
  liquidityPools!: Array<{
    token0: string;
    token1: string;
    liquidity: string;
  }>;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
