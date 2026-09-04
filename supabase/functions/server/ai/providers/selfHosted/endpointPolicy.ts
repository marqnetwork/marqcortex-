/**
 * Self-hosted endpoint policy — AI-01 Batch 4E.
 *
 * THE ONE PLACE AN OPERATOR-SUPPLIED URL BECOMES DIALLABLE.
 *
 * Every other provider in this platform reaches a hostname written down in
 * reviewed code. A self-hosted provider does not: its endpoint arrives from
 * `cortex.ai_provider_configuration.configuration`, which is a column an
 * administrator writes. That makes the runtime a server-side request forgery
 * surface for the first time, and the 4C migration recorded it in as many
 * words:
 *
 *   "an unvalidated URL in a column the runtime dials is a server-side request
 *    forgery surface. Whoever adds that write path OWNS adding the validator."
 *
 * This is that validator, and it is deliberately separate from the adapter, the
 * definition parser and the registrar so it can be attacked on its own terms.
 *
 * IT FAILS CLOSED, ALWAYS. Every path that cannot establish safety returns a
 * rejection. There is no "probably fine", no warning-and-continue and no
 * default that admits a URL the parser did not fully understand.
 *
 * WHAT IT REFUSES, AND WHY EACH ONE IS SEPARATE:
 *
 *   scheme            Only `https`. `http` is admitted ONLY under the explicit
 *                     local-development exception, which also unlocks private
 *                     targets — the two belong together because either alone is
 *                     useless and either alone looks safe.
 *   credentials       `https://user:pass@host` puts key material in a column
 *                     that is not a credential store, and into every log line
 *                     that ever prints the endpoint.
 *   query / fragment  A base URL has no business carrying either, and a query
 *                     string is where an operator would paste `?api_key=...`.
 *   secret-shaped     A belt-and-braces scan for key-shaped text ANYWHERE in
 *                     the URL, because the query ban only closes the obvious
 *                     placement.
 *   loopback          127.0.0.0/8, ::1, `localhost` and friends reach the edge
 *                     runtime itself.
 *   private / CGNAT   RFC1918, 100.64/10, ULA and the rest reach whatever else
 *                     is on the deployment's network.
 *   link-local        169.254.0.0/16 and fe80::/10 — the family the cloud
 *                     metadata services live in.
 *   metadata          The specific well-known metadata addresses, named
 *                     separately so a rejection SAYS "metadata endpoint".
 *   malformed host    Anything that is not a clean DNS name or a literal.
 *   path tricks       Dot segments, encoded separators, backslashes, doubled
 *                     slashes — the shapes that turn `${base}/chat/completions`
 *                     into something else.
 *
 * ── WHAT IT CANNOT DO, STATED PLAINLY ──────────────────────────────────────
 *
 * THIS VALIDATES A URL, NOT A PACKET. Name resolution happens later, in the
 * runtime, and this module has no hook into it: the edge runtime offers no
 * socket-level callback and no resolver control. So a hostname that passes
 * every check here and RESOLVES to an internal address at dial time — DNS
 * rebinding, a split-horizon zone, an internal record on a public domain — is
 * not prevented at this layer, and cannot be.
 *
 * What the platform actually does about that, in order:
 *
 *   THIS FILE reduces the surface. Literal internal addresses, metadata hosts
 *   and malformed authorities never become dialleable at all, so an attacker
 *   must control DNS for a name that passes the grammar rather than simply
 *   typing an address.
 *
 *   HTTPS narrows it further. Outside the local-development exception the
 *   scheme must be `https` and the certificate is validated by the runtime, so
 *   the responder has to hold a valid certificate for the configured name.
 *
 *   THE ADAPTER'S REDIRECT REFUSAL closes the escape that made the rest
 *   negotiable. `selfHostedProvider.ts` sets `redirect: 'error'`, so a
 *   validated endpoint cannot hand the transport a second, unvalidated
 *   destination — and the one URL this module composes is the only one ever
 *   dialled, always by POST to `<base>/chat/completions`.
 *
 *   DEPLOYMENT-LEVEL EGRESS POLICY IS THE AUTHORITATIVE MITIGATION for
 *   internal network reachability. Whether the runtime can open a connection
 *   to an internal address at all is a property of the deployment's network,
 *   not of this validator, and it is where the control belongs.
 *
 * CERTIFICATION IS NOT A REBINDING CONTROL, and this comment used to imply it
 * was. Requiring a MARQ platform administrator to certify a provider governs
 * WHO may put an endpoint into service and leaves an audited reason for it; it
 * decides nothing about what a name resolves to afterwards. It is a governance
 * control, and reading it as a network one is how a gap gets left open.
 */

