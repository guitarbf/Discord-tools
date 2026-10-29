import { isRecord } from "../utils/guards";
import { SENSITIVE_KEY_PATTERN, TOKEN_PATTERNS } from "./sanitize";

export interface SensitiveFinding {
    path: string;
    kind: "token" | "authHeader" | "sensitiveKey";
}

const AUTH_VALUE_PATTERN = /\b(Bearer|Bot)\s+[A-Za-z0-9._~+/-]{10,}/;

export function findSensitiveData(value: unknown, path = "$", seen = new WeakSet<object>()): SensitiveFinding[] {
    const findings: SensitiveFinding[] = [];
    if (typeof value === "string") {
        if (TOKEN_PATTERNS.some(p => new RegExp(p.source).test(value))) findings.push({ path, kind: "token" });
        else if (AUTH_VALUE_PATTERN.test(value)) findings.push({ path, kind: "authHeader" });
        return findings;
    }
    if (typeof value !== "object" || value === null || seen.has(value)) return findings;
    seen.add(value);
    if (Array.isArray(value)) {
        value.forEach((v, i) => findings.push(...findSensitiveData(v, `${path}[${i}]`, seen)));
        return findings;
    }
    if (isRecord(value)) {
        for (const [key, v] of Object.entries(value)) {
            if (SENSITIVE_KEY_PATTERN.test(key)) findings.push({ path: `${path}.${key}`, kind: "sensitiveKey" });
            findings.push(...findSensitiveData(v, `${path}.${key}`, seen));
        }
    }
    return findings;
}
