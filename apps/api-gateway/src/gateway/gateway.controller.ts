import { Controller, Req, Res, UseGuards, All } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { type Request, type Response } from 'express';
import axios from 'axios';
import { JwtGuard } from '../auth/guards/jwt.guard';
import { Public } from '../auth/decorators/public.decorator';

@Controller()
@UseGuards(ThrottlerGuard, JwtGuard)
export class GatewayController {
  @All('api/auth/register')
  @Public()
  proxyRegister(@Req() req: Request, @Res() res: Response) {
    return this.proxy(req, res, process.env.AUTH_SERVICE_URL!);
  }
  @All('api/auth/login')
  @Public()
  proxyLogin(@Req() req: Request, @Res() res: Response) {
    return this.proxy(req, res, process.env.AUTH_SERVICE_URL!);
  }

  // All other auth routes require a valid JWT token
  @All('api/auth/*')
  proxyAuth(@Req() req: Request, @Res() res: Response) {
    return this.proxy(req, res, process.env.AUTH_SERVICE_URL!);
  }

  // All profile routes require a valid JWT token
  @All('api/profile')
  @All('api/profile/*')
  proxyProfile(@Req() req: Request, @Res() res: Response) {
    return this.proxy(req, res, process.env.PROFILE_SERVICE_URL!);
  }

  private async proxy(req: Request, res: Response, targetUrl: string) {
    try {
      const url = `${targetUrl}${req.originalUrl}`;
      const response = await axios({
        method: req.method,
        url: url,
        headers: {
          ...req.headers,
          // Hop-by-hop and representation headers must be stripped: Express has
          // already parsed the body, and axios will re-serialize it, so the
          // original content-length and transfer-encoding no longer match.
          host: undefined,
          'content-length': undefined,
          'transfer-encoding': undefined,
          connection: undefined,
        },
        data: req.body,
      });
      res.status(response.status).json(response.data);
    } catch (error) {
      if (axios.isAxiosError(error) && error.response) {
        res.status(error.response.status).json(error.response.data);
      } else {
        res.status(500).json({ message: 'Internal server error' });
      }
    }
  }
}