/** A brand no caller can forge. The only producer is `validateEndpoint`. */
declare const validatedEndpointBrand: unique symbol;

export interface ValidatedEndpoint {
  readonly [validatedEndpointBrand]: true;
  /** Normalized origin plus base path, never with a trailing slash. */
  readonly baseUrl: string;
  /** The ONLY URL the adapter dials. Composed here, never by string concat. */
  readonly chatCompletionsUrl: string;
  readonly host: string;
  readonly scheme: 'https' | 'http';
}

export type EndpointRejectionCode =
  | 'not_a_string'
  | 'empty'
  | 'too_long'
  | 'whitespace'
  | 'malformed_url'
  | 'unsupported_scheme'
  | 'insecure_transport'
  | 'embedded_credentials'
  | 'query_string'
  | 'fragment'
  | 'secret_like'
  | 'malformed_host'
  | 'loopback_host'
  | 'private_address'
  | 'link_local_address'
  | 'metadata_address'
  | 'unspecified_address'
  | 'reserved_address'
  | 'unsupported_port'
  | 'path_traversal'
  | 'redundant_chat_completions_path'
  | 'path_too_long';

export interface EndpointRejection {
  readonly ok: false;
  readonly code: EndpointRejectionCode;
  readonly detail: string;
}

export type EndpointValidation =
  | { readonly ok: true; readonly endpoint: ValidatedEndpoint }
  | EndpointRejection;

export interface EndpointPolicyOptions {
  /**
   * THE LOCAL-DEVELOPMENT EXCEPTION, AND NOTHING ELSE.
   *
   * True admits `http` and private/loopback targets so a developer can point
   * Cortex at an Ollama or LM Studio server on their own machine. It is off by
   * default, it is a DEPLOYMENT-level switch
   * (`AI_SELF_HOSTED_ALLOW_PRIVATE_ENDPOINTS`), and bootstrap reports it loudly
   * when it is on. It is NOT reachable from a request body, a configuration row
   * or an administration call: a control an administrator can flip is a control
   * an attacker who reaches the administration surface can flip.
   *
   * It never admits a metadata address. There is no development scenario that
   * needs 169.254.169.254, and every SSRF chain that matters ends there.
   */
  readonly allowPrivateEndpoints?: boolean;
}

const MAX_URL_LENGTH = 2_048;
const MAX_PATH_LENGTH = 256;

/**
 * Key-shaped text, matched against the WHOLE raw URL.
 *
 * Not a completeness claim — it cannot be one. It is the cheap refusal for the
 * mistake an operator actually makes, which is pasting a working curl URL with
 * its key still attached into a field labelled "base URL".
 */
const SECRET_SHAPED =
  /(api[-_]?key|access[-_]?key|secret|passwd|password|token|bearer|credential|authorization|sig=|signature=|\bsk-[A-Za-z0-9]{8,})/i;

/** Whitespace and C0/C1 control characters, which the URL parser would repair. */
const WHITESPACE_OR_CONTROL = /[\s\u0000-\u001f\u007f]/;

/** A single DNS label, and then the whole name. Deliberately strict. */
const DNS_NAME = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$/;

/** Hosts that mean "this machine" however they are spelled. */
const LOOPBACK_NAMES = new Set([
  'localhost',
  'localhost.localdomain',
  'ip6-localhost',
  'ip6-loopback',
]);

/**
 * The well-known cloud metadata endpoints, by name and by literal.
 *
 * Named separately from the link-local range most of them live in so that a
 * refusal says `metadata_address`. An operator who typed one has very likely
 * been handed it by somebody else, and the reason they see should say so.
 */
