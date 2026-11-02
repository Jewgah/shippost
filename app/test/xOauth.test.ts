import { describe, it, expect } from "vitest";
import { oauth1Header, oauth1Signature, percentEncode, signatureBase } from "@/lib/xOauth";

// X's documented example ("Creating a signature", developer.x.com OAuth 1.0a docs): the same
// inputs must give the same signature. These are X's public sample credentials, not real keys.
const KEYS = {
  apiKey: "xvz1evFS4wEEPTGEFPHBog",
  apiSecret: "kAcSOqF21Fu85e7zjz7ZN2U4ZRhfV3WpwPAoE3Z7kBw",
  accessToken: "370773112-GmHxMAgYyLbNEtIKZeRNFsMKPR9EyMZeS9weJAEb",
  accessSecret: "LswwdoUaIvS8ltyTt5jkRh4J50vUPVVHtR2YPi5kE",
};
const FIXED = { nonce: "kYjzVBB8Y0ZFabxSWbWovY3uYSQ2pTgmZeNu2VS4cg", timestamp: "1318622958" };
const URL_ = "https://api.twitter.com/1.1/statuses/update.json?include_entities=true";
const BODY = { status: "Hello Ladies + Gentlemen, a signed OAuth request!" };

describe("xOauth", () => {
  it("percent-encodes the RFC 3986 way", () => {
    expect(percentEncode("Ladies + Gentlemen!*'()")).toBe("Ladies%20%2B%20Gentlemen%21%2A%27%28%29");
  });

  it("reproduces X's documented signature example", () => {
    const header = oauth1Header("POST", URL_, BODY, KEYS, FIXED);
    expect(header).toContain('oauth_signature="hCtSmYh%2BiHYCEqBWrE7C7hYmtUk%3D"');
    expect(header.startsWith("OAuth ")).toBe(true);
    expect(header).toContain('oauth_consumer_key="xvz1evFS4wEEPTGEFPHBog"');
    // The secrets sign the request but never appear in it.
    expect(header).not.toContain(KEYS.apiSecret);
    expect(header).not.toContain(KEYS.accessSecret);
  });

  it("reproduces the same example on the api.x.com host, as the current docs page shows it", () => {
    const header = oauth1Header("POST", "https://api.x.com/1.1/statuses/update.json?include_entities=true", BODY, KEYS, FIXED);
    expect(header).toContain(`oauth_signature="${percentEncode("Ls93hJiZbQ3akF3HF3x1Bz8/zU4=")}"`);
  });

  it("signs the query string: the same request with another query gets another signature", () => {
    const oauth = {
      oauth_consumer_key: KEYS.apiKey,
      oauth_nonce: FIXED.nonce,
      oauth_signature_method: "HMAC-SHA1",
      oauth_timestamp: FIXED.timestamp,
      oauth_token: KEYS.accessToken,
      oauth_version: "1.0",
    };
    const a = oauth1Signature(signatureBase("GET", "https://api.x.com/2/media/upload?command=STATUS&media_id=1", oauth), KEYS.apiSecret, KEYS.accessSecret);
    const b = oauth1Signature(signatureBase("GET", "https://api.x.com/2/media/upload?command=STATUS&media_id=2", oauth), KEYS.apiSecret, KEYS.accessSecret);
    expect(a).not.toBe(b);
    expect(signatureBase("GET", "https://API.X.com/2/users/me", {})).toBe("GET&https%3A%2F%2Fapi.x.com%2F2%2Fusers%2Fme&");
  });
});
