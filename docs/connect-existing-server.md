# Connect an existing Automonique server

The mobile app connects to the Automonique installation you already operate. It
does not use a hosted demo backend and it does not need provider, database, or
root credentials.

## What the server must expose

Put the Automonique web entry behind one stable public HTTPS origin. The reverse
proxy must forward these paths without rewriting the origin or following a
redirect:

- `GET /.well-known/automonique-mobile` for public, credential-free discovery;
- `POST /api/mobile/pairings` for an authenticated operator to create an invite;
- `POST /api/mobile/pairings/exchange` for the phone's one-time exchange;
- `/api/mobile/refresh`, `/api/mobile/revoke`, and
  `/api/mobile/authorization` for the scoped credential lifecycle;
- `POST /api/platform` for authorized session reads and actions.

TLS terminates at the existing proxy or tunnel. The app rejects HTTP, embedded
URL credentials, redirects, a mismatched origin, a changed server identity, an
unexpected media type, and an incompatible discovery document.

Compatibility is decided by the mobile protocol version your server advertises,
not by which Automonique revision it runs. Keeping the server up to date does
not require a new app build; only a change to the mobile protocol version does.
If a server ever advertises no version the app speaks, the check reports that
the app needs updating rather than blaming the endpoint.

In the app, open **Connection**, enter only the origin—for example
`https://ops.example.com`—and tap **Check this server**. This performs public
discovery only. It sends no operator or mobile credential.

## Create the one-time invite

Use an authenticated operator session or deployment tool to send this media
type to the discovery document's `pairing_create_endpoint`:

```http
Content-Type: application/vnd.automonique.mobile-auth.v1+json
Accept: application/vnd.automonique.mobile-auth.v1+json
```

The body selects the exact sessions, actions, and mobile ceilings. For example:

```json
{
  "actions": ["attach", "follow_up", "stop_run", "decide_approval"],
  "limits": {
    "max_follow_up_bytes": 4096,
    "max_page_events": 128
  },
  "session_scope": ["session-id-from-your-server"]
}
```

Use the server's normal operator authentication for this request. Do not put
that authentication in the mobile app and do not widen the session or action
scope just for convenience.

The `201` response is the pairing invite. Treat it as a short-lived secret:

- render the exact JSON as a QR code and scan it in the app, or copy and paste
  the exact JSON;
- do not log, email, upload, or save the invite;
- use it within five minutes and only once.

The app decodes the invite locally, shows the exact origin and pinned server
identity, and asks for confirmation before exchange. It clears the one-time
offer after the attempt. Issued access and refresh credentials are stored only
in the operating system's secure credential store.

## Existing network and identity infrastructure

- A Cloudflare Tunnel, reverse proxy, VPN ingress, or load balancer is fine when
  the phone can reach the same stable HTTPS origin and the forwarded origin is
  exact.
- SSO may protect the human dashboard, but the mobile lifecycle and Platform
  routes must preserve Automonique's documented authentication and media types.
  An HTML login redirect is rejected.
- The first pairing pins Automonique's stable server identity independently of
  the TLS certificate. Moving the installation without preserving that identity
  intentionally requires a new pairing.
- Each phone receives its own credential family. Revoke a lost phone from the
  server or with **Revoke this device** in the app.

## Troubleshooting

If **Check this server** fails, verify DNS and TLS from the phone's network,
then inspect `/.well-known/automonique-mobile` through the same public origin.
The endpoint must return the Automonique mobile-auth v1 media type and exact
origin-bound document—not HTML, a proxy login, or a redirect.

If discovery succeeds but pairing fails, create a fresh invite and confirm its
origin and server identity match the verified server. An expired, consumed,
redirected, or identity-mismatched invite fails closed.
