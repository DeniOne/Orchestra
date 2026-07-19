import { IsString, IsNotEmpty, MaxLength } from 'class-validator';

export class OverrideGateDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  reason!: string;
}
