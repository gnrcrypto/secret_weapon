import { 
  Entity, 
  PrimaryGeneratedColumn, 
  Column, 
  CreateDateColumn, 
  UpdateDateColumn,
  Index 
} from 'typeorm';

@Entity('tokens')
export class TokenEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index({ unique: true })
  @Column('varchar')
  address!: string;

  @Column('varchar')
  symbol!: string;

  @Column('varchar')
  name!: string;

  @Column('int')
  decimals!: number;

  @Column('decimal', { precision: 20, scale: 10, nullable: true })
  priceUsd?: number;

  @Column('decimal', { precision: 20, scale: 10, default: 0 })
  totalTradeVolume!: number;

  @Column('decimal', { precision: 20, scale: 10, default: 0 })
  totalProfitGenerated!: number;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
