import { ExecutionContext, Injectable } from '@nestjs/common';
import { GqlExecutionContext } from '@nestjs/graphql';
import { ThrottlerGuard } from '@nestjs/throttler';

/**
 * Adaptador del ThrottlerGuard estándar de Nest para extraer `req`/`res`
 * del contexto Apollo cuando se aplica como APP_GUARD global a resolvers
 * GraphQL.
 */
@Injectable()
export class GqlThrottlerGuard extends ThrottlerGuard {
  override getRequestResponse(context: ExecutionContext): {
    req: Record<string, unknown>;
    res: Record<string, unknown>;
  } {
    const gqlCtx = GqlExecutionContext.create(context);
    const ctx = gqlCtx.getContext();

    return {
      req: ctx.req ?? {},
      res: ctx.res ?? {},
    };
  }
}
