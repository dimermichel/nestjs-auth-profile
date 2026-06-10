import {
  ConflictException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { eq } from 'drizzle-orm';
import { db } from 'src/db';
import { users } from 'src/db/schema';
import { RegisterDto } from 'src/dto/register.dto';
import { LoginDto } from 'src/dto/login.dto';
import { AuthenticatedUser } from 'src/decorators/current-user.decorator';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(private jwtService: JwtService) {}

  async register(registerDto: RegisterDto) {
    const { email, password } = registerDto;
    this.logger.log(`register: attempting for email="${email}"`);

    const [existing] = await db
      .select()
      .from(users)
      .where(eq(users.email, email));

    if (existing) {
      this.logger.warn(`register: conflict — email already in use: "${email}"`);
      throw new ConflictException('Email already in use');
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const [user] = await db
      .insert(users)
      .values({
        email,
        password: hashedPassword,
      })
      .returning();

    this.logger.log(`register: success — user created with id=${user.id}`);
    return {
      user: this.sanitizeUser(user),
      token: this.generateToken(user),
    };
  }

  private generateToken(user: typeof users.$inferSelect) {
    const payload = { sub: user.id, email: user.email };
    return this.jwtService.sign(payload, {
      secret: process.env.JWT_SECRET,
    });
  }

  private sanitizeUser(user: typeof users.$inferSelect) {
    const { password, ...safe } = user;
    return safe;
  }

  async login(loginDto: LoginDto) {
    const { email, password } = loginDto;
    this.logger.log(`login: attempting for email="${email}"`);

    const user = await db.query.users.findFirst({
      where: eq(users.email, email),
    });

    if (!user) {
      this.logger.warn(`login: failed — no user found for email="${email}"`);
      throw new UnauthorizedException('Invalid credentials');
    }

    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      this.logger.warn(`login: failed — invalid password for email="${email}"`);
      throw new UnauthorizedException('Invalid credentials');
    }

    this.logger.log(`login: success — user id=${user.id}`);
    return {
      user: this.sanitizeUser(user),
      token: this.generateToken(user),
    };
  }

  async validateToken(token: string) {
    try {
      const payload = await this.jwtService.verifyAsync<AuthenticatedUser>(
        token,
        {
          secret: process.env.JWT_SECRET!,
        },
      );
      this.logger.log(`validateToken: valid — userId=${payload.sub}`);
      return {
        valid: true,
        userId: payload.sub,
        email: payload.email,
        error: '',
      };
    } catch (error) {
      this.logger.warn(
        `validateToken: invalid or expired token — ${error instanceof Error ? error.message : error}`,
      );
      return {
        valid: false,
        userId: null,
        email: null,
        error: 'Invalid or expired token',
      };
    }
  }
}
