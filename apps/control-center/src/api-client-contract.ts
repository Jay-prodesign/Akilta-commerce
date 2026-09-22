import type { ErrorCode, RequestId } from '../../../packages/domain/src';
import type { RequiredAction } from '../../api/src/transport-contracts';

export type ApiResult<T> =
  | { readonly ok: true; readonly requestId: RequestId; readonly data: T }
  | {
      readonly ok: false;
      readonly requestId: RequestId;
      readonly code: ErrorCode;
      readonly safeMessage: string;
      readonly retryable: boolean;
      readonly requiredAction: RequiredAction;
    };

/** Browser client contract. It carries no provider tokens/secrets and never creates authority. */
export interface ControlCenterApiClient {
  get<T>(path: string): Promise<ApiResult<T>>;
  post<TResponse, TBody extends Readonly<Record<string, unknown>>>(
    path: string,
    body: TBody,
    idempotencyKey?: string,
  ): Promise<ApiResult<TResponse>>;
}
