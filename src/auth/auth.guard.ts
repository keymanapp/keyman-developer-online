/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';

import { Observable } from 'rxjs';

@Injectable()
export class AuthGuard implements CanActivate {
  canActivate(
    context: ExecutionContext,
  ): boolean | Promise<boolean> | Observable<boolean> {
    const request = context.switchToHttp().getRequest();
    if (request.url.startsWith('/api/auth/login') ||
      (request.session.login && request.headers.authorization) ||
      (request.url.startsWith('/api/auth/user') && request.headers.authorization)) {
      return true;
    }
    throw new UnauthorizedException();
  }
}
