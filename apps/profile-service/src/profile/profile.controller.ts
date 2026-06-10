import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import { ProfileService } from './profile.service';
import {
  type GrpcAuthenticatedUser,
  GrpcAuthGuard,
} from '../auth/guards/grpc-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { UpdateProfileDto } from './dto/update-profile.dto';

@Controller('profile')
@UseGuards(GrpcAuthGuard) // every route validates token via gRPC call to auth-service
export class ProfileController {
  constructor(private profileService: ProfileService) {}

  @Get()
  getProfile(@CurrentUser() user: GrpcAuthenticatedUser) {
    return this.profileService.getProfile(user.userId!);
  }

  @Patch()
  updateProfile(
    @CurrentUser() user: GrpcAuthenticatedUser,
    @Body() dto: UpdateProfileDto,
  ) {
    return this.profileService.updateProfile(user.userId!, dto);
  }
}
