import { BaseEntity, Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity()
export class Bet extends BaseEntity {
  @PrimaryGeneratedColumn()
  public id!: number;

  @Column({ type: 'integer' })
  public userId!: number;

  @Column({ type: 'integer' })
  public jackpotId!: number;

  @Column({ type: 'integer' })
  public bet!: number;

  /** won , slip */
  @Column({ type: 'varchar' })
  public status!: string;
}
