import { BaseEntity, Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity()
export class Jackpot extends BaseEntity {
  @PrimaryGeneratedColumn()
  public id!: number;

  @Column({ type: 'integer' })
  public amount!: number;

  @Column({ type: 'integer' })
  public seed!: number;

  @Column({ type: 'integer' })
  public hitBy!: number;

  @Column({ type: 'varchar' })
  public status!: string;
}
