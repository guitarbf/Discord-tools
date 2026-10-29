import { sanitizeValue } from "./sanitize";

export function buildErrorReport(sections: Record<string, unknown>): string {
    const sanitized = sanitizeValue(sections, { redactIds: true, allowContent: false });
    return [
        "Privacy Cleanup diagnostic report",
        "IDs, credentials and message content have been redacted.",
        "",
        JSON.stringify(sanitized, null, 2)
    ].join("\n");
}
