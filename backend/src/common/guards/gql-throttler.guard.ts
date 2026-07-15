import { ExecutionContext, Injectable } from '@nestjs/common';
import { GqlExecutionContext } from '@nestjs/graphql';
import { ThrottlerGuard } from '@nestjs/throttler';

/**
 * Adaptador del ThrottlerGuard estándar de Nest para que pueda extraer
 * el `req`/`res` del contexto de Apollo GraphQL.
 *
 * Sin este guard, cuando el APP_GUARD global de ThrottlerGuard se aplica
 * a un resolver GraphQL, `getRequestResponse` recibe el contexto de
 * Apollo (no Express) y devuelve `undefined`, dejando el rate-limit
 * inefectivo.
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
