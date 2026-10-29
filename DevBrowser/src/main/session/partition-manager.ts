import { session } from 'electron';
import type { ProfilePartition } from '../../shared/domain/browser';

export class PartitionManager {
  private partitions: Map<string, ProfilePartition> = new Map();

  constructor() {
    this.initializeDefaultPartitions();
  }

  private initializeDefaultPartitions(): void {
    const defaults: ProfilePartition[] = [
      {
        id: '11111111-1111-4111-a111-111111111111',
        name: 'Default Developer',
        partitionKey: 'persist:dev-default',
        color: '#3b82f6', // Blue
        isEphemeral: false,
        createdAt: Date.now()
      },
      {
        id: '22222222-2222-4222-a222-222222222222',
        name: 'Admin Role',
        partitionKey: 'persist:dev-admin',
        color: '#ef4444', // Red
        isEphemeral: false,
        createdAt: Date.now()
      },
      {
        id: '33333333-3333-4333-a333-333333333333',
        name: 'Ephemeral / Incognito',
        partitionKey: 'temp:dev-ephemeral',
        color: '#10b981', // Emerald
        isEphemeral: true,
        createdAt: Date.now()
      }
    ];

    for (const p of defaults) {
      this.partitions.set(p.partitionKey, p);
      // Ensure Electron session is initialized for the partition
      session.fromPartition(p.partitionKey);
    }
  }

  public getPartitions(): ProfilePartition[] {
    return Array.from(this.partitions.values());
  }

  public getPartition(partitionKey: string): ProfilePartition | undefined {
    return this.partitions.get(partitionKey);
  }
}
