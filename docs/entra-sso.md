# Single sign-on with Microsoft Entra ID (SAML)

The portal signs people in with their Microsoft work account over SAML 2.0. Entra ID is the identity provider and the Fastify API is the service provider. After sign-in, the API keeps the user's name and email in an encrypted, HttpOnly session cookie that lasts 8 hours (set `SESSION_HOURS` to change it). Every `/api` route except `/api/health` and `/api/auth/*` answers 401 without that cookie, and the Vue app sends anyone who isn't signed in to Microsoft.

Set it up for localhost first, then add the production URL once the app is deployed (Vercel first, AWS later).

## 1. Create the enterprise application

You need the Cloud Application Administrator or Application Administrator role.

1. Open the [Microsoft Entra admin center](https://entra.microsoft.com) and go to **Entra ID → Enterprise apps → All applications → New application**.
2. Choose **Create your own application**, name it `Tender Sites Portal`, and pick **Integrate any other application you don't find in the gallery (Non-gallery)**. Then click **Create**.

## 2. Configure SAML

In the new app, open **Single sign-on** and choose **SAML**.

**Basic SAML Configuration → Edit:**

| Field | Localhost value | Notes |
| --- | --- | --- |
| Identifier (Entity ID) | `urn:tender-sites-portal` | Must equal `SAML_ISSUER`. Tick **Default**. |
| Reply URL (Assertion Consumer Service URL) | `http://localhost:5173/api/auth/saml/acs` | Entra only accepts `http://` for localhost. Add the production URL later. |
| Sign on URL | *(leave empty for now)* | Set it to the production URL later (see step 6). |
| Logout Url | `http://localhost:5173/api/auth/saml/logout` | Where Entra sends people after they sign out. |

Instead of typing these values, you can run the app and use **Upload metadata file** with the file from `http://localhost:5173/api/auth/saml/metadata`.

**Attributes & Claims:** keep the defaults. The app reads the display name (or the given name plus surname) and the email address, and falls back to the user principal name.

**SAML Certificates:** download **Certificate (Base64)**. Turn it into one line for the env file:

```bash
grep -v CERTIFICATE "Tender Sites Portal.cer" | tr -d '\r\n'
```

**Set up Tender Sites Portal:** copy the **Login URL** and **Logout URL**. Both look like `https://login.microsoftonline.com/<tenant-id>/saml2`.

## 3. Choose who can sign in

1. Open **Users and groups → Add user/group**, then assign yourself and the people or groups who should use the portal.
2. Open **Properties** and set:
   - **Assignment required?** to **Yes**, so only assigned people can sign in. Everyone else gets an Entra error (AADSTS50105).
   - **Visible to users?** to **Yes**, so the app shows in My Apps.
   - **Logo:** optional. A square PNG becomes the tile image in My Apps.

   Then click **Save**.

## 4. Test on localhost

Add these to `.env.local` at the repo root. Never commit that file.

```bash
SAML_ENTRY_POINT=https://login.microsoftonline.com/<tenant-id>/saml2   # Login URL
SAML_LOGOUT_URL=https://login.microsoftonline.com/<tenant-id>/saml2    # Logout URL
SAML_IDP_CERT=MIIC8D...                                               # the one-line certificate
SAML_ISSUER=urn:tender-sites-portal
APP_BASE_URL=http://localhost:5173
SESSION_SECRET=                                                       # paste the output of: openssl rand -hex 32
```

Then run `npm run dev` and open <http://localhost:5173>. You should land on Microsoft's sign-in page and come back signed in, with your initials at the top right. Click them to see your name and email and to sign out.

You can also click **Test** on the app's Single sign-on page in Entra. Entra posts straight to the Reply URL, so the dev server must be running.

## 5. My Apps

Assigned users see a **Tender Sites Portal** tile at <https://myapps.microsoft.com>, usually within a few minutes. Clicking it signs them in:

- **Sign on URL empty (IdP-initiated):** Entra posts a SAML response to the default Reply URL. The app accepts these responses because they carry no `InResponseTo`.
- **Sign on URL set (SP-initiated):** My Apps opens that URL, and the app redirects to Entra, which signs the user in without another prompt.

During localhost testing the tile works only on your own machine while `npm run dev` is running.

## 6. Deploy on Vercel

`vercel.json` builds the Vue app as static files and runs the Fastify API as one function (`api/index.mjs`) for every `/api` route.

**In Vercel**

1. Go to **Add New → Project** and import `benjaminkong/projectkepler`. Leave **Framework Preset** as Other and **Root Directory** as `./`; the build settings come from `vercel.json`.
2. Before the first deploy, open **Environment Variables** and add these for Production. Mark the secrets **Sensitive**.

   | Variable | Value |
   | --- | --- |
   | `APP_BASE_URL` | `https://<project>.vercel.app`, the production domain with no trailing slash |
   | `SAML_ENTRY_POINT` | Entra's Login URL (same as in `.env.local`) |
   | `SAML_LOGOUT_URL` | Entra's Logout URL |
   | `SAML_IDP_CERT` | The one-line certificate |
   | `SAML_ISSUER` | `urn:tender-sites-portal` |
   | `SESSION_SECRET` | A new value, not your local one: the output of `openssl rand -hex 32` |
   | `URA_ACCESS_KEY`, `AWS_BEARER_TOKEN_BEDROCK`, `BEDROCK_REGION`, `COGNITO_CLIENT_ID`, `COGNITO_CLIENT_SECRET`, `COGNITO_TOKEN_URL`, `COGNITO_SCOPE`, `AGENTCORE_RUNTIME_URL` | Same as `.env.local`, for transactions, AI assessments and tender documents |

3. Deploy. Check the domain under **Settings → Domains**. If it differs from `APP_BASE_URL`, fix the variable and redeploy. `APP_BASE_URL` must be the production domain, not a per-deployment URL such as `projectkepler-abc123.vercel.app`.
4. Leave **Settings → Deployment Protection** at its default (Standard Protection), which doesn't cover the production domain. If Vercel Authentication covers production, it blocks Entra's sign-in response.

**In Entra** (Enterprise apps → Tender Sites Portal → Single sign-on → Basic SAML Configuration → Edit)

| Field | Value |
| --- | --- |
| Reply URL | Add `https://<project>.vercel.app/api/auth/saml/acs` and tick **Default**. Keep the localhost one for local testing. |
| Sign on URL | `https://<project>.vercel.app/` |
| Logout Url | `https://<project>.vercel.app/api/auth/saml/logout` (Entra allows only one, so this replaces localhost) |

Save, then open <https://myapps.microsoft.com> and click **Tender Sites Portal**. Because the Sign on URL is set, My Apps opens the portal, the portal asks Entra to sign you in, and Entra does so without another prompt.

Sign-in works across Vercel's function instances. Over https, the ID of each sign-in request is kept in a short-lived encrypted cookie (`tsp_saml_req`), so any instance can check the response.

**Limits on Vercel, until there is a database**

- **Saved AI assessments** go to `/tmp` on each function instance and vanish when it stops. Sites are assessed again more often, and **each new assessment is a paid Bedrock or Anthropic call**.
- **Uploads:** Vercel caps a request body at 4.5 MB, so larger COT/TCOT files fail on Vercel even though the app allows 20 MB.
- **Caches** (URA sites, transactions, walking routes) are per instance, so the first request on a cold instance is slow.
- **Requests** can run up to 300 s (`maxDuration`).

## 7. Production on AWS

1. Do the Entra step above with your AWS domain.
2. Give the App Runner service or ECS task the same variables, with `APP_BASE_URL=https://<your-domain>`. Keep `SESSION_SECRET` and `SAML_IDP_CERT` in Secrets Manager.

With `NODE_ENV=production` (set on Vercel and in the Docker image), the server refuses to start without `SAML_ENTRY_POINT`. Set `AUTH_DISABLED=1` to run it open on purpose.

**Certificate rollover:** Entra's signing certificate lasts 3 years. Before it expires, create a new certificate in Entra, put it in `SAML_IDP_CERT`, redeploy, and then make the new certificate active.

## Troubleshooting

| What you see | Cause |
| --- | --- |
| AADSTS50011 (reply URL mismatch) | The Reply URL in Entra differs from `APP_BASE_URL` + `/api/auth/saml/acs`. |
| AADSTS700016 (application not found) | `SAML_ISSUER` differs from the Identifier (Entity ID). |
| AADSTS50105 (not assigned) | The user isn't assigned under **Users and groups**. |
| Back on **Sign-in didn't work** | The API rejected the response. The API log says why, for example `Invalid signature` (wrong `SAML_IDP_CERT`) or an audience mismatch. |
