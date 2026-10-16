import { ApiProperty } from '@nestjs/swagger';

/** GET /v1/meta/egress, for the API docs. The controller declares it as its return type. */
export class EgressDto {
  @ApiProperty({
    description: 'The address to allow in the firewall. Empty when not configured.',
  })
  egressIp!: string;

  @ApiProperty({
    description: 'SQL the customer runs as an admin to create a read-only login.',
  })
  setupSql!: string;

  @ApiProperty()
  firewall!: string;
}
