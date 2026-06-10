import { Module } from '@nestjs/common';
import { ProfileController } from './profile.controller';
import { ProfileService } from './profile.service';
import { AuthClient } from '../clients/auth.client';
import { GrpcAuthGuard } from '../auth/guards/grpc-auth.guard';

@Module({
  controllers: [ProfileController],
  providers: [ProfileService, AuthClient, GrpcAuthGuard],
})
export class ProfileModule {}
