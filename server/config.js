import 'dotenv/config'

const bool = (v) => v === '1' || String(v).toLowerCase() === 'true'

/** A comma-separated list of email addresses, trimmed and lower-cased. */
const emails = (raw) =>
  String(raw || '')
    .split(',')
    .map((v) => v.trim().toLowerCase())
    .filter(Boolean)

/**
 * A temporary email + password sign-in for local testing, while the Entra app
 * registration is not set up yet. On only when both are set and the password is
 * long enough; remove the two variables to turn it off.
 */
const LOCAL_MIN_PASSWORD = 12
const localEmail = String(process.env.LOCAL_LOGIN_EMAIL || '').trim().toLowerCase()
const localPassword = String(process.env.LOCAL_LOGIN_PASSWORD || '')
const localEnabled = Boolean(localEmail && localPassword.length >= LOCAL_MIN_PASSWORD)

export const config = {
  port: Number(process.env.PORT) || 7010,
  cacheTtl: process.env.CACHE_TTL === undefined ? 120 : Number(process.env.CACHE_TTL),

  /** Entra ID app registration. Serves as the Power BI service principal and
   *  as the client for interactive Microsoft sign-in. */
  ms: {
    tenantId: process.env.MS_TENANT_ID,
    clientId: process.env.MS_CLIENT_ID,
    clientSecret: process.env.MS_CLIENT_SECRET,
    redirectUri: process.env.MS_REDIRECT_URI,
  },

  /**
   * Where the browser is sent back to after a Microsoft sign-in.
   *
   * In development the page is served by Vite on 7011 while the API answers the
   * callback on 7010, so the two differ and this cannot be inferred.
   */
  appOrigin: process.env.APP_ORIGIN || 'http://localhost:7011',

  pbi: {
    workspaceId: process.env.PBI_WORKSPACE_ID,
    datasetId: process.env.PBI_DATASET_ID,
  },

  /**
   * Who may sign in. Administrators are always allowed; `allowed` is everyone
   * else. Read through auth/accounts.js, which is the one place to swap for a
   * database later.
   */
  access: {
    // The temporary local account is an administrator while it exists.
    admins: [...emails(process.env.ADMIN_EMAILS), ...(localEnabled ? [localEmail] : [])],
    allowed: emails(process.env.ALLOWED_EMAILS),
  },

  localLogin: {
    enabled: localEnabled,
    email: localEmail,
    password: localPassword,
    /** Why it is off, when the variables are present but unusable. */
    problem:
      (localEmail || localPassword) && !localEnabled
        ? `LOCAL_LOGIN_EMAIL and a LOCAL_LOGIN_PASSWORD of at least ${LOCAL_MIN_PASSWORD} characters are both required`
        : null,
  },

  session: {
    ttlHours: Number(process.env.SESSION_TTL_HOURS) || 12,
    /** Drops the Secure cookie flag. Local http development only. */
    cookieInsecure: bool(process.env.COOKIE_INSECURE),
  },
}

/** Settings a live Power BI connection cannot do without. */
const REQUIRED = {
  MS_TENANT_ID: () => config.ms.tenantId,
  MS_CLIENT_ID: () => config.ms.clientId,
  MS_CLIENT_SECRET: () => config.ms.clientSecret,
  PBI_WORKSPACE_ID: () => config.pbi.workspaceId,
  PBI_DATASET_ID: () => config.pbi.datasetId,
}

/** Settings Microsoft sign-in cannot do without. */
const SIGN_IN = {
  MS_TENANT_ID: () => config.ms.tenantId,
  MS_CLIENT_ID: () => config.ms.clientId,
  MS_CLIENT_SECRET: () => config.ms.clientSecret,
  MS_REDIRECT_URI: () => config.ms.redirectUri,
  'ALLOWED_EMAILS or ADMIN_EMAILS': () => config.access.admins.length + config.access.allowed.length,
}

const missing = (table) =>
  Object.entries(table)
    .filter(([, get]) => !get())
    .map(([name]) => name)

/** Env var names still missing for a live Power BI connection. */
export function missingSettings() {
  return missing(REQUIRED)
}

/** Env var names still missing for Microsoft sign-in. */
export function missingSignIn() {
  return missing(SIGN_IN)
}
