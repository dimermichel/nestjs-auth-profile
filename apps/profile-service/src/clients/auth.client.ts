import {
  OnModuleInit,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { Injectable } from '@nestjs/common';
import { Client, type ClientGrpc, Transport } from '@nestjs/microservices';
import { join } from 'path';
import { firstValueFrom, Observable } from 'rxjs';
import { CircuitBreaker } from 'src/common/circuit-breaker';

interface AuthGrpcService {
  validateToken(data: { token: string }): Observable<{
    valid: boolean;
    userId: string;
    email: string;
    error: string;
  }>;
}

@Injectable()
export class AuthClient implements OnModuleInit {
  @Client({
    transport: Transport.GRPC,
    options: {
      package: 'auth',
      protoPath: join(process.cwd(), '../../libs/shared/src/proto/auth.proto'),
      url: process.env.AUTH_SERVICE_GRPC_URL || 'localhost:5001',
    },
  })
  private client!: ClientGrpc;

  private authService!: AuthGrpcService;

  // Only gRPC transport errors (UNAVAILABLE, INTERNAL, DEADLINE_EXCEEDED, etc.)
  // should trip the breaker — not application-level rejections (UNAUTHENTICATED=16).
  private circuitBreaker = new CircuitBreaker(5, 30000, (error) => {
    const code = (error as { code?: number })?.code;
    return code !== 16; // 16 = gRPC UNAUTHENTICATED — application error, not infra
  });

  onModuleInit() {
    this.authService = this.client.getService<AuthGrpcService>('AuthService');
  }

  async validateToken(token: string) {
    let result: {
      valid: boolean;
      userId: string;
      email: string;
      error: string;
    };

    try {
      result = await this.circuitBreaker.execute(() =>
        firstValueFrom(this.authService.validateToken({ token })),
      );
    } catch (error) {
      if (
        error instanceof Error &&
        error.message === 'Circuit breaker is open'
      ) {
        throw new ServiceUnavailableException(
          'Auth service temporarily unavailable',
        );
      }
      throw new UnauthorizedException('Token validation failed');
    }

    if (!result.valid) {
      throw new UnauthorizedException(
        `Token validation failed: ${result.error}`,
      );
    }
    return result;
  }
}
