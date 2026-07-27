import type { Config, ServiceName } from "./config.js";
import {
  classifyGraphQLErrors,
  HeropostAuthError,
  HeropostTransportError,
  type GraphQLErrorLike,
} from "./errors.js";
import type { TokenProvider } from "./auth/provider.js";

export interface GraphQLRequest {
  service: ServiceName;
  /** Operation name, used only for error messages and logs. */
  operation: string;
  document: string;
  variables?: Record<string, unknown>;
}

interface GraphQLResponse<T> {
  data?: T | null;
  errors?: GraphQLErrorLike[];
}

/**
 * Talks to whichever Heropost GraphQL service an operation belongs to. Knows nothing
 * about tools; tools know nothing about transport.
 */
export class HeropostClient {
  constructor(
    private readonly config: Config,
    private readonly tokens: TokenProvider,
  ) {}

  async request<T>(req: GraphQLRequest): Promise<T> {
    try {
      return await this.send<T>(req, await this.tokens.getAccessToken());
    } catch (err) {
      // An expired access token is the common case, and it's recoverable when a refresh
      // token is configured: drop the cached token and give it exactly one more try. With a
      // pasted token there is nothing to renew, so retrying would just repeat the failure.
      if (err instanceof HeropostAuthError && this.tokens.canRenew && !this.retriedFor(req)) {
        this.tokens.invalidate();
        this.markRetried(req);
        try {
          return await this.send<T>(req, await this.tokens.getAccessToken());
        } finally {
          this.clearRetried(req);
        }
      }
      throw err;
    }
  }

  private retries = new Set<string>();
  private key(req: GraphQLRequest): string {
    return `${req.service}:${req.operation}`;
  }
  private retriedFor(req: GraphQLRequest): boolean {
    return this.retries.has(this.key(req));
  }
  private markRetried(req: GraphQLRequest): void {
    this.retries.add(this.key(req));
  }
  private clearRetried(req: GraphQLRequest): void {
    this.retries.delete(this.key(req));
  }

  private async send<T>(req: GraphQLRequest, token: string): Promise<T> {
    const endpoint = this.config.endpoints[req.service];

    let res: Response;
    try {
      res = await fetch(endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          query: req.document,
          ...(req.variables ? { variables: req.variables } : {}),
        }),
        signal: AbortSignal.timeout(this.config.timeoutMs),
      });
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      throw new HeropostTransportError(
        `Could not reach the Heropost "${req.service}" API at ${endpoint}: ${reason}`,
        { service: req.service, operation: req.operation },
      );
    }

    const text = await res.text();
    let body: GraphQLResponse<T>;
    try {
      body = JSON.parse(text) as GraphQLResponse<T>;
    } catch {
      // A non-JSON body means we hit something other than the GraphQL endpoint —
      // a proxy error page, or an HTML login redirect.
      throw new HeropostTransportError(
        `The Heropost "${req.service}" API returned a non-JSON response ` +
          `(HTTP ${res.status}) for ${req.operation}: ${text.slice(0, 200)}`,
        { service: req.service, operation: req.operation },
      );
    }

    if (body.errors?.length) {
      throw classifyGraphQLErrors(body.errors, {
        service: req.service,
        operation: req.operation,
      });
    }

    if (body.data === undefined || body.data === null) {
      throw new HeropostTransportError(
        `The Heropost "${req.service}" API returned no data for ${req.operation}.`,
        { service: req.service, operation: req.operation },
      );
    }

    return body.data;
  }

  /** Resolve a workspace id, falling back to HEROPOST_WORKSPACE_ID. */
  workspaceId(explicit?: number): number {
    const id = explicit ?? this.config.defaultWorkspaceId;
    if (id === undefined) {
      throw new HeropostTransportError(
        "No workspace specified. Pass workspaceId, or set HEROPOST_WORKSPACE_ID to a " +
          "default (use heropost_list_workspaces to find the id).",
      );
    }
    return id;
  }

  get readOnly(): boolean {
    return this.config.readOnly;
  }

  /** Directory that media uploads are confined to, if configured. */
  get mediaRoot(): string | undefined {
    return this.config.mediaRoot;
  }
}
