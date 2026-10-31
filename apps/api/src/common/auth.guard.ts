import { type CanActivate, type ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import { config } from '../config.js';

/**
 * Optional bearer-token protection. Disabled when API_TOKEN is empty (default
 * for a local install). `?token=` is accepted too so <img> tags and
 * EventSource (which can't set headers) keep working.
 */
@Injectable()
export class ApiTokenGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    if (!config.apiToken) return true;
    const req = ctx.switchToHttp().getRequest<Request>();
    if (req.path.endsWith('/health')) return true;
    const header = req.headers.authorization?.replace(/^Bearer\s+/i, '');
    const token = header || (typeof req.query.token === 'string' ? req.query.token : undefined);
    if (token !== config.apiToken) throw new UnauthorizedException('Missing or invalid API token');
    return true;
  }
}
