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
- `POST /api/platform` for authorized session reads and actions;
- `POST /api/mobile/work` when delegated Slack reads and ticket queue controls
  are enabled.

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

In the authenticated Monique dashboard, open **Health → Pair a phone**
(**Associer un téléphone** in French). Choose the conversations and actions
this phone needs, then create the invite. The dashboard displays its QR code
and offers **Download QR code** and **Copy invite**.

In the app, choose **Scan or import QR code**, then **Scan with camera** and
point at the code on another screen. Detection is automatic; no photo is needed.
Alternatively, import the downloaded image. Importing an image does not require
camera permission. You can also paste the copied invite. Review the server
address, then choose **Connect this server**. Reading the QR code alone does
not verify the server; pairing checks its identity and protocol before the
one-time exchange.

Invites expire after five minutes and can be used only once. If the invite
expires while you are reviewing it, the app clears it and asks for a fresh code.
Use **Create another invite** in the dashboard. Keep downloaded QR images private and
delete them when finished; they contain the same one-time secret as the copied
invite.

The app permits up to five seconds of device/server clock difference when
admitting newly issued credentials. Expiry still has no grace period. Keep the
phone's automatic date and time enabled; larger clock differences can prevent
pairing even when the server has already consumed the invite.

### Administrator access to all conversations

Choose administrator access when this phone should see **all current and
future conversations** on the server. Settings identifies this scope explicitly.
Selected-conversation access remains the default. Existing phones keep their
original permissions; create a new invitation and pair again to change access.

Administrator conversation access does not automatically allow starting tasks
or managing Slack and tickets. Select those permissions separately when needed.
API-created administrator invitations use `all_sessions` together with
`attach`, an empty `session_scope`, and the specific action grants you intend.
Update older app builds before pairing with this new scope.

### Create an invite through the API

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

- render the exact JSON as a QR code and scan or import it in the app, or copy
  and paste the exact JSON;
- do not log, email, or upload the invite; delete temporary QR downloads after use;
- use it within five minutes and only once.

The app decodes the invite locally, shows the exact origin and pinned server
identity, and asks for confirmation before exchange. It clears the one-time
offer after the attempt. Issued access and refresh credentials are stored only
in the operating system's secure credential store.

## Enable Slack and ticket queues

In the authenticated dashboard, open mobile pairing and select **Allow this
phone to read the configured Slack channel and submit, approve or reject tickets
for this server’s Manage instance**. Create a new invitation and scan or paste it
in the app. Existing invitations and paired phones retain their original scope;
re-pair to add this permission. No session selection is required for work-only
access. API-created invitations select the `manage_work` action explicitly.

Open **Work** after pairing. The channel panel shows recent messages from the
channel configured by the server operator. The queue shows the server’s linked
GitHub tickets and their current state. Paste an exact GitHub issue URL to submit
it for approval. Review the ticket, then approve or reject its pending gate;
rejection requires a reason. If a response is interrupted, use **Retry same
request** to recover the same operation before submitting another one. A
confirmed refusal of the first attempt clears the request so you can correct it;
a refusal during recovery cannot erase an earlier uncertain outcome.

The server must configure its existing Slack and Manage integrations plus the
private channel binding described in Automonique’s Slack rollout documentation.
Neither the phone nor the pairing invitation contains Slack or Manage service
credentials. This is server-delegated access; it does not sign into Slack with
an email address or grant access to other channels.

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
