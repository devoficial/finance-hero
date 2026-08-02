import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { promisify } from "node:util";
import type { ServerConfig } from "./config";

const execFileAsync = promisify(execFile);
const GMAIL_READONLY_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";
const KEYCHAIN_SERVICE = "finance-hero.gmail";
const KEYCHAIN_ACCOUNT = "primary";

export const DEFAULT_GMAIL_STATEMENT_QUERY =
  "newer_than:1y has:attachment subject:statement -subject:securities -subject:mutual -subject:payslip -subject:salary -subject:employment -subject:invoice -subject:receipt";

export interface StoredGmailCredential {
  refreshToken: string;
  email: string;
  subject: string;
  scope: string;
  updatedAt: string;
}

export interface GmailAttachment {
  messageId: string;
  filename: string;
  mimeType: string;
  content: Buffer;
}

export interface GmailConnectionStatus {
  configured: boolean;
  connected: boolean;
  ownerEmail: string | null;
  scope: typeof GMAIL_READONLY_SCOPE;
  message: string;
}

export interface GmailTokenStore {
  load(): Promise<StoredGmailCredential | null>;
  save(credential: StoredGmailCredential): Promise<void>;
}

export interface GmailConnector {
  status(): Promise<GmailConnectionStatus>;
  createAuthorizationUrl(): string;
  completeAuthorization(code: string, state: string): Promise<GmailConnectionStatus>;
  discoverAttachments(query?: string, maxMessages?: number): Promise<GmailAttachment[]>;
}

export class MacOSGmailTokenStore implements GmailTokenStore {
  async load(): Promise<StoredGmailCredential | null> {
    if (process.platform !== "darwin") return null;
    try {
      const { stdout } = await execFileAsync("security", [
        "find-generic-password",
        "-s",
        KEYCHAIN_SERVICE,
        "-a",
        KEYCHAIN_ACCOUNT,
        "-w",
      ]);
      return JSON.parse(stdout.trim()) as StoredGmailCredential;
    } catch {
      return null;
    }
  }

  async save(credential: StoredGmailCredential): Promise<void> {
    if (process.platform !== "darwin") throw new Error("Gmail credentials require macOS Keychain.");
    await execFileAsync("security", [
      "add-generic-password",
      "-U",
      "-s",
      KEYCHAIN_SERVICE,
      "-a",
      KEYCHAIN_ACCOUNT,
      "-w",
      JSON.stringify(credential),
    ]);
  }
}

interface OAuthTokenResponse {
  access_token?: string;
  refresh_token?: string;
  scope?: string;
  error?: string;
  error_description?: string;
}

interface GoogleUserInfo {
  sub?: string;
  email?: string;
  email_verified?: boolean;
}

interface GmailMessagePart {
  filename?: string;
  mimeType?: string;
  body?: { attachmentId?: string; data?: string };
  parts?: GmailMessagePart[];
}

interface GmailMessage {
  id?: string;
  payload?: GmailMessagePart;
}

