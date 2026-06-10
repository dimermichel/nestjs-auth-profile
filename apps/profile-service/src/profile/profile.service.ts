import { Injectable, Logger } from '@nestjs/common';

import { db } from '../db';
import { profiles } from '../db/schema';
import { UpdateProfileDto } from './dto/update-profile.dto';

@Injectable()
export class ProfileService {
  private readonly logger = new Logger(ProfileService.name);

  async getProfile(userId: string) {
    this.logger.log(`Fetching profile for user ${userId}`);

    const [profile] = await db
      .insert(profiles)
      .values({ userId })
      .onConflictDoUpdate({ target: profiles.userId, set: { userId } })
      .returning();

    return profile;
  }

  async updateProfile(userId: string, dto: UpdateProfileDto) {
    this.logger.log(`Updating profile for user ${userId}`);

    const [profile] = await db
      .insert(profiles)
      .values({ userId, ...dto })
      .onConflictDoUpdate({
        target: profiles.userId,
        set: { ...dto, updatedAt: new Date() },
      })
      .returning();

    return profile;
  }
}
