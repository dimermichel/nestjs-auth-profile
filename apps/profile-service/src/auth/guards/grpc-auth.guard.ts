import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Request } from 'express';
import { AuthClient } from 'src/clients/auth.client';

export interface GrpcAuthenticatedUser {
  valid: boolean;
  userId: string;
  email: string;
  error: string;
}

export interface RequestWithUser extends Request {
  user: GrpcAuthenticatedUser;
}

@Injectable()
export class GrpcAuthGuard implements CanActivate {
  constructor(private authClient: AuthClient) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RequestWithUser>();
    const authHeader = request.headers['authorization'];

    if (!authHeader) {
      throw new UnauthorizedException('No token provided');
    }

    const [bearer, token] = authHeader.split(' ');

    if (bearer !== 'Bearer' || !token) {
      throw new UnauthorizedException('Invalid token format');
    }

    try {
      const user = await this.authClient.validateToken(token);
      request.user = user;
      return true;
    } catch (error) {
      throw new UnauthorizedException('Invalid or expired token');
    }
  }
}