const METADATA_HOSTS = new Set([
  '169.254.169.254',
  '169.254.170.2',
  '100.100.100.200',
  'metadata',
  'metadata.google.internal',
  'metadata.goog',
  'instance-data',
  '[fd00:ec2::254]',
  '[fe80::a9fe:a9fe]',
]);

function reject(code: EndpointRejectionCode, detail: string): EndpointRejection {
  return { ok: false, code, detail };
}

/** Dotted-quad octets, or `undefined` when this is not an IPv4 literal. */
function ipv4Octets(host: string): readonly number[] | undefined {
  const parts = host.split('.');
  if (parts.length !== 4) return undefined;
  const octets: number[] = [];
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return undefined;
    const value = Number.parseInt(part, 10);
    if (!Number.isInteger(value) || value < 0 || value > 255) return undefined;
    octets.push(value);
  }
  return octets;
}

/**
 * Classify an IPv4 literal.
 *
 * `null` means "a public unicast address". Everything else names the family it
 * belongs to, and the caller decides which of those the local-development
 * exception may admit — metadata never being one of them.
 */
function classifyIpv4(octets: readonly number[]): EndpointRejectionCode | null {
  const [a, b, c, d] = octets;
  if (METADATA_HOSTS.has(`${a}.${b}.${c}.${d}`)) return 'metadata_address';
  if (a === 0) return 'unspecified_address';
  if (a === 127) return 'loopback_host';
  if (a === 10) return 'private_address';
  if (a === 172 && b >= 16 && b <= 31) return 'private_address';
  if (a === 192 && b === 168) return 'private_address';
  if (a === 100 && b >= 64 && b <= 127) return 'private_address';
  if (a === 169 && b === 254) return 'link_local_address';
  if (a === 192 && b === 0 && c === 0) return 'reserved_address';
  if (a === 192 && b === 0 && c === 2) return 'reserved_address';
  if (a === 198 && (b === 18 || b === 19)) return 'reserved_address';
  if (a === 198 && b === 51 && c === 100) return 'reserved_address';
  if (a === 203 && b === 0 && c === 113) return 'reserved_address';
  if (a >= 224) return 'reserved_address';
  if (a === 255 && b === 255 && c === 255 && d === 255) return 'reserved_address';
  return null;
}

/**
 * Classify an IPv6 literal, given WITHOUT its brackets and lower-cased.
 *
 * Works on the textual form deliberately: the WHATWG URL parser has already
 * normalized and compressed the address, so the prefixes below are matched
 * against a canonical string rather than against whatever an operator typed.
 * An IPv4-mapped or IPv4-compatible address is handed back to the IPv4
 * classifier rather than being given a second, divergent rule set.
 */
