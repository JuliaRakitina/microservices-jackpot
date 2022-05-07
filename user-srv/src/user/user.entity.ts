import { BaseEntity, Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity()
export class User extends BaseEntity {
  @PrimaryGeneratedColumn()
  public id!: number;

  @Column({ type: 'integer' })
  public userId!: number;

  @Column({ type: 'varchar' })
  public email!: string;

  @Column({ type: 'varchar' })
  public role!: string;

  @Column({
    type: 'integer',
    nullable: true,
    default: 0,
  })
  public balance?: number;
}
