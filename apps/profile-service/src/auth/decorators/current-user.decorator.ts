import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import {
  GrpcAuthenticatedUser,
  RequestWithUser,
} from '../guards/grpc-auth.guard';

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): GrpcAuthenticatedUser => {
    const request = ctx.switchToHttp().getRequest<RequestWithUser>();
    return request.user;
  },
);