function decodeBase64Url(value: string): Buffer {
  return Buffer.from(value.replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

function supportedAttachment(filename: string): boolean {
  if (!/\.(csv|tsv|pdf|xls|xlsx)$/i.test(filename)) return false;

  // A statement email can contain unrelated supporting documents. Keep the
  // filter deny-list based so masked/numeric bank statement names still work.
  return !/(?:payslip|salary[ _-]?slip|employment|employement|offer[ _-]?letter|invoice|receipt|securities|mutual[ _-]?fund|contract[ _-]?note|tax[ _-]?invoice|order[ _-]?id|holding[ _-]?statement|retention[ _-]?(?:account[ _-]?)?statement|quarterly[ _-]?account[ _-]?statement|cdsl)/i.test(
    filename,
  );
}

export class GmailService implements GmailConnector {
  private readonly states = new Map<string, number>();

  constructor(
    private readonly config: ServerConfig,
    private readonly tokenStore: GmailTokenStore = new MacOSGmailTokenStore(),
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  private isConfigured(): boolean {
    return Boolean(this.config.googleClientId && this.config.googleClientSecret && this.config.googleOwnerEmail);
  }

  private redirectUri(): string {
    return this.config.googleRedirectUri ?? `http://127.0.0.1:${this.config.port}/api/v1/gmail/oauth/callback`;
  }

  async status(): Promise<GmailConnectionStatus> {
    const credential = this.isConfigured() ? await this.tokenStore.load() : null;
    const connected = Boolean(
      credential?.scope.split(" ").includes(GMAIL_READONLY_SCOPE) &&
        credential.email.toLowerCase() === this.config.googleOwnerEmail?.trim().toLowerCase(),
    );
    return {
      configured: this.isConfigured(),
      connected,
      ownerEmail: credential?.email ?? this.config.googleOwnerEmail ?? null,
      scope: GMAIL_READONLY_SCOPE,
      message: !this.isConfigured()
        ? "Add Google OAuth credentials and the allowed owner email."
        : connected
          ? "Gmail is connected read-only."
          : "Gmail is configured but not connected to the allowed owner.",
    };
  }

  createAuthorizationUrl(): string {
    if (!this.isConfigured()) throw new Error("Gmail OAuth is not configured.");
    const state = randomBytes(32).toString("hex");
    const now = Date.now();
    for (const [candidate, expiresAt] of this.states) {
      if (expiresAt <= now) this.states.delete(candidate);
    }
    this.states.set(state, now + 10 * 60_000);
    const parameters = new URLSearchParams({
      client_id: this.config.googleClientId as string,
      redirect_uri: this.redirectUri(),
      response_type: "code",
      scope: `openid email ${GMAIL_READONLY_SCOPE}`,
      access_type: "offline",
      prompt: "consent",
      include_granted_scopes: "true",
      state,
    });
    return `https://accounts.google.com/o/oauth2/v2/auth?${parameters.toString()}`;
  }

  async completeAuthorization(code: string, state: string): Promise<GmailConnectionStatus> {
    const expiresAt = this.states.get(state);
    this.states.delete(state);
    if (!expiresAt || expiresAt <= Date.now())
      throw new Error("The Gmail authorization request expired or is invalid.");

    const token = await this.requestToken({
      code,
      client_id: this.config.googleClientId as string,
      client_secret: this.config.googleClientSecret as string,
      redirect_uri: this.redirectUri(),
      grant_type: "authorization_code",
    });
    if (!token.access_token || !token.refresh_token) {
      throw new Error("Google did not return an offline refresh token. Reconnect and grant consent.");
    }
    const grantedScope = token.scope ?? "";
    if (!grantedScope.split(" ").includes(GMAIL_READONLY_SCOPE)) {
      throw new Error("Google did not grant the required Gmail read-only scope.");
    }
    const userResponse = await this.fetcher("https://openidconnect.googleapis.com/v1/userinfo", {
      headers: { authorization: `Bearer ${token.access_token}` },
    });
    if (!userResponse.ok) throw new Error("Google owner identity could not be verified.");
    const user = (await userResponse.json()) as GoogleUserInfo;
    const allowedEmail = this.config.googleOwnerEmail?.trim().toLowerCase();
    const verifiedEmail = user.email?.trim();
    if (!user.email_verified || !user.sub || !verifiedEmail || verifiedEmail.toLowerCase() !== allowedEmail) {
      throw new Error("This Google account is not the configured Finance Hero owner.");
    }
    await this.tokenStore.save({
      refreshToken: token.refresh_token,
      email: verifiedEmail,
      subject: user.sub,
      scope: grantedScope,
      updatedAt: new Date().toISOString(),
    });
    return this.status();
  }

  async discoverAttachments(query?: string, maxMessages?: number): Promise<GmailAttachment[]> {
    const credential = await this.tokenStore.load();
    if (!credential) throw new Error("Gmail is not connected.");
    const accessToken = await this.refreshAccessToken(credential.refreshToken);
    const listUrl = new URL("https://gmail.googleapis.com/gmail/v1/users/me/messages");
    listUrl.searchParams.set("q", query ?? DEFAULT_GMAIL_STATEMENT_QUERY);
    listUrl.searchParams.set("maxResults", String(Math.min(Math.max(maxMessages ?? 100, 1), 100)));
    const listed = await this.gmailJson<{ messages?: Array<{ id?: string }> }>(listUrl, accessToken);
    const attachments: GmailAttachment[] = [];
    for (const listedMessage of listed.messages ?? []) {
      if (!listedMessage.id) continue;
      const message = await this.gmailJson<GmailMessage>(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(listedMessage.id)}?format=full`,
        accessToken,
      );
      const parts: GmailMessagePart[] = [];
      const visit = (part?: GmailMessagePart) => {
        if (!part) return;
        parts.push(part);
        for (const child of part.parts ?? []) visit(child);
      };
      visit(message.payload);
      for (const part of parts) {
        const filename = part.filename?.trim() ?? "";
        if (!filename || !supportedAttachment(filename)) continue;
        let content: Buffer | undefined;
        if (part.body?.data) content = decodeBase64Url(part.body.data);
        if (!content && part.body?.attachmentId) {
          const body = await this.gmailJson<{ data?: string }>(
            `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(listedMessage.id)}/attachments/${encodeURIComponent(part.body.attachmentId)}`,
            accessToken,
          );
          if (body.data) content = decodeBase64Url(body.data);
        }
        if (content?.length) {
          attachments.push({
            messageId: listedMessage.id,
            filename,
            mimeType: part.mimeType ?? "application/octet-stream",
            content,
          });
        }
      }
    }
    return attachments;
  }

  private async refreshAccessToken(refreshToken: string): Promise<string> {
    const token = await this.requestToken({
      refresh_token: refreshToken,
      client_id: this.config.googleClientId as string,
      client_secret: this.config.googleClientSecret as string,
      grant_type: "refresh_token",
    });
    if (!token.access_token) throw new Error("Google access could not be refreshed. Reconnect Gmail.");
    return token.access_token;
  }

  private async requestToken(parameters: Record<string, string>): Promise<OAuthTokenResponse> {
    const response = await this.fetcher("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(parameters),
    });
    const token = (await response.json()) as OAuthTokenResponse;
    if (!response.ok) throw new Error(token.error_description ?? token.error ?? "Google OAuth failed.");
    return token;
  }

  private async gmailJson<T>(url: string | URL, accessToken: string): Promise<T> {
    const response = await this.fetcher(url, { headers: { authorization: `Bearer ${accessToken}` } });
    if (!response.ok) throw new Error(`Gmail API request failed (${response.status}).`);
    return (await response.json()) as T;
  }
}
