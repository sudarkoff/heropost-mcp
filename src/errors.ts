/**
 * Heropost runs graphql-dotnet / HotChocolate. Its errors arrive as a 200 response with
 * an `errors` array, so HTTP status alone tells us almost nothing — we classify on the
 * payload. The shapes here were observed against the live API, not guessed.
 */

export interface GraphQLErrorLike {
  message: string;
  path?: (string | number)[];
  extensions?: {
    code?: string;
    codes?: string[];
    number?: string;
    [key: string]: unknown;
  };
}

export class HeropostError extends Error {
  override readonly name: string = "HeropostError";
  constructor(
    message: string,
    readonly detail?: { service?: string; operation?: string; errors?: GraphQLErrorLike[] },
  ) {
    super(message);
  }
}

/** Token missing, expired, or lacking the scope for this service. */
export class HeropostAuthError extends HeropostError {
  override readonly name = "HeropostAuthError";
}

export class HeropostRateLimitError extends HeropostError {
  override readonly name = "HeropostRateLimitError";
}

/** The request was understood but rejected — bad ids, invalid input, plan limits. */
export class HeropostRequestError extends HeropostError {
  override readonly name = "HeropostRequestError";
}

/** Transport-level failure: DNS, TLS, timeout, non-JSON body. */
export class HeropostTransportError extends HeropostError {
  override readonly name = "HeropostTransportError";
}

function codesOf(errors: GraphQLErrorLike[]): string[] {
  return errors.flatMap((e) => [
    ...(e.extensions?.code ? [e.extensions.code] : []),
    ...(e.extensions?.codes ?? []),
  ]);
}

export function isAuthErrorPayload(errors: GraphQLErrorLike[]): boolean {
  if (codesOf(errors).some((c) => c.toLowerCase() === "authorization")) return true;
  // Fallback for services that only set a message: the observed text is
  // "You are not authorized to run this query.\nThe current user must be authenticated."
  return errors.some((e) => /not authorized|must be authenticated/i.test(e.message));
}

/**
 * Turn a GraphQL `errors` array into the most specific error class we can justify,
 * with a message that says what to do about it rather than just what went wrong.
 */
export function classifyGraphQLErrors(
  errors: GraphQLErrorLike[],
  context: { service: string; operation: string },
): HeropostError {
  const detail = { ...context, errors };
  const summary = errors.map((e) => e.message).join("; ");

  if (isAuthErrorPayload(errors)) {
    return new HeropostAuthError(
      `Heropost rejected the credential for the "${context.service}" API (${context.operation}). ` +
        `The token is missing, expired, or lacks the required scope ` +
        `(${context.service}_api.full). If you set HEROPOST_ACCESS_TOKEN by hand it has ` +
        `likely expired — set HEROPOST_REFRESH_TOKEN instead so it renews automatically. ` +
        `Underlying error: ${summary}`,
      detail,
    );
  }

  if (codesOf(errors).some((c) => /rate.?limit|too.?many/i.test(c)) || /rate limit/i.test(summary)) {
    return new HeropostRateLimitError(
      `Heropost rate-limited ${context.operation}. Retry in a moment. ${summary}`,
      detail,
    );
  }

  return new HeropostRequestError(
    `Heropost rejected ${context.operation} on the "${context.service}" API: ${summary}`,
    detail,
  );
}

/** Collapse any thrown value into a single line suitable for an MCP tool error. */
export function toMessage(err: unknown): string {
  if (err instanceof HeropostError) return err.message;
  if (err instanceof Error) return `${err.name}: ${err.message}`;
  return String(err);
}