function classifyIpv6(address: string): EndpointRejectionCode | null {
  if (address === '::1') return 'loopback_host';
  if (address === '::') return 'unspecified_address';

  const dotted = /^::(?:ffff:(?:0:)?)?(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(address);
  if (dotted) {
    const octets = ipv4Octets(dotted[1]);
    // An embedded quad the IPv4 parser cannot read is a shape nothing here
    // understands, which is the definition of "cannot establish safety".
    if (!octets) return 'malformed_host';
    return classifyIpv4(octets);
  }

  // THE FORM THE URL PARSER ACTUALLY PRODUCES. `[::ffff:127.0.0.1]` is
  // normalized to `[::ffff:7f00:1]` before this function ever sees it, so
  // matching only the dotted spelling above would have let every IPv4-mapped
  // loopback, private and metadata address through — which is exactly what the
  // test for it found.
  const hexMapped = /^::(?:ffff:)?(?:0:)?([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(address);
  if (hexMapped) {
    const high = Number.parseInt(hexMapped[1], 16);
    const low = Number.parseInt(hexMapped[2], 16);
    const octets = [high >> 8, high & 0xff, low >> 8, low & 0xff];
    return classifyIpv4(octets);
  }

  const head = address.split(':')[0] ?? '';
  if (head !== '' && !/^[0-9a-f]{1,4}$/.test(head)) return 'malformed_host';
  // A leading empty group means the address is `::`-compressed at the front,
  // which puts zeros in the high bits — that is neither ULA, link-local nor
  // multicast, and the two special cases (`::` and `::1`) are already handled.
  const leading = head === '' ? 0 : Number.parseInt(head, 16);
  if (!Number.isFinite(leading)) return 'malformed_host';
  // fc00::/7 unique local. fe80::/10 link local. fec0::/10 the deprecated site
  // local range, still routed on plenty of networks. ff00::/8 multicast.
  if ((leading & 0xfe00) === 0xfc00) return 'private_address';
  if ((leading & 0xffc0) === 0xfe80) return 'link_local_address';
  if ((leading & 0xffc0) === 0xfec0) return 'private_address';
  if ((leading & 0xff00) === 0xff00) return 'reserved_address';
  return null;
}

/** Which rejections the local-development exception is allowed to waive. */
const WAIVABLE: ReadonlySet<EndpointRejectionCode> = new Set<EndpointRejectionCode>([
  'loopback_host',
  'private_address',
  'insecure_transport',
]);

/**
 * Validate an operator-supplied base URL for an OpenAI-compatible runtime.
 *
 * Returns a `ValidatedEndpoint` carrying the ONE URL the adapter will dial,
 * composed here. The adapter therefore never concatenates operator input with a
 * path, which is what makes "the request cannot be steered away from
 * /chat/completions" a structural statement rather than a review comment.
 */
export function validateEndpoint(
  raw: unknown,
  options: EndpointPolicyOptions = {},
): EndpointValidation {
  const allowPrivate = options.allowPrivateEndpoints === true;

  if (typeof raw !== 'string') return reject('not_a_string', 'the endpoint must be a string');
  if (raw.trim() === '') return reject('empty', 'the endpoint is empty');
  if (raw.length > MAX_URL_LENGTH) {
    return reject('too_long', `the endpoint exceeds ${MAX_URL_LENGTH} characters`);
  }
  // Checked BEFORE parsing. The URL parser strips leading and trailing control
  // characters and tolerates some embedded whitespace, so a value that only
  // becomes acceptable through that repair is a value we did not read the same
  // way the person who wrote it did.
  if (WHITESPACE_OR_CONTROL.test(raw)) {
    return reject('whitespace', 'the endpoint contains whitespace or control characters');
  }
  // DOT SEGMENTS ARE CHECKED ON THE RAW STRING, BEFORE PARSING, and that
  // ordering is the whole control. The URL parser RESOLVES `..` — it turns
  // `https://host/v1/../../admin` into `https://host/admin` and `%2e%2e` into
  // the same thing — so a check made afterwards sees a clean path and passes.
  // The stored value would then say one target and the runtime dial another,
  // which is precisely the divergence an operator reading the console cannot
  // see. Refuse the shape instead of silently rewriting it.
  if (/(^|[/\\])\.\.?([/\\]|$)/.test(raw) || /%2e|%2f|%5c/i.test(raw)) {
    return reject('path_traversal', 'the endpoint contains dot segments or encoded separators');
  }
  if (SECRET_SHAPED.test(raw)) {
    // The value is NOT echoed. It has just been identified as probably
    // containing key material, and a diagnostic that quoted it would put that
    // material into the operator log this refusal exists to keep it out of.
    return reject('secret_like', 'the endpoint contains text shaped like key material');
  }

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return reject('malformed_url', 'the endpoint is not a valid absolute URL');
  }

  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    return reject('unsupported_scheme', `scheme ${url.protocol.replace(':', '')} is not supported`);
  }
  if (url.protocol === 'http:' && !allowPrivate) {
    return reject('insecure_transport', 'a self-hosted endpoint must use https');
  }
  if (url.username !== '' || url.password !== '') {
    return reject('embedded_credentials', 'the endpoint embeds a username or password');
  }
  if (url.search !== '') {
    return reject('query_string', 'the endpoint carries a query string');
  }
  if (url.hash !== '') {
    return reject('fragment', 'the endpoint carries a fragment');
  }

  const host = url.hostname.toLowerCase();
  if (host === '') return reject('malformed_host', 'the endpoint has no host');
  if (METADATA_HOSTS.has(host)) {
    // NEVER WAIVED, not even under the local-development exception.
    return reject('metadata_address', 'the endpoint names a cloud metadata service');
  }

  let classification: EndpointRejectionCode | null;
  if (host.startsWith('[')) {
    if (!host.endsWith(']')) return reject('malformed_host', 'malformed IPv6 literal');
    classification = classifyIpv6(host.slice(1, -1));
  } else {
    const octets = ipv4Octets(host);
    if (octets) {
      classification = classifyIpv4(octets);
    } else if (LOOPBACK_NAMES.has(host) || host.endsWith('.localhost') || host.endsWith('.local')) {
      classification = 'loopback_host';
    } else if (!DNS_NAME.test(host)) {
      // Anything the strict grammar does not accept — an underscore, a bare
      // trailing dot, a partially-decoded escape, a numeric form the parser
      // left alone. We could not establish what it addresses, so it fails.
      classification = 'malformed_host';
    } else {
      classification = null;
    }
  }

  if (classification !== null && !(allowPrivate && WAIVABLE.has(classification))) {
    return reject(classification, `the endpoint host ${describeClass(classification)}`);
  }

  if (url.port !== '') {
    const port = Number.parseInt(url.port, 10);
    if (!Number.isInteger(port) || port < 1 || port > 65_535) {
      return reject('unsupported_port', 'the endpoint port is out of range');
    }
  }

  const normalized = normalizePath(url.pathname);
  if (normalized.ok !== true) return normalized;

  const baseUrl = `${url.protocol}//${url.host}${normalized.path}`;
  const endpoint = {
    baseUrl,
    chatCompletionsUrl: `${baseUrl}/chat/completions`,
    host: url.host,
    scheme: url.protocol === 'https:' ? 'https' : 'http',
  } as unknown as ValidatedEndpoint;
  return { ok: true, endpoint };
}

function describeClass(code: EndpointRejectionCode): string {
  switch (code) {
    case 'loopback_host':
      return 'is a loopback address';
    case 'private_address':
      return 'is a private address';
    case 'link_local_address':
      return 'is a link-local address';
    case 'metadata_address':
      return 'is a cloud metadata address';
    case 'unspecified_address':
      return 'is the unspecified address';
    case 'reserved_address':
      return 'is in a reserved address range';
    default:
      return 'could not be established as safe';
  }
}

/**
 * Normalize the base path, or refuse it.
 *
 * Returns a path with no trailing slash and no empty segments, so composing
 * `${base}/chat/completions` has exactly one meaning. `/` normalizes to the
 * empty string.
 */
function normalizePath(pathname: string): { ok: true; path: string } | EndpointRejection {
  if (pathname.length > MAX_PATH_LENGTH) {
    return reject('path_too_long', 'the endpoint path is too long');
  }
  // Percent-encoded separators and dot segments are the whole trick: `%2e%2e`
  // and `%2f` survive the URL parser's normalization and only become `..` and
  // `/` at the far end, where the intended target has already been decided.
  if (/%2e|%2f|%5c/i.test(pathname) || pathname.includes('\\')) {
    return reject('path_traversal', 'the endpoint path contains encoded separators or dot segments');
  }
  const kept: string[] = [];
  for (const segment of pathname.split('/')) {
    if (segment === '') continue;
    if (segment === '.' || segment === '..') {
      return reject('path_traversal', 'the endpoint path contains dot segments');
    }
    if (!/^[A-Za-z0-9._~-]+$/.test(segment)) {
      return reject('path_traversal', 'the endpoint path contains unsupported characters');
    }
    kept.push(segment);
  }
  const path = kept.length === 0 ? '' : `/${kept.join('/')}`;
  if (/\/chat\/completions$/.test(path)) {
    // The adapter appends `/chat/completions`. A base that already ends in it
    // would produce `/chat/completions/chat/completions` — harmless, and a
    // clear sign the operator pasted the wrong URL, so it is refused rather
    // than silently repaired into something they did not write.
    return reject(
      'redundant_chat_completions_path',
      'the endpoint must be the API base, not the chat completions path',
    );
  }
  return { ok: true, path };
}
