import { Body, Controller, Get, Logger, Post, UseGuards } from '@nestjs/common';
import { GrpcMethod } from '@nestjs/microservices';
import { Public } from 'src/decorators/public.decorator';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from 'src/guards/jwt.guard';
import { RegisterDto } from 'src/dto/register.dto';
import { LoginDto } from 'src/dto/login.dto';
import {
  type AuthenticatedUser,
  CurrentUser,
} from 'src/decorators/current-user.decorator';

@Controller('auth')
@UseGuards(JwtAuthGuard)
export class AuthController {
  private readonly logger = new Logger(AuthController.name);

  constructor(private authService: AuthService) {}

  @Post('/register')
  @Public()
  register(@Body() registerDto: RegisterDto) {
    this.logger.log(
      `register called — body received: ${JSON.stringify({ email: registerDto?.email, passwordLength: registerDto?.password?.length ?? 'undefined' })}`,
    );
    return this.authService.register(registerDto);
  }

  @Post('/login')
  @Public()
  login(@Body() loginDto: LoginDto) {
    return this.authService.login(loginDto);
  }

  @Get('/me')
  me(@CurrentUser() user: AuthenticatedUser) {
    return user;
  }

  @GrpcMethod('AuthService', 'ValidateToken')
  async validateToken({ token }: { token: string }) {
    return this.authService.validateToken(token);
  }
}
